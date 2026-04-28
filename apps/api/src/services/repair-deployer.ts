/**
 * repair-deployer.ts — shared deploy logic for approved repairs.
 *
 * Both approval paths (/api/repairs/:id/approve and /api/repairs/:id/decision)
 * call `executeApprovedRepair` after marking the repair as approved. This
 * function:
 *
 *   1. Loads the latest bundle from MongoDB `operation_bundles`.
 *   2. Applies the repair's `proposedFiles` to produce a patched bundle.
 *   3. Deploys the patched bundle to a staging sandbox.
 *   4. Swaps staging into production via `swapStagingToProduction`.
 *   5. Updates the Prisma Operation with new deployment info.
 *   6. Sets `deployedAt` on the repair doc.
 *   7. Broadcasts activity + status via Socket.IO.
 *
 * If any step fails, the repair is marked `deploy_failed` and an activity
 * entry surfaces the error to the operator.
 */

import { createHash } from 'node:crypto';
import {
  createExecutionProvider,
  type DeploymentHandle,
  type OperationBundle,
  type OperationBundleFile,
} from '@argo/workspace-runtime';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';
import { appendActivity } from '../stores/activity-store.js';
import { broadcastToOwner } from '../realtime/socket.js';
import { logger } from '../logger.js';

const executionProvider = createExecutionProvider();

/**
 * Execute the deploy side-effect of an approved repair. Fire-and-forget safe
 * — all errors are caught internally and surfaced via the repair doc + activity
 * feed rather than thrown to the caller.
 */
export async function executeApprovedRepair(repairId: string): Promise<void> {
  const { db } = await getMongo();
  const prisma = getPrisma();

  const repair = await db.collection('operation_repairs').findOne({ id: repairId });
  if (!repair) {
    logger.warn({ repairId }, 'executeApprovedRepair: repair doc not found');
    return;
  }

  const op = await prisma.operation.findUnique({ where: { id: String(repair.operationId) } });
  if (!op) {
    logger.warn({ repairId, operationId: repair.operationId }, 'executeApprovedRepair: operation not found');
    return;
  }

  try {
    // ── 1. Load the latest bundle ──────────────────────────────────────
    const bundleDoc = await db
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();

    if (!bundleDoc) {
      throw new Error('No bundle found for operation — cannot deploy repair.');
    }

    const proposedFiles = (repair.proposedFiles ?? []) as Array<{
      path: string;
      replacement: string;
      reason?: string;
    }>;
    if (proposedFiles.length === 0) {
      throw new Error('Repair has no proposedFiles — nothing to deploy.');
    }

    // ── 2. Apply proposedFiles to create a patched bundle ──────────────
    const originalFiles = (bundleDoc.files ?? []) as Array<{
      path: string;
      contents: string;
      sha256: string;
      argoGenerated: boolean;
      sourceStepId: string | null;
    }>;

    const patchMap = new Map(proposedFiles.map((f) => [f.path, f.replacement]));

    const patchedFiles: OperationBundleFile[] = originalFiles.map((f) => {
      const patched = patchMap.get(f.path);
      if (patched !== undefined) {
        const contents = patched;
        const sha256 = createHash('sha256').update(contents).digest('hex');
        return {
          path: f.path,
          contents,
          sha256,
          argoGenerated: f.argoGenerated,
          sourceStepId: f.sourceStepId,
        };
      }
      return {
        path: f.path,
        contents: f.contents,
        sha256: f.sha256,
        argoGenerated: f.argoGenerated,
        sourceStepId: f.sourceStepId,
      };
    });

    // If the repair proposes a brand-new file that wasn't in the original bundle, add it.
    for (const pf of proposedFiles) {
      if (!originalFiles.some((f) => f.path === pf.path)) {
        const contents = pf.replacement;
        const sha256 = createHash('sha256').update(contents).digest('hex');
        patchedFiles.push({
          path: pf.path,
          contents,
          sha256,
          argoGenerated: true,
          sourceStepId: null,
        });
      }
    }

    const patchedBundleVersion = (bundleDoc.version as number) + 1;
    const patchedBundle: OperationBundle = {
      manifest: {
        ...bundleDoc.manifest,
        bundleVersion: patchedBundleVersion,
        generatedAt: new Date().toISOString(),
        generatedByModel: 'argo-repair',
      },
      files: patchedFiles,
    };

    // ── 3. Deploy patched bundle to staging ────────────────────────────
    await prisma.operation.update({ where: { id: op.id }, data: { status: 'deploying' } });
    broadcastToOwner(op.ownerId, { type: 'operation_status', operationId: op.id, status: 'deploying' });

    const stagingHandle = await executionProvider.deploy({
      operationId: op.id,
      bundle: patchedBundle,
      environment: 'staging',
      envOverrides: {
        ARGO_CONTROL_PLANE_URL: process.env.API_PUBLIC_URL ?? 'http://host.docker.internal:4000',
        INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? '',
        MONGODB_URI: process.env.MONGODB_URI ?? '',
        MONGODB_DB: `argo_op_${op.id}`,
      },
    });

    logger.info({ repairId, operationId: op.id, stagingSandbox: stagingHandle.sandboxId }, 'repair staging deployed');

    // ── 4. Swap staging → production ───────────────────────────────────
    const productionHandle: DeploymentHandle = {
      provider: (op.deploymentProvider as DeploymentHandle['provider']) ?? 'blaxel',
      environment: 'production',
      sandboxName: op.deploymentSandboxId ?? '',
      sandboxId: op.deploymentSandboxId ?? '',
      region: op.deploymentRegion ?? null,
      publicUrl: op.publicUrl ?? '',
      internalEndpoint: null,
      ports: [{ target: 3000, protocol: 'HTTP' }],
      createdAt: op.createdAt?.toISOString?.() ?? new Date().toISOString(),
    };

    const swapResult = await executionProvider.swapStagingToProduction({
      production: productionHandle,
      staging: stagingHandle,
      retainOldProduction: true,
    });

    logger.info(
      { repairId, operationId: op.id, newSandboxId: swapResult.newProduction.sandboxId },
      'repair swap completed',
    );

    // ── 5. Update Prisma Operation with new deployment info ────────────
    await prisma.operation.update({
      where: { id: op.id },
      data: {
        status: 'running',
        publicUrl: swapResult.newProduction.publicUrl,
        bundleVersion: patchedBundleVersion,
        deploymentProvider: swapResult.newProduction.provider,
        deploymentSandboxId: swapResult.newProduction.sandboxId,
        deploymentRegion: swapResult.newProduction.region,
        lastEventAt: new Date(),
      },
    });

    // Persist the patched bundle so future repairs can chain on top.
    await db.collection('operation_bundles').insertOne({
      operationId: op.id,
      version: patchedBundleVersion,
      manifest: patchedBundle.manifest,
      files: patchedBundle.files.map((f) => ({
        path: f.path,
        contents: f.contents,
        sha256: f.sha256,
        argoGenerated: f.argoGenerated,
        sourceStepId: f.sourceStepId,
        size: f.contents.length,
      })),
      filesSummary: patchedBundle.files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        argoGenerated: f.argoGenerated,
        size: f.contents.length,
      })),
      generatedByModel: 'argo-repair',
      repairId,
      createdAt: new Date().toISOString(),
    });

    // ── 6. Update repair doc with deployedAt ───────────────────────────
    const deployedAt = new Date().toISOString();
    await db.collection('operation_repairs').updateOne(
      { id: repairId },
      {
        $set: {
          status: 'deployed',
          deployedAt,
          deploymentSandboxId: swapResult.newProduction.sandboxId,
          deploymentBundleVersion: patchedBundleVersion,
        },
      },
    );

    // ── 7. Broadcast activity + status ─────────────────────────────────
    const activity = await appendActivity({
      ownerId: op.ownerId,
      operationId: op.id,
      operationName: op.name,
      kind: 'repair_deployed',
      message: `Repair deployed — live at ${swapResult.newProduction.publicUrl}.`,
    });
    broadcastToOwner(op.ownerId, { type: 'activity', payload: activity });
    broadcastToOwner(op.ownerId, { type: 'operation_status', operationId: op.id, status: 'running' });
  } catch (err) {
    // ── 8. On failure, mark repair as deploy_failed ────────────────────
    const message = String(err).slice(0, 400);
    logger.error({ err, repairId, operationId: op.id }, 'repair deploy failed');

    await db.collection('operation_repairs').updateOne(
      { id: repairId },
      { $set: { status: 'deploy_failed', deployFailedAt: new Date().toISOString(), deployError: message } },
    );

    // Reset operation status back to running — the old production is still live.
    await prisma.operation.update({ where: { id: op.id }, data: { status: 'running' } }).catch(() => undefined);

    const activity = await appendActivity({
      ownerId: op.ownerId,
      operationId: op.id,
      operationName: op.name,
      kind: 'repair_deploy_failed',
      message: `Repair deploy failed: ${message}`,
    });
    broadcastToOwner(op.ownerId, { type: 'activity', payload: activity });
  }
}
