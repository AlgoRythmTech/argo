import type { FastifyInstance } from 'fastify';
import { getRedis } from '../db/redis.js';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const checks: Record<string, 'ok' | 'fail'> = { api: 'ok' };

    try {
      await getPrisma().$queryRaw`SELECT 1`;
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'fail';
    }

    try {
      const { db } = await getMongo();
      await db.command({ ping: 1 });
      checks.mongo = 'ok';
    } catch {
      checks.mongo = 'fail';
    }

    try {
      await getRedis().ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
    }

    const status = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'degraded';
    return { status, checks, uptime: Math.round(process.uptime()) };
  });
}
