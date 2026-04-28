import { createHmac } from 'node:crypto';
import { getMongo } from '../db/mongo.js';
import { logger } from '../logger.js';

/**
 * Fire-and-forget webhook dispatcher.
 *
 * Looks up all enabled webhooks for the operation that subscribe to the given
 * event, then delivers JSON payloads with HMAC-SHA256 signatures. Failures
 * are logged but never thrown — callers should not await this if they want
 * fully non-blocking delivery.
 */
export async function dispatchWebhook(
  operationId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  try {
    const { db } = await getMongo();
    const webhooks = await db
      .collection('operation_webhooks')
      .find({
        operationId,
        enabled: true,
        events: event,
      })
      .toArray();

    if (webhooks.length === 0) return;

    const body = JSON.stringify({
      event,
      operationId,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const { request } = await import('undici');

    const deliveries = webhooks.map(async (webhook) => {
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' };

        if (webhook.secretHash) {
          const signature = createHmac('sha256', String(webhook.secretHash))
            .update(body)
            .digest('hex');
          headers['x-argo-signature'] = signature;
        }

        const res = await request(webhook.url, {
          method: 'POST',
          headers,
          body,
          headersTimeout: 10_000,
          bodyTimeout: 10_000,
        });

        // Drain the body so the connection can be reused.
        await res.body.dump();

        if (res.statusCode >= 400) {
          logger.warn(
            { webhookId: webhook.id, url: webhook.url, statusCode: res.statusCode, operationId, event },
            'webhook endpoint returned non-success status',
          );
        }
      } catch (err) {
        logger.warn(
          { err, webhookId: webhook.id, url: webhook.url, operationId, event },
          'webhook delivery failed',
        );
      }
    });

    await Promise.allSettled(deliveries);
  } catch (err) {
    logger.error({ err, operationId, event }, 'dispatchWebhook top-level error');
  }
}
