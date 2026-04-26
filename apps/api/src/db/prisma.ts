import { PrismaClient } from '@prisma/client';
import { logger } from '../logger.js';

let cached: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (cached) return cached;
  cached = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
  cached.$on('warn' as never, (e: unknown) => logger.warn({ prisma: e }, 'prisma warn'));
  cached.$on('error' as never, (e: unknown) => logger.error({ prisma: e }, 'prisma error'));
  return cached;
}

export async function disconnectPrisma() {
  if (cached) {
    await cached.$disconnect();
    cached = null;
  }
}
