import type { FastifyInstance } from 'fastify';
import { createEmailAutomationService, parseInboundIntent } from '@argo/email-automation';
import { getMongo } from '../db/mongo.js';
import { logger } from '../logger.js';

const emailService = createEmailAutomationService();

/**
 * Inbound AgentMail webhook. Verifies the signature, parses the email,
 * extracts an intent (deterministic-first heuristic from
 * @argo/email-automation), and persists for the agent to act on.
 *
 * This is the entry point for Maya's free-text replies — the magic
 * moment in the demo.
 */
export async function registerWebhookRoutes(app: FastifyInstance) {
  // Capture raw body for signature verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = body.length === 0 ? {} : JSON.parse(String(body));
        (req as unknown as { rawBody: string }).rawBody = String(body);
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post('/webhooks/agentmail/inbound', async (request, reply) => {
    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';
    const ok = emailService.verifyInboundWebhook({ rawBody, headers: request.headers });
    if (!ok && process.env.NODE_ENV === 'production') {
      return reply.code(401).send({ error: 'bad_signature' });
    }

    const inbound = await emailService.parseInboundWebhook({ rawBody, headers: request.headers });
    const intent = parseInboundIntent(inbound);

    const { db } = await getMongo();
    await db.collection('inbound_emails').insertOne({
      ...inbound,
      intent,
      receivedAt: new Date().toISOString(),
    });

    logger.info({ inboundId: inbound.id, intentKind: intent.kind }, 'inbound email captured');

    // The actual action (fire approval, ask follow-up, etc.) is enqueued so
    // the webhook returns 200 fast.
    const { getInboundQueue } = await import('../jobs/queues.js');
    await getInboundQueue().add('inbound_' + inbound.id, { inboundEmailId: inbound.id });

    return reply.send({ ok: true });
  });

  // Dev-only synthetic inbound for local testing.
  app.post('/dev/email/inbound', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.code(404).send();
    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';
    const inbound = await emailService.parseInboundWebhook({ rawBody, headers: request.headers });
    const intent = parseInboundIntent(inbound);
    const { db } = await getMongo();
    await db.collection('inbound_emails').insertOne({ ...inbound, intent, receivedAt: new Date().toISOString() });
    return reply.send({ ok: true, inbound, intent });
  });
}
