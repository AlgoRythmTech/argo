import type { WorkflowMap } from '@argo/shared-types';

/**
 * The static scaffolding files: package.json, tsconfig, server entry point.
 * These are NOT argo:generated — they don't get touched by the repair worker.
 */

export function scaffoldPackageJson(map: WorkflowMap): string {
  return JSON.stringify(
    {
      name: `argo-op-${map.operationName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`,
      version: '1.0.0',
      private: true,
      type: 'module',
      main: 'server.js',
      scripts: {
        start: 'node server.js',
      },
      dependencies: {
        fastify: '^4.28.1',
        '@fastify/cors': '^9.0.1',
        '@fastify/helmet': '^11.1.1',
        '@fastify/rate-limit': '^9.1.0',
        '@fastify/sensible': '^5.6.0',
        zod: '^3.23.8',
        mongodb: '^6.8.0',
        bullmq: '^5.12.10',
        ioredis: '^5.4.1',
        nanoid: '^5.0.7',
        pino: '^9.3.2',
        croner: '^8.1.0',
        undici: '^6.19.5',
      },
      engines: { node: '>=20.10.0' },
    },
    null,
    2,
  );
}

export function scaffoldServerEntry(): string {
  return `// argo:scaffolding — static entry, edit only via repair-flow
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import pino from 'pino';
import { registerHealthRoute } from './routes/health.js';
import { registerFormRoute } from './routes/form.js';
import { registerApprovalRoute } from './routes/approval.js';
import { registerInternalRoutes } from './routes/internal.js';
import { startScheduler } from './jobs/scheduler.js';
import { startObservability } from './observability/sidecar.js';
import { connectMongo } from './lib/mongo.js';

const log = pino({ name: 'argo-runtime', level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  const app = Fastify({ logger: log, trustProxy: true, bodyLimit: 2_000_000 });
  await app.register(helmet, { global: true });
  await app.register(cors, { origin: '*', methods: ['GET', 'POST', 'OPTIONS'] });
  await app.register(sensible);
  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: '1 minute',
  });

  const mongo = await connectMongo();
  app.decorate('mongo', mongo);

  registerHealthRoute(app);
  registerFormRoute(app);
  registerApprovalRoute(app);
  registerInternalRoutes(app);

  startScheduler(app);
  startObservability(app);

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'argo-runtime listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal', err);
  process.exit(1);
});
`;
}

export function scaffoldHealthRoute(): string {
  return `// argo:scaffolding
export function registerHealthRoute(app) {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
}
`;
}

export function scaffoldMongoLib(): string {
  return `// argo:scaffolding
import { MongoClient } from 'mongodb';
let cached = null;
export async function connectMongo() {
  if (cached) return cached;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'argo_runtime');
  cached = { client, db };
  return cached;
}
`;
}

export function scaffoldInternalRoute(): string {
  return `// argo:scaffolding
import { createHash, timingSafeEqual } from 'node:crypto';
export function registerInternalRoutes(app) {
  app.post('/internal/event', async (request, reply) => {
    const auth = request.headers['x-argo-internal'];
    const expected = process.env.INTERNAL_API_KEY;
    if (!auth || !expected) return reply.code(401).send({ error: 'unauthorized' });
    const a = createHash('sha256').update(String(auth)).digest();
    const b = createHash('sha256').update(expected).digest();
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    // Forward into mongo for the observability worker.
    const event = request.body;
    await app.mongo.db.collection('runtime_events').insertOne({
      ...event,
      ingestedAt: new Date().toISOString(),
    });
    return { ok: true };
  });
}
`;
}
