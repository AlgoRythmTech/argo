import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config.js';

/**
 * Internal-API guard. Used for inbound calls from the customer's deployed
 * runtime (form submissions, observability events, approval clicks, digest
 * ticks). The shared key INTERNAL_API_KEY is rotated quarterly.
 */
export function requireInternalKey(request: FastifyRequest, reply: FastifyReply): boolean {
  const cfg = getConfig();
  const provided = request.headers['x-argo-internal'];
  if (!provided || Array.isArray(provided)) {
    reply.code(401).send({ error: 'missing_internal_key' });
    return false;
  }
  const a = createHash('sha256').update(String(provided)).digest();
  const b = createHash('sha256').update(cfg.INTERNAL_API_KEY).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: 'bad_internal_key' });
    return false;
  }
  return true;
}
