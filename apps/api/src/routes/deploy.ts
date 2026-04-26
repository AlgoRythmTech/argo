import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { generateBundle, generateTestSuite } from '@argo/build-engine';
import { createBuildSandbox, createExecutionProvider } from '@argo/workspace-runtime';
import type { WorkflowMap } from '@argo/shared-types';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { broadcastToOwner } from '../realtime/socket.js';
import { logger } from '../logger.js';

const DeployBody = z.object({
  operationId: z.string(),
});

const buildSandbox = createBuildSandbox();
const executionProvider = createExecutionProvider();

export async function registerDeployRoutes(app: FastifyInstance) {
  app.post('/api/operations/deploy', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = DeployBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const op = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const mapDoc = await db
      .collection('workflow_maps')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!mapDoc) return reply.code(409).send({ error: 'no_map_yet' });

    const map = mapDoc.map as WorkflowMap;

    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'building' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'building' });

    const bundleVersion = (op.bundleVersion ?? 0) + 1;
    const generated = generateBundle({
      operationId: op.id,
      operationSlug: op.slug,
      bundleVersion,
      workflowMapVersion: op.workflowMapVersion,
      generatedByModel: 'argo-build-engine-v1',
      map,
    });

    if (!generated.ok) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'failed_build' } });
      return reply.code(500).send({ error: 'generation_failed', issues: generated.issues });
    }

    await db.collection('operation_bundles').insertOne({
      operationId: op.id,
      version: bundleVersion,
      manifest: generated.bundle.manifest,
      filesSummary: generated.bundle.files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        argoGenerated: f.argoGenerated,
        size: f.contents.length,
      })),
      createdAt: new Date().toISOString(),
    });

    // ── TESTING ────────────────────────────────────────────────────────
    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'testing' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'testing' });

    const cases = generateTestSuite(map);
    const testReport = await buildSandbox.runTests({ bundle: generated.bundle, cases });

    if (!testReport.passed) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'failed_build' } });
      logger.warn({ operationId: op.id, testReport }, 'tests failed pre-deploy');
      return reply.code(409).send({ error: 'tests_failed', testReport });
    }

    // ── DEPLOY ─────────────────────────────────────────────────────────
    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'deploying' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'deploying' });

    let handle;
    try {
      handle = await executionProvider.deploy({
        operationId: op.id,
        bundle: generated.bundle,
        environment: 'production',
        envOverrides: {
          ARGO_CONTROL_PLANE_URL: process.env.API_PUBLIC_URL ?? 'http://host.docker.internal:4000',
          INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? '',
          MONGODB_URI: process.env.MONGODB_URI ?? '',
          MONGODB_DB: `argo_op_${op.id}`,
        },
        onProgress: (evt) => {
          broadcastToOwner(session.userId, { type: 'deploy_progress', operationId: op.id, evt });
        },
      });
    } catch (err) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'failed_build' } });
      return reply.code(502).send({ error: 'deploy_failed', detail: String(err).slice(0, 400) });
    }

    await getPrisma().operation.update({
      where: { id: op.id },
      data: {
        status: 'running',
        publicUrl: handle.publicUrl,
        bundleVersion,
        deploymentProvider: handle.provider,
        deploymentSandboxId: handle.sandboxId,
        deploymentRegion: handle.region,
        lastEventAt: new Date(),
      },
    });

    const activity = await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'deployed',
      message: `Deployed v${bundleVersion} — live at ${handle.publicUrl}.`,
    });
    broadcastToOwner(session.userId, { type: 'activity', payload: activity });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'running' });

    return reply.send({
      ok: true,
      operationId: op.id,
      bundleVersion,
      publicUrl: handle.publicUrl,
      handle,
    });
  });
}
