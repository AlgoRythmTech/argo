import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { getMongo } from './db/mongo.js';
import { getPrisma, disconnectPrisma } from './db/prisma.js';
import { getRedis } from './db/redis.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOperationsRoutes } from './routes/operations.js';
import { registerBuilderRoutes } from './routes/builder.js';
import { registerDeployRoutes } from './routes/deploy.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerRepairsRoutes } from './routes/repairs.js';
import { registerBuildStreamRoutes } from './routes/build-stream.js';
import { registerScopingRoutes } from './routes/scoping.js';
import { registerNotificationsRoutes } from './routes/notifications.js';
import { registerReplayRoutes } from './routes/replay.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerDevRoutes } from './routes/dev.js';
import { registerAuthPlugin } from './plugins/auth-plugin.js';
import { attachSocketIo } from './realtime/socket.js';
import { startDigestWorker } from './jobs/digest-worker.js';
import { startInboundWorker } from './jobs/inbound-worker.js';
import { startRepairDetector, startRepairWorker } from './jobs/repair-worker.js';

async function main() {
  const cfg = getConfig();

  // Cast through `unknown` to widen the Pino-narrowed FastifyInstance back
  // to the default-shaped one our route registrars expect. This is a known
  // friction with Fastify v4 + a custom Pino logger instance.
  const app = Fastify({
    logger: logger as never,
    trustProxy: true,
    bodyLimit: 4_000_000,
    disableRequestLogging: cfg.NODE_ENV === 'production',
  }) as unknown as FastifyInstance;

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: cfg.API_CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(cookie, { secret: cfg.COOKIE_SECRET });
  await app.register(sensible);
  await app.register(rateLimit, {
    global: false,
    max: cfg.RATE_LIMIT_API_PER_MINUTE,
    timeWindow: '1 minute',
    redis: getRedis(),
  });

  await registerAuthPlugin(app);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerOperationsRoutes(app);
  await registerBuilderRoutes(app);
  await registerDeployRoutes(app);
  await registerInternalRoutes(app);
  await registerWebhookRoutes(app);
  await registerRepairsRoutes(app);
  await registerBuildStreamRoutes(app);
  await registerScopingRoutes(app);
  await registerNotificationsRoutes(app);
  await registerReplayRoutes(app);
  await registerBillingRoutes(app);
  await registerMemoryRoutes(app);
  await registerDevRoutes(app);

  // Eager init.
  await getMongo();
  await getPrisma().$connect();

  await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
  logger.info({ port: cfg.API_PORT, env: cfg.NODE_ENV }, 'argo-api listening');

  attachSocketIo(app.server, cfg.API_CORS_ORIGINS.split(',').map((s) => s.trim()));

  startDigestWorker();
  startInboundWorker();
  startRepairDetector();
  startRepairWorker();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      logger.info({ sig }, 'shutting down');
      await app.close();
      await disconnectPrisma();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'fatal during boot');
  process.exit(1);
});
