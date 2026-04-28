import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { logger } from '../logger.js';

const COLLECTION = 'operation_env_vars';

const SetEnvBody = z.object({
  key: z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid env var key'),
  value: z.string().max(10_000),
});

function encryptValue(raw: string): string {
  // v1: base64-encode. Real encryption is a follow-up.
  return Buffer.from(raw, 'utf-8').toString('base64');
}

export async function registerEnvVarsRoutes(app: FastifyInstance) {
  /**
   * GET /api/operations/:id/env
   * List all env vars for an operation (values masked).
   */
  app.get('/api/operations/:id/env', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const operationId = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const docs = await db
      .collection(COLLECTION)
      .find({ operationId, ownerId: session.userId })
      .sort({ key: 1 })
      .toArray();

    return docs.map((d) => ({
      key: d.key,
      maskedValue: '*****',
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  });

  /**
   * POST /api/operations/:id/env
   * Set or update an env var.
   */
  app.post('/api/operations/:id/env', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const operationId = String((request.params as { id: string }).id);
    const parsed = SetEnvBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const op = await getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const now = new Date().toISOString();
    const encryptedValue = encryptValue(parsed.data.value);

    await db.collection(COLLECTION).updateOne(
      { operationId, ownerId: session.userId, key: parsed.data.key },
      {
        $set: {
          encryptedValue,
          updatedAt: now,
        },
        $setOnInsert: {
          operationId,
          ownerId: session.userId,
          key: parsed.data.key,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    logger.info({ operationId, key: parsed.data.key }, 'env var set');
    return reply.send({ ok: true, key: parsed.data.key });
  });

  /**
   * DELETE /api/operations/:id/env/:key
   * Remove an env var.
   */
  app.delete('/api/operations/:id/env/:key', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { id: operationId, key } = request.params as { id: string; key: string };
    const op = await getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const result = await db.collection(COLLECTION).deleteOne({
      operationId,
      ownerId: session.userId,
      key,
    });

    if (result.deletedCount === 0) {
      return reply.code(404).send({ error: 'env_var_not_found' });
    }

    logger.info({ operationId, key }, 'env var deleted');
    return reply.send({ ok: true });
  });
}

/**
 * Helper used by the deploy route to load env overrides for an operation.
 * Returns a plain { KEY: value } object with decrypted values.
 */
export async function loadEnvOverrides(operationId: string, ownerId: string): Promise<Record<string, string>> {
  const { db } = await getMongo();
  const docs = await db
    .collection(COLLECTION)
    .find({ operationId, ownerId })
    .toArray();

  const overrides: Record<string, string> = {};
  for (const d of docs) {
    try {
      overrides[d.key] = Buffer.from(d.encryptedValue, 'base64').toString('utf-8');
    } catch {
      logger.warn({ operationId, key: d.key }, 'failed to decode env var value');
    }
  }
  return overrides;
}
