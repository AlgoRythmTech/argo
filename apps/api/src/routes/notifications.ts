// Notifications inbox — the in-app surface for everything Argo emails the
// operator about. Email is still the primary channel (master prompt §8),
// but operators want a desktop inbox they can check on their monthly
// visit. Backed by the activity_feed collection plus a per-entry
// readAt timestamp.

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';

const ListQuery = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  kind: z.string().min(1).max(80).optional(),
  operationId: z.string().min(1).max(80).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function registerNotificationsRoutes(app: FastifyInstance) {
  app.get('/api/notifications', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = ListQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });

    const { db } = await getMongo();
    const filter: Record<string, unknown> = { ownerId: session.userId };
    if (parsed.data.unreadOnly === 'true') filter.readAt = { $in: [null, undefined] };
    if (parsed.data.kind) filter.kind = parsed.data.kind;
    if (parsed.data.operationId) filter.operationId = parsed.data.operationId;
    if (parsed.data.q) {
      filter.$or = [
        { message: { $regex: parsed.data.q, $options: 'i' } },
        { operationName: { $regex: parsed.data.q, $options: 'i' } },
      ];
    }

    const limit = parsed.data.limit ?? 100;
    const docs = await db
      .collection('activity_feed')
      .find(filter)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .toArray();
    const unreadCount = await db
      .collection('activity_feed')
      .countDocuments({ ownerId: session.userId, readAt: { $in: [null, undefined] } });

    return reply.send({
      unreadCount,
      notifications: docs.map((d) => ({
        id: String(d.id ?? ''),
        operationId: (d.operationId as string | null) ?? null,
        operationName: (d.operationName as string | null) ?? null,
        kind: String(d.kind ?? ''),
        message: String(d.message ?? ''),
        occurredAt: String(d.occurredAt ?? ''),
        readAt: (d.readAt as string | null) ?? null,
      })),
    });
  });

  app.post('/api/notifications/:id/read', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const { db } = await getMongo();
    await db
      .collection('activity_feed')
      .updateOne(
        { id, ownerId: session.userId },
        { $set: { readAt: new Date().toISOString() } },
      );
    return reply.send({ ok: true });
  });

  app.post('/api/notifications/mark-all-read', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { db } = await getMongo();
    const now = new Date().toISOString();
    const result = await db
      .collection('activity_feed')
      .updateMany(
        { ownerId: session.userId, readAt: { $in: [null, undefined] } },
        { $set: { readAt: now } },
      );
    return reply.send({ ok: true, marked: result.modifiedCount });
  });
}
