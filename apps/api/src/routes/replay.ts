// Replay endpoints — Section 16's "Replay Test" acceptance criterion.
//
//   GET /api/replay/invocations         list every agent invocation by owner
//   GET /api/replay/invocations/:id     full envelope + raw response

import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';
import { requireSession } from '../plugins/auth-plugin.js';

export async function registerReplayRoutes(app: FastifyInstance) {
  app.get('/api/replay/invocations', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const operationId = String((request.query as { operationId?: string }).operationId ?? '').trim();
    const kind = String((request.query as { kind?: string }).kind ?? '').trim();
    const limit = Math.min(
      Math.max(Number((request.query as { limit?: string }).limit) || 50, 1),
      200,
    );

    const ops = await getPrisma().operation.findMany({
      where: { ownerId: session.userId },
      select: { id: true, name: true },
    });
    const ownedIds = new Set(ops.map((o: { id: string; name: string }) => o.id));
    if (operationId && !ownedIds.has(operationId)) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const { db } = await getMongo();
    const filter: Record<string, unknown> = operationId
      ? { operationId }
      : { operationId: { $in: Array.from(ownedIds) } };
    if (kind) filter.kind = kind;

    const docs = await db
      .collection('agent_invocations')
      .find(filter)
      .project({
        id: 1,
        operationId: 1,
        kind: 1,
        status: 1,
        provider: 1,
        model: 1,
        durationMs: 1,
        promptTokens: 1,
        completionTokens: 1,
        costUsd: 1,
        createdAt: 1,
        completedAt: 1,
        errorMessage: 1,
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const opNameById = new Map(ops.map((o: { id: string; name: string }) => [o.id, o.name]));
    return reply.send({
      invocations: docs.map((d) => ({
        id: String(d.id ?? ''),
        operationId: (d.operationId as string | null) ?? null,
        operationName: d.operationId ? opNameById.get(String(d.operationId)) ?? null : null,
        kind: String(d.kind ?? ''),
        status: String(d.status ?? ''),
        provider: String(d.provider ?? ''),
        model: String(d.model ?? ''),
        durationMs: (d.durationMs as number | null) ?? null,
        promptTokens: (d.promptTokens as number | null) ?? null,
        completionTokens: (d.completionTokens as number | null) ?? null,
        costUsd: (d.costUsd as number | null) ?? null,
        createdAt: String(d.createdAt ?? ''),
        completedAt: (d.completedAt as string | null) ?? null,
        errorMessage: (d.errorMessage as string | null) ?? null,
      })),
    });
  });

  app.get('/api/replay/invocations/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const { db } = await getMongo();
    const doc = await db.collection('agent_invocations').findOne({ id });
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    if (doc.ownerId !== session.userId) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return reply.send(doc);
  });
}
