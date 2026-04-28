import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { createExecutionProvider } from '@argo/workspace-runtime';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { broadcastToOwner } from '../realtime/socket.js';
import { logger } from '../logger.js';
import { loadEnvOverrides } from './env-vars.js';

const RollbackBody = z.object({
  targetVersion: z.number().int().min(1),
});

const executionProvider = createExecutionProvider();

export async function registerRollbackRoutes(app: FastifyInstance) {
  /**
   * POST /api/operations/:id/rollback
   * Roll back an operation to a previously-deployed bundle version.
   */
  app.post('/api/operations/:id/rollback', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const operationId = String((request.params as { id: string }).id);
    const parsed = RollbackBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const { targetVersion } = parsed.data;

    const op = await getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const currentVersion = op.bundleVersion ?? 0;
    if (targetVersion >= currentVersion) {
      return reply.code(400).send({
        error: 'invalid_target_version',
        message: `Target version (${targetVersion}) must be less than current version (${currentVersion}).`,
      });
    }

    // Load the target bundle from MongoDB.
    const { db } = await getMongo();
    const bundleDoc = await db.collection('operation_bundles').findOne({
      operationId,
      version: targetVersion,
    });
    if (!bundleDoc) {
      return reply.code(404).send({ error: 'bundle_not_found', targetVersion });
    }

    // Reconstruct the bundle in the shape executionProvider.deploy() expects.
    const bundle = {
      manifest: bundleDoc.manifest,
      files: bundleDoc.files,
    };

    // Set status to deploying.
    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'deploying' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'deploying' });

    // Load user-defined env vars so rollbacks also carry custom overrides.
    const userEnv = await loadEnvOverrides(op.id, session.userId);

    let handle;
    try {
      handle = await executionProvider.deploy({
        operationId: op.id,
        bundle,
        environment: 'production',
        envOverrides: {
          ARGO_CONTROL_PLANE_URL: process.env.API_PUBLIC_URL ?? 'http://host.docker.internal:4000',
          INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? '',
          MONGODB_URI: process.env.MONGODB_URI ?? '',
          MONGODB_DB: `argo_op_${op.id}`,
          ...userEnv,
        },
        onProgress: (evt) => {
          broadcastToOwner(session.userId, { type: 'deploy_progress', operationId: op.id, evt });
        },
      });
    } catch (err) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'failed_build' } });
      logger.error({ err, operationId: op.id, targetVersion }, 'rollback deploy failed');
      return reply.code(502).send({ error: 'rollback_deploy_failed', detail: String(err).slice(0, 400) });
    }

    await getPrisma().operation.update({
      where: { id: op.id },
      data: {
        status: 'running',
        publicUrl: handle.publicUrl,
        bundleVersion: targetVersion,
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
      message: `Rolled back to v${targetVersion} — live at ${handle.publicUrl}.`,
    });
    broadcastToOwner(session.userId, { type: 'activity', payload: activity });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'running' });

    logger.info({ operationId: op.id, targetVersion, publicUrl: handle.publicUrl }, 'rollback complete');

    return reply.send({
      ok: true,
      operationId: op.id,
      bundleVersion: targetVersion,
      rolledBackFrom: currentVersion,
      publicUrl: handle.publicUrl,
      handle,
    });
  });
}
