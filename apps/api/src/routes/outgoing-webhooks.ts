import { z } from 'zod';
import { nanoid } from 'nanoid';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { logger } from '../logger.js';

const WEBHOOK_EVENTS = [
  'submission.received',
  'approval.granted',
  'approval.declined',
  'error.detected',
  'repair.proposed',
  'deploy.completed',
] as const;

const CreateWebhookBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(8).max(256).optional(),
});

const UpdateWebhookBody = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  secret: z.string().min(8).max(256).optional(),
  enabled: z.boolean().optional(),
});

function hashSecret(secret: string): string {
  return createHmac('sha256', 'argo-webhook-salt').update(secret).digest('hex');
}

export async function registerOutgoingWebhooksRoutes(app: FastifyInstance) {
  /** Verify the caller owns the operation. */
  async function resolveOp(operationId: string, userId: string) {
    return getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: userId },
    });
  }

  // ── LIST ────────────────────────────────────────────────────────────
  app.get('/api/operations/:id/webhooks', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };

    const op = await resolveOp(id, session.userId);
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const docs = await db
      .collection('operation_webhooks')
      .find({ operationId: id, ownerId: session.userId })
      .sort({ createdAt: -1 })
      .toArray();

    // Never expose the secret hash to the client.
    const sanitized = docs.map(({ secretHash: _, ...rest }) => rest);
    return sanitized;
  });

  // ── CREATE ──────────────────────────────────────────────────────────
  app.post('/api/operations/:id/webhooks', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };

    const op = await resolveOp(id, session.userId);
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const parsed = CreateWebhookBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const now = new Date().toISOString();
    const doc = {
      id: nanoid(),
      operationId: id,
      ownerId: session.userId,
      url: parsed.data.url,
      events: parsed.data.events,
      secretHash: parsed.data.secret ? hashSecret(parsed.data.secret) : null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    const { db } = await getMongo();
    await db.collection('operation_webhooks').insertOne(doc);

    const { secretHash: _, ...safe } = doc;
    return reply.code(201).send(safe);
  });

  // ── UPDATE ──────────────────────────────────────────────────────────
  app.patch('/api/operations/:id/webhooks/:webhookId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { id, webhookId } = request.params as { id: string; webhookId: string };

    const op = await resolveOp(id, session.userId);
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const parsed = UpdateWebhookBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const { db } = await getMongo();
    const existing = await db.collection('operation_webhooks').findOne({ id: webhookId, operationId: id, ownerId: session.userId });
    if (!existing) return reply.code(404).send({ error: 'webhook_not_found' });

    const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (parsed.data.url !== undefined) $set.url = parsed.data.url;
    if (parsed.data.events !== undefined) $set.events = parsed.data.events;
    if (parsed.data.secret !== undefined) $set.secretHash = hashSecret(parsed.data.secret);
    if (parsed.data.enabled !== undefined) $set.enabled = parsed.data.enabled;

    await db.collection('operation_webhooks').updateOne({ id: webhookId }, { $set });

    const updated = await db.collection('operation_webhooks').findOne({ id: webhookId });
    if (!updated) return reply.code(404).send({ error: 'webhook_not_found' });
    const { secretHash: _, ...safe } = updated;
    return safe;
  });

  // ── DELETE ──────────────────────────────────────────────────────────
  app.delete('/api/operations/:id/webhooks/:webhookId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { id, webhookId } = request.params as { id: string; webhookId: string };

    const op = await resolveOp(id, session.userId);
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const result = await db.collection('operation_webhooks').deleteOne({ id: webhookId, operationId: id, ownerId: session.userId });
    if (result.deletedCount === 0) return reply.code(404).send({ error: 'webhook_not_found' });

    return reply.code(204).send();
  });

  // ── TEST ────────────────────────────────────────────────────────────
  app.post('/api/operations/:id/webhooks/:webhookId/test', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { id, webhookId } = request.params as { id: string; webhookId: string };

    const op = await resolveOp(id, session.userId);
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const webhook = await db.collection('operation_webhooks').findOne({ id: webhookId, operationId: id, ownerId: session.userId });
    if (!webhook) return reply.code(404).send({ error: 'webhook_not_found' });

    const testPayload = {
      event: 'test',
      operationId: id,
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery from Argo.' },
    };

    const body = JSON.stringify(testPayload);
    const headers: Record<string, string> = { 'content-type': 'application/json' };

    if (webhook.secretHash) {
      // We can't recover the original secret from the hash, so we sign
      // with the hash itself (same approach the dispatcher uses).
      const signature = createHmac('sha256', String(webhook.secretHash)).update(body).digest('hex');
      headers['x-argo-signature'] = signature;
    }

    try {
      const { request: undiciRequest } = await import('undici');
      const res = await undiciRequest(webhook.url, {
        method: 'POST',
        headers,
        body,
        headersTimeout: 10_000,
        bodyTimeout: 10_000,
      });
      return reply.send({
        ok: true,
        statusCode: res.statusCode,
        message: `Test payload delivered. Endpoint responded with ${res.statusCode}.`,
      });
    } catch (err) {
      logger.warn({ err, webhookId, url: webhook.url }, 'test webhook delivery failed');
      return reply.code(502).send({
        ok: false,
        error: 'delivery_failed',
        detail: String(err).slice(0, 400),
      });
    }
  });
}
