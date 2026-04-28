import type Redis from 'ioredis';

/**
 * Token-bucket rate limiter backed by Redis. Used by the API for per-IP
 * limits on form ingest and webhooks.
 *
 * Section 12 defaults:
 *   - 60 req/min per IP for forms
 *   - 1000 req/min per IP for webhooks
 *   - 600 req/min per IP for API
 */

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
};

export type RateLimitConfig = {
  /** Identifier — usually the IP. */
  key: string;
  /** Logical scope — `form`, `webhook`, `api`, etc. */
  scope: string;
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export async function rateLimitFixedWindow(
  redis: Redis,
  config: RateLimitConfig,
): Promise<RateLimitDecision> {
  const bucket = `argo:rl:${config.scope}:${config.key}:${Math.floor(Date.now() / (config.windowSeconds * 1000))}`;
  const tx = redis.multi();
  tx.incr(bucket);
  tx.expire(bucket, config.windowSeconds);
  const result = await tx.exec();
  if (!result) {
    return { allowed: false, remaining: 0, resetSeconds: config.windowSeconds };
  }
  // Redis multi().exec() returns an array of [error, result] pairs.
  // For ioredis, each element is [error, value] or just the value depending on version.
  const incrResult = result[0];
  const count = typeof incrResult === 'number'
    ? incrResult
    : Array.isArray(incrResult)
      ? Number(incrResult[1] ?? incrResult[0] ?? 0)
      : Number(incrResult ?? 0);
  const remaining = Math.max(0, config.limit - count);
  return {
    allowed: count <= config.limit,
    remaining,
    resetSeconds: config.windowSeconds,
  };
}
