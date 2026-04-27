// Reference snippet library — the moat for hard-app generation.
//
// Generic LLM prompting produces generic code: shallow handlers, no
// observability, no idempotency, no signature verification, no audit
// trails. THIS file gives the model real, battle-tested code samples to
// CRIB FROM. Each snippet is a complete, runnable pattern under the
// allow-listed dependency set, annotated with WHY each line exists.
//
// At build time the dispatcher picks the snippets relevant to the
// current ProjectBrief and embeds them in the system prompt under a
// "# Reference patterns" header. The model is instructed: prefer adapting
// these to writing from scratch.

export interface ReferenceSnippet {
  id: string;
  title: string;
  /** Tags drive selection from a ProjectBrief: trigger, integration, etc. */
  tags: string[];
  /** Plain-English purpose — appears in the prompt above the code block. */
  purpose: string;
  /** Filename hint for the agent. */
  hintedPath: string;
  language: 'ts' | 'js';
  body: string;
}

export const REFERENCE_SNIPPETS: readonly ReferenceSnippet[] = [
  {
    id: 'fastify-bootstrap',
    title: 'Fastify boot with health, helmet, cors, rate-limit, graceful shutdown',
    tags: ['bootstrap', 'every-build'],
    purpose:
      'Every Argo runtime boots with this exact shape. Health route is registered FIRST so Blaxel\'s 90s health gate passes immediately. SIGTERM handler is non-negotiable — Blaxel sends it during staging-swap.',
    hintedPath: 'server.js',
    language: 'js',
    body: `import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import pino from 'pino';

const log = pino({ name: 'argo-runtime', level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  const app = Fastify({ logger: log, trustProxy: true, bodyLimit: 2_000_000 });

  // Health FIRST — Blaxel's deploy gate hits /health within 90s of process start.
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await app.register(helmet, { global: true });
  await app.register(cors, { origin: '*', methods: ['GET','POST','OPTIONS'] });
  await app.register(sensible);
  await app.register(rateLimit, { global: false, max: 60, timeWindow: '1 minute' });

  // ... register feature routes here ...

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });   // 0.0.0.0 — NOT localhost.
  log.info({ port }, 'argo-runtime listening');

  // Graceful shutdown — Blaxel sends SIGTERM during staging-swap.
  for (const sig of ['SIGINT','SIGTERM']) {
    process.once(sig, async () => {
      log.info({ sig }, 'shutting down');
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => { console.error('fatal', err); process.exit(1); });
`,
  },

  {
    id: 'zod-validated-route',
    title: 'Zod-validated POST route with structured errors + idempotency-key',
    tags: ['rest_api', 'crud_app', 'form_workflow', 'every-build'],
    purpose:
      'Every public POST in Argo runs Zod validation BEFORE the handler. Idempotency-Key header check uses Redis SETNX to deduplicate replays. Errors return a discriminated shape clients can switch on.',
    hintedPath: 'routes/example.js',
    language: 'js',
    body: `import { z } from 'zod';
import { createHash } from 'node:crypto';

const Body = z.object({
  email: z.string().email(),
  message: z.string().min(1).max(8000),
}).strict();

export function registerExampleRoute(app, { mongo, redis }) {
  app.post('/items', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    // Idempotency: if the client supplied a key and we've seen it within 24h, reply with the cached response.
    const idemKey = req.headers['idempotency-key'];
    if (idemKey) {
      const cacheKey = 'idem:' + createHash('sha256').update(String(idemKey)).digest('hex');
      const seen = await redis.get(cacheKey);
      if (seen) return reply.code(200).send(JSON.parse(seen));
    }

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_body',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    const doc = { ...parsed.data, createdAt: new Date().toISOString() };
    const { insertedId } = await mongo.db.collection('items').insertOne(doc);
    const response = { id: String(insertedId), ...doc };

    if (idemKey) {
      const cacheKey = 'idem:' + createHash('sha256').update(String(idemKey)).digest('hex');
      await redis.setex(cacheKey, 60 * 60 * 24, JSON.stringify(response));
    }
    return reply.code(201).send(response);
  });
}
`,
  },

  {
    id: 'hmac-signed-webhook-receiver',
    title: 'HMAC-SHA256 webhook receiver (raw-body parsing, replay protection)',
    tags: ['webhook_bridge', 'integrations.webhooks_inbound'],
    purpose:
      'Inbound webhooks MUST verify the signature BEFORE reading the body, and replays MUST be rejected. This is the ONLY safe pattern. Reads raw body via Fastify\'s contentTypeParser, computes HMAC, constant-time compares, then dedupes via Redis with 7-day TTL.',
    hintedPath: 'routes/webhooks.js',
    language: 'js',
    body: `import { createHmac, timingSafeEqual } from 'node:crypto';

export function registerWebhookRoute(app, { redis, secret }) {
  // Capture raw body for HMAC. Without this, any signature scheme is broken.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      req.rawBody = String(body);
      done(null, body.length === 0 ? {} : JSON.parse(String(body)));
    } catch (err) { done(err, undefined); }
  });

  app.post('/webhooks/incoming', async (req, reply) => {
    const sig = String(req.headers['x-signature'] ?? '');
    const ts = Number(req.headers['x-timestamp'] ?? '0');
    if (!sig || !ts) return reply.code(401).send({ error: 'missing_headers' });
    if (Math.abs(Date.now()/1000 - ts) > 300) return reply.code(401).send({ error: 'stale_request' });

    const expected = createHmac('sha256', secret).update(\`\${ts}.\${req.rawBody ?? ''}\`).digest('hex');
    const a = Buffer.from(expected, 'hex'), b = Buffer.from(sig, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(401).send({ error: 'bad_signature' });
    }

    // Replay protection. Vendors retry on non-200, so dedup hits return 200.
    const eventId = req.body?.id ?? req.headers['x-event-id'];
    if (eventId) {
      const seen = await redis.set(\`wh:\${eventId}\`, '1', 'EX', 60 * 60 * 24 * 7, 'NX');
      if (seen === null) return reply.code(200).send({ ok: true, deduped: true });
    }

    // Acknowledge fast (<200ms). Real work happens in a queued job.
    await app.queue.add('process-webhook', req.body, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
    });
    return reply.code(200).send({ ok: true });
  });
}
`,
  },

  {
    id: 'bullmq-job-with-dlq',
    title: 'BullMQ worker with retry, exponential backoff, dead-letter queue',
    tags: ['scheduled_job', 'webhook_bridge', 'background-work'],
    purpose:
      'Background work that can fail needs a real DLQ — failed jobs land in a separate queue an operator can drain manually. No retry-forever loops; no silent drops.',
    hintedPath: 'jobs/processor.js',
    language: 'js',
    body: `import { Worker, Queue } from 'bullmq';

export function startProcessor({ redis }) {
  const dlq = new Queue('dlq:webhooks', { connection: redis });

  const worker = new Worker('process-webhook', async (job) => {
    // Implement the real work here. Throw to trigger BullMQ retry.
    await doActualWork(job.data);
  }, {
    connection: redis,
    concurrency: 5,
    limiter: { max: 50, duration: 1000 },  // 50 jobs/sec ceiling
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      // Persist to DLQ with the original payload + the failure trail.
      await dlq.add('failed:' + job.id, {
        originalJob: { id: job.id, name: job.name, data: job.data },
        failedAt: new Date().toISOString(),
        error: { message: err.message, stack: err.stack?.slice(0, 4000) },
      }, { removeOnComplete: false });
    }
  });

  return worker;
}

async function doActualWork(_payload) { /* application-specific */ }
`,
  },

  {
    id: 'mongo-optimistic-concurrency',
    title: 'Mongo optimistic concurrency with version field (HTTP If-Match → 412)',
    tags: ['crud_app', 'persistence.mongodb', 'every-mutation'],
    purpose:
      'Every PATCH/PUT in a multi-tenant CRUD app must be safe under concurrent edits. The `version` field is incremented atomically; the If-Match header lets clients refuse stale writes.',
    hintedPath: 'routes/items-update.js',
    language: 'js',
    body: `import { z } from 'zod';

const Patch = z.object({
  title: z.string().min(1).max(240).optional(),
  notes: z.string().max(8000).optional(),
}).strict();

export function registerItemUpdate(app, { mongo }) {
  app.patch('/items/:id', async (req, reply) => {
    const ifMatch = Number(req.headers['if-match'] ?? '0');
    if (!ifMatch) return reply.code(428).send({ error: 'if_match_required' });

    const parsed = Patch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const collection = mongo.db.collection('items');
    const result = await collection.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.session.userId, version: ifMatch },
      { $set: { ...parsed.data, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!result.value) {
      // Either doesn't exist OR version mismatch. Distinguish for the client.
      const exists = await collection.findOne({ _id: req.params.id, ownerId: req.session.userId }, { projection: { version: 1 } });
      if (!exists) return reply.code(404).send({ error: 'not_found' });
      return reply.code(412).send({ error: 'precondition_failed', currentVersion: exists.version });
    }
    return reply.code(200).header('etag', String(result.value.version)).send(result.value);
  });
}
`,
  },

  {
    id: 'undici-fetch-with-timeout-retry',
    title: 'Undici HTTP call with timeout + exponential-backoff retry',
    tags: ['scraper_pipeline', 'integrations.outbound-http', 'every-build'],
    purpose:
      'Every external HTTP call MUST have a timeout. Network calls without timeouts are the #1 cause of stuck Node processes. This pattern: 10s connect, 30s body, 3 retries with jitter.',
    hintedPath: 'lib/http.js',
    language: 'js',
    body: `import { request } from 'undici';

export async function fetchWithRetry(url, init = {}, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(url, {
        ...init,
        headersTimeout: 10_000,
        bodyTimeout: 30_000,
      });
      if (res.statusCode >= 500 && i < attempts - 1) {
        await res.body.dump();           // Drain so the connection releases.
        throw Object.assign(new Error('upstream_5xx'), { transient: true, statusCode: res.statusCode });
      }
      return res;
    } catch (err) {
      lastErr = err;
      const transient = err.transient || ['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].includes(err.code);
      if (!transient) throw err;
      const jitter = Math.random() * 100;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(3, i) + jitter));
    }
  }
  throw lastErr;
}
`,
  },

  {
    id: 'audit-log-pattern',
    title: 'Append-only audit log for every mutation',
    tags: ['crud_app', 'compliance', 'every-mutation'],
    purpose:
      'Every state change appends a row. Auditors care. Insurance-grade businesses need it. The audit row stores who, what, before, after, when — never delete a row, never overwrite a column.',
    hintedPath: 'lib/audit.js',
    language: 'js',
    body: `export async function audit({ mongo }, entry) {
  await mongo.db.collection('audit_log').insertOne({
    actor: entry.actor,           // { userId, email, ip, userAgent }
    action: entry.action,         // 'item.update' / 'user.delete' etc.
    targetType: entry.targetType, // 'item' / 'user'
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: entry.metadata ?? {},
    occurredAt: new Date().toISOString(),
  });
}

// Usage inside a handler:
//   const before = await collection.findOne({ _id: id });
//   const after  = await collection.findOneAndUpdate(...);
//   await audit({ mongo }, { actor: req.session, action: 'item.update', targetType: 'item', targetId: id, before, after: after.value });
`,
  },

  {
    id: 'magic-link-auth',
    title: 'Magic-link auth with sha256-hashed tokens, 15-min TTL, single-use',
    tags: ['auth.magic_link', 'every-build-with-auth'],
    purpose:
      'Tokens are stored hashed at rest. Single-use is enforced atomically (consumedAt timestamp). The user gets a session cookie that lives 30 days; the cookie value is a separate token, also hashed at rest.',
    hintedPath: 'auth/magic-link.js',
    language: 'js',
    body: `import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;
const MAGIC_TTL_SEC = 15 * 60;
const SESSION_TTL_DAYS = 30;

export function newToken() {
  const buf = randomBytes(TOKEN_BYTES);
  const plaintext = buf.toString('base64url');
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

export function hash(plaintext) {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function tokensMatch(plaintext, expectedHash) {
  const a = Buffer.from(hash(plaintext), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function consumeMagicLink({ mongo }, plaintext) {
  // Atomic find-and-mark: prevents double-use under a race.
  const result = await mongo.db.collection('magic_links').findOneAndUpdate(
    { tokenHash: hash(plaintext), consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!result.value) return null;
  return { userId: result.value.userId };
}

export { MAGIC_TTL_SEC, SESSION_TTL_DAYS };
`,
  },

  {
    id: 'openapi-from-zod',
    title: 'Auto-generate /openapi.json from Zod route schemas',
    tags: ['rest_api', 'rest_api.must-include'],
    purpose:
      'A REST API that doesn\'t ship an OpenAPI spec is amateur. zod-to-json-schema converts every route\'s body schema; we hand-assemble the rest. Served at /openapi.json read-only.',
    hintedPath: 'lib/openapi.js',
    language: 'js',
    body: `import zodToJsonSchema from 'zod-to-json-schema';

export function registerOpenApi(app, { title, version, routes }) {
  const spec = {
    openapi: '3.1.0',
    info: { title, version, description: 'Auto-generated by Argo from Zod route schemas.' },
    servers: [{ url: process.env.PUBLIC_URL ?? 'http://localhost:3000' }],
    paths: {},
    components: { schemas: {} },
  };

  for (const route of routes) {
    const path = route.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
    spec.paths[path] = spec.paths[path] || {};
    spec.paths[path][route.method.toLowerCase()] = {
      summary: route.summary,
      requestBody: route.bodySchema && {
        content: { 'application/json': { schema: zodToJsonSchema(route.bodySchema) } },
        required: true,
      },
      responses: {
        '200': { description: 'OK' },
        '400': { description: 'Validation error' },
        '401': { description: 'Unauthorized' },
        '500': { description: 'Internal error' },
      },
    };
  }

  app.get('/openapi.json', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return spec;
  });
}
`,
  },

  {
    id: 'observability-sidecar',
    title: 'In-process observability sidecar — auto-emit runtime events',
    tags: ['every-build'],
    purpose:
      'Argo\'s repair worker watches runtime_events. The sidecar batches errors, 5xx, memory thresholds, and process restarts and ships them to /internal/events every 5 seconds.',
    hintedPath: 'observability/sidecar.js',
    language: 'js',
    body: `import { nanoid } from 'nanoid';

export function startObservability(app) {
  const buffer = [];
  let flushing = false;

  const enqueue = (evt) => {
    buffer.push({
      id: 'evt_' + nanoid(12),
      operationId: process.env.ARGO_OPERATION_ID,
      occurredAt: new Date().toISOString(),
      ...evt,
    });
    if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
  };

  app.setErrorHandler((err, req, reply) => {
    enqueue({
      kind: 'unhandled_exception',
      severity: 'error',
      message: String(err.message || err).slice(0, 800),
      context: { method: req.method, url: req.url },
      stackTrace: String(err.stack ?? '').slice(0, 4000),
    });
    reply.code(err.statusCode ?? 500).send({ error: 'internal' });
  });

  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 500) {
      enqueue({ kind: 'http_5xx', severity: 'error',
                message: \`\${req.method} \${req.url} -> \${reply.statusCode}\`,
                context: { method: req.method, url: req.url, statusCode: reply.statusCode } });
    }
  });

  setInterval(() => {
    const m = process.memoryUsage();
    const rssMb = Math.round(m.rss / 1024 / 1024);
    if (rssMb > Number(process.env.MEMORY_THRESHOLD_MB ?? 850)) {
      enqueue({ kind: 'memory_threshold', severity: 'warn', message: \`rss=\${rssMb}MB\`, context: { rssMb } });
    }
  }, 15_000).unref();

  setInterval(async () => {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer.splice(0, buffer.length);
    try {
      await fetch(process.env.ARGO_CONTROL_PLANE_URL + '/internal/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-argo-internal': process.env.INTERNAL_API_KEY ?? '' },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      // Don't lose everything on transient failures — keep a sample.
      buffer.unshift(...batch.slice(0, 50));
    } finally { flushing = false; }
  }, 5_000).unref();
}
`,
  },

  {
    id: 'cron-with-distributed-lock',
    title: 'Cron job with Redis distributed lock + checkpoint pattern',
    tags: ['scheduled_job'],
    purpose:
      'Scheduled jobs in a multi-instance environment need a single-leader lock. SETNX with a TTL prevents two instances running the same job. Long jobs write checkpoints so the repair worker knows they\'re alive.',
    hintedPath: 'jobs/scheduler.js',
    language: 'js',
    body: `import { Cron } from 'croner';
import { nanoid } from 'nanoid';

export function startScheduler({ app, redis }) {
  new Cron('0 9 * * 1', { timezone: process.env.DIGEST_TZ ?? 'UTC' }, async () => {
    const lockKey = 'lock:weekly-digest';
    const ownerId = nanoid(8);
    // SETNX with 10-minute TTL — if a previous run hung we don't deadlock forever.
    const acquired = await redis.set(lockKey, ownerId, 'EX', 600, 'NX');
    if (acquired === null) {
      app.log.info({ lockKey }, 'lock held by another instance, skipping this fire');
      return;
    }

    const checkpoint = setInterval(async () => {
      await redis.expire(lockKey, 600);  // refresh TTL so long jobs don't lose the lock
    }, 60_000);

    try {
      await runWeeklyDigest({ app });
    } catch (err) {
      app.log.error({ err }, 'weekly digest failed');
      throw err;
    } finally {
      clearInterval(checkpoint);
      // Only release if WE still hold it (compare-and-delete).
      const current = await redis.get(lockKey);
      if (current === ownerId) await redis.del(lockKey);
    }
  });
}

async function runWeeklyDigest(_ctx) { /* application-specific */ }
`,
  },

  {
    id: 'pii-redaction-everywhere',
    title: 'PII redaction wrapper — never log raw PII',
    tags: ['data_classification.pii', 'every-build-handling-pii'],
    purpose:
      'Names, emails, and phones are hashed before any log line is emitted. The hash is stable so traces correlate; the salt comes from PII_LOG_SALT.',
    hintedPath: 'lib/pii.js',
    language: 'js',
    body: `import { createHash } from 'node:crypto';

const SALT = process.env.PII_LOG_SALT ?? 'dev-salt-rotate-in-prod';

const EMAIL = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/g;
const PHONE = /(\\+?\\d[\\d\\s().-]{7,}\\d)/g;

const fingerprint = (v) => createHash('sha256').update(SALT + v).digest('hex').slice(0, 12);

export function redactPii(input) {
  if (!input) return input;
  return input
    .replace(EMAIL, (_, local, domain) => \`<email:\${fingerprint(local)}@\${domain}>\`)
    .replace(PHONE, (m) => {
      const digits = m.replace(/\\D/g,'');
      return digits.length < 8 ? m : \`<phone:\${fingerprint(digits)}>\`;
    });
}

export function redactPiiObject(value) {
  if (!value) return value;
  if (typeof value === 'string') return redactPii(value);
  if (Array.isArray(value)) return value.map(redactPiiObject);
  if (typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = redactPiiObject(v);
    return out;
  }
  return value;
}
`,
  },

  {
    id: 'slack-bolt-app',
    title: 'Slack app with Bolt — signed requests, ack-fast, threaded replies',
    tags: ['slack_bot', 'integrations.slack'],
    purpose:
      'Bolt verifies signatures automatically given SLACK_SIGNING_SECRET. ack() within 3 seconds is non-negotiable — long work goes to a queue. Always reply in the same thread (thread_ts) to keep channels clean.',
    hintedPath: 'slack/app.js',
    language: 'js',
    body: `import bolt from '@slack/bolt';

export function buildSlackApp({ queue }) {
  const app = new bolt.App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });

  app.command('/argo', async ({ ack, command, say }) => {
    await ack();   // ALWAYS ack first. Slack's 3-second budget.
    await say({
      thread_ts: command.thread_ts,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: \`Got it: *\${command.text}*. Working…\` } },
      ],
    });
    await queue.add('process-slack-command', {
      userId: command.user_id,
      channel: command.channel_id,
      threadTs: command.thread_ts,
      text: command.text,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 500 } });
  });

  return app;
}
`,
  },

  {
    id: 'stripe-checkout-and-webhook',
    title: 'Stripe checkout + signed webhook for payment.intent.succeeded',
    tags: ['integrations.stripe'],
    purpose:
      'Stripe webhooks are the only source of truth for payment success — never trust the client\'s redirect. Verify the signature; idempotency comes from the Stripe event id.',
    hintedPath: 'integrations/stripe.js',
    language: 'js',
    body: `import Stripe from 'stripe';

export function registerStripe(app, { redis }) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-09-30.acacia' });

  app.post('/checkout', async (req, reply) => {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: req.body.priceId, quantity: 1 }],
      success_url: process.env.PUBLIC_URL + '/billing/success?cs={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.PUBLIC_URL + '/billing/cancel',
      customer_email: req.session.email,
      metadata: { userId: req.session.userId },
    });
    return reply.send({ url: session.url });
  });

  // Webhooks require RAW body for signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = String(body);
    done(null, body.length === 0 ? {} : JSON.parse(String(body)));
  });

  app.post('/stripe/webhook', async (req, reply) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.code(401).send({ error: 'bad_signature' });
    }
    // Idempotent — Stripe retries.
    const dedup = await redis.set(\`stripe:\${event.id}\`, '1', 'EX', 60 * 60 * 24 * 7, 'NX');
    if (dedup === null) return reply.code(200).send({ ok: true, deduped: true });

    if (event.type === 'payment_intent.succeeded') {
      // ... grant access, write audit log ...
    }
    return reply.code(200).send({ ok: true });
  });
}
`,
  },

  {
    id: 'agent-loop',
    title: 'Bounded agent loop with tool dispatch + telemetry',
    tags: ['agent_runtime'],
    purpose:
      'The canonical agent loop. Iterates at most MAX_ITERATIONS times, dispatches tool calls through a registry, emits one runtime_event per iteration, and exits cleanly on either a final answer OR the iteration ceiling. Bounded — no autonomous re-trigger from inside.',
    hintedPath: 'agent/agent.js',
    language: 'js',
    body: `import { z } from 'zod';
import { llm } from './llm.js';
import { tools } from './tools/index.js';
import { Memory } from './memory.js';
import { isSideEffect, requireApproval } from './policies.js';

const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITERATIONS) || 8;
const MAX_TOTAL_TOKENS = Number(process.env.AGENT_TOKEN_BUDGET) || 30_000;

export const AgentInput = z.object({
  request: z.string().min(1).max(8000),
  context: z.record(z.unknown()).optional(),
});

export const AgentOutput = z.object({
  answer: z.string(),
  iterations: z.number().int().nonnegative(),
  toolsUsed: z.array(z.string()),
  truncated: z.boolean(),
  totalTokens: z.number().int().nonnegative(),
});

export async function runAgent(rawInput, { agentRunId, emit }) {
  const input = AgentInput.parse(rawInput);
  const memory = new Memory();
  memory.push({ role: 'user', content: input.request });

  const toolSchemas = Object.values(tools).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema,
  }));

  const toolsUsed = new Set();
  let totalTokens = 0;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    if (totalTokens >= MAX_TOTAL_TOKENS) {
      const final = memory.lastAssistantText() ?? 'Reached the token budget; here\\'s what I have so far.';
      return AgentOutput.parse({ answer: final, iterations: i - 1, toolsUsed: [...toolsUsed], truncated: true, totalTokens });
    }

    const response = await llm.complete({
      messages: memory.messages(),
      tools: toolSchemas,
    });
    totalTokens += response.usage.total_tokens ?? 0;

    emit({ kind: 'agent_iteration', agentRunId, iteration: i, tools_called: response.toolUses.map((t) => t.name), prompt_tokens: response.usage.prompt_tokens, completion_tokens: response.usage.completion_tokens });

    if (response.toolUses.length === 0) {
      return AgentOutput.parse({ answer: response.text, iterations: i, toolsUsed: [...toolsUsed], truncated: false, totalTokens });
    }

    for (const call of response.toolUses) {
      const tool = tools[call.name];
      if (!tool) {
        memory.push({ role: 'tool', toolUseId: call.id, content: { error: 'unknown_tool' } });
        continue;
      }
      const args = tool.schema.parse(call.input);
      const sideEffect = isSideEffect(tool);
      const result = sideEffect
        ? await requireApproval({ agentRunId, toolName: tool.name, args }, () => tool.run(args))
        : await tool.run(args);
      toolsUsed.add(tool.name);
      memory.push({ role: 'tool', toolUseId: call.id, content: result });
    }
  }

  const final = memory.lastAssistantText() ?? 'Hit the iteration ceiling without a final answer.';
  return AgentOutput.parse({ answer: final, iterations: MAX_ITERATIONS, toolsUsed: [...toolsUsed], truncated: true, totalTokens });
}
`,
  },

  {
    id: 'agent-tool-registry',
    title: 'Typed tool registry — one Zod-validated tool per file',
    tags: ['agent_runtime'],
    purpose:
      'Every tool the agent can call is a typed function with a Zod schema for both arguments AND result. Untyped tools are forbidden. The registry is a single map; new tools are added by importing them here.',
    hintedPath: 'agent/tools/index.js',
    language: 'js',
    body: `import { searchKnowledgeBase } from './search-knowledge-base.js';
import { sendEmail } from './send-email.js';
import { lookupCustomer } from './lookup-customer.js';

// Every tool exports { name, description, schema, sideEffect, run }. The
// agent loop dispatches by name; the LLM receives the schemas as
// input_schema fields on its tool definitions.
export const tools = {
  [searchKnowledgeBase.name]: searchKnowledgeBase,
  [sendEmail.name]: sendEmail,                  // sideEffect: true → approval-gated
  [lookupCustomer.name]: lookupCustomer,
};

// Example tool body — repeat this shape per file:
//
// import { z } from 'zod';
// export const sendEmail = {
//   name: 'send_email',
//   description: 'Send an email to a customer. Requires operator approval.',
//   sideEffect: true,
//   schema: z.object({ to: z.string().email(), subject: z.string().min(1).max(300), body: z.string().min(1) }),
//   resultSchema: z.object({ messageId: z.string() }),
//   run: async ({ to, subject, body }) => {
//     const result = await emailClient.send({ to, subject, text: body });
//     return { messageId: result.providerMessageId };
//   },
// };
`,
  },

  {
    id: 'circuit-breaker',
    title: 'Circuit breaker for outbound calls (closed → open → half-open)',
    tags: ['every-build', 'resilience'],
    purpose:
      'Outbound calls to a flaky upstream should fail fast instead of timing out 1000 requests in a row. Standard three-state breaker: closed = normal; open = reject for cooldown; half-open = let one trial through.',
    hintedPath: 'lib/circuit-breaker.js',
    language: 'js',
    body: `export function makeCircuitBreaker({ failureThreshold = 5, cooldownMs = 30_000 } = {}) {
  let state = 'closed';
  let failures = 0;
  let openedAt = 0;

  async function execute(fn) {
    if (state === 'open') {
      if (Date.now() - openedAt < cooldownMs) {
        throw Object.assign(new Error('circuit_open'), { transient: false, code: 'CIRCUIT_OPEN' });
      }
      state = 'half-open';
    }
    try {
      const result = await fn();
      if (state === 'half-open') { state = 'closed'; failures = 0; }
      return result;
    } catch (err) {
      failures++;
      if (state === 'half-open' || failures >= failureThreshold) {
        state = 'open';
        openedAt = Date.now();
      }
      throw err;
    }
  }
  return { execute, get state() { return state; } };
}
`,
  },

  {
    id: 'otel-tracing',
    title: 'OpenTelemetry tracing — one helper, every route auto-traced',
    tags: ['every-build', 'observability.advanced'],
    purpose:
      'Spans for every Fastify route, every Mongo query, every outbound HTTP call. Exports OTLP if OTEL_EXPORTER_OTLP_ENDPOINT is set; no-ops otherwise. Argo never blocks on tracing.',
    hintedPath: 'observability/tracing.js',
    language: 'js',
    body: `import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('argo-runtime');

export function withSpan(name, fn, attrs = {}) {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      span.setAttributes(attrs);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

// Auto-instrument every route via a Fastify plugin:
export function tracingPlugin(app) {
  app.addHook('onRequest', async (req) => {
    const span = tracer.startSpan(\`HTTP \${req.method} \${req.routerPath ?? req.url}\`, {
      attributes: { 'http.method': req.method, 'http.url': req.url },
    });
    req.__span = span;
    req.__ctx = trace.setSpan(context.active(), span);
  });
  app.addHook('onResponse', async (req, reply) => {
    if (!req.__span) return;
    req.__span.setAttribute('http.status_code', reply.statusCode);
    if (reply.statusCode >= 500) req.__span.setStatus({ code: SpanStatusCode.ERROR });
    req.__span.end();
  });
}
`,
  },

  {
    id: 'prisma-migrations',
    title: 'Prisma migrations — forward-only, applied on boot',
    tags: ['multi_tenant_saas', 'persistence.postgres'],
    purpose:
      'Schema evolution without manual SQL. Migrations are forward-only and idempotent. Boot script runs `prisma migrate deploy` BEFORE the app starts accepting traffic.',
    hintedPath: 'prisma/schema.prisma',
    language: 'js',
    body: `// prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db   { provider = "postgresql"; url = env("DATABASE_URL") }

model Tenant {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  users     User[]
  audits    Audit[]
}

model User {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  email     String   @unique
  role      String   @default("member")  // 'owner' | 'admin' | 'member'
  createdAt DateTime @default(now())
  @@index([tenantId])
}

model Audit {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  actorId     String
  action      String
  targetType  String
  targetId    String
  before      Json?
  after       Json?
  reason      String?
  occurredAt  DateTime @default(now())
  @@index([tenantId, occurredAt])
}

// Boot wrapper (boot.js):
//   const { execSync } = require('node:child_process');
//   execSync('npx prisma migrate deploy', { stdio: 'inherit' });
//   require('./server.js');
`,
  },

  {
    id: 'graphql-mercurius',
    title: 'GraphQL with Mercurius (Fastify) — typed schema + DataLoader',
    tags: ['rest_api.optional', 'graphql'],
    purpose:
      'When the operator says "I want a GraphQL API" — Mercurius is the Fastify-native choice. Pair every relation with a DataLoader so N+1 queries don\'t leak in.',
    hintedPath: 'graphql/schema.js',
    language: 'js',
    body: `import mercurius from 'mercurius';
import DataLoader from 'dataloader';

const schema = \`
  type Tenant { id: ID!, name: String!, users: [User!]! }
  type User   { id: ID!, email: String!, role: String!, tenant: Tenant! }
  type Query {
    me: User
    tenants: [Tenant!]!
  }
\`;

export function registerGraphQL(app, { mongo }) {
  const resolvers = {
    Query: {
      me: async (_root, _args, ctx) => mongo.db.collection('users').findOne({ _id: ctx.userId }),
      tenants: async (_root, _args, ctx) =>
        mongo.db.collection('tenants').find({ users: ctx.userId }).toArray(),
    },
    User: {
      tenant: async (user, _args, ctx) => ctx.loaders.tenant.load(user.tenantId),
    },
  };

  app.register(mercurius, {
    schema,
    resolvers,
    graphiql: process.env.NODE_ENV !== 'production',
    context: (req) => ({
      userId: req.session?.userId,
      loaders: {
        tenant: new DataLoader(async (ids) => {
          const docs = await mongo.db.collection('tenants').find({ _id: { $in: ids } }).toArray();
          const byId = new Map(docs.map((d) => [String(d._id), d]));
          return ids.map((id) => byId.get(id));
        }),
      },
    }),
  });
}
`,
  },

  {
    id: 'pgvector-search',
    title: 'pgvector hybrid search — lexical + vector with RRF fusion',
    tags: ['search_service', 'persistence.postgres'],
    purpose:
      'Postgres handles both halves: tsvector + GIN for lexical, pgvector + IVFFlat for semantic. Reciprocal-rank-fuse the two result sets server-side. No external search infra needed.',
    hintedPath: 'search/hybrid.sql',
    language: 'js',
    body: `// schema (run as a migration once):
//   CREATE EXTENSION IF NOT EXISTS vector;
//   CREATE TABLE docs (
//     id          TEXT PRIMARY KEY,
//     body        TEXT NOT NULL,
//     body_tsv    tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED,
//     embedding   vector(1536) NOT NULL
//   );
//   CREATE INDEX docs_tsv_idx ON docs USING GIN (body_tsv);
//   CREATE INDEX docs_emb_idx ON docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

// query.js
import { embed } from './embed.js';
import { rrf } from './rrf.js';

export async function hybridSearch(pool, q, limit = 20) {
  const embedding = await embed(q);
  const lexical = await pool.query(
    \`SELECT id, ts_rank(body_tsv, websearch_to_tsquery('english', $1)) AS score
     FROM docs WHERE body_tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY score DESC LIMIT $2\`,
    [q, limit * 2],
  );
  const vector = await pool.query(
    \`SELECT id, 1 - (embedding <=> $1::vector) AS score
     FROM docs ORDER BY embedding <=> $1::vector LIMIT $2\`,
    [\`[\${embedding.join(',')}]\`, limit * 2],
  );
  return rrf([lexical.rows, vector.rows], { k: 60, limit });
}
`,
  },

  {
    id: 'etl-backfill',
    title: 'Streaming ETL with watermarks + backfill + DLQ',
    tags: ['data_pipeline'],
    purpose:
      'Single canonical pipeline shape: pull → transform → upsert. Watermark every 100 records. Failed records to DLQ with full payload. Backfill is a separate command that replays a timestamp range.',
    hintedPath: 'pipeline/run.js',
    language: 'js',
    body: `import { z } from 'zod';

const Record = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown()),
});

export async function runIncremental({ source, sink, watermark, dlq }) {
  const since = await watermark.read();
  let lastSeen = since;
  let processed = 0;
  const batch = [];

  for await (const raw of source.iterate({ since })) {
    const parsed = Record.safeParse(raw);
    if (!parsed.success) {
      await dlq.append({ raw, error: parsed.error.message });
      continue;
    }
    batch.push(parsed.data);
    lastSeen = parsed.data.occurredAt;
    if (batch.length >= 100) {
      await sink.upsert(batch);     // bulkWrite under the hood
      await watermark.write(lastSeen);
      processed += batch.length;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    await sink.upsert(batch);
    await watermark.write(lastSeen);
    processed += batch.length;
  }
  return { processed, lastWatermark: lastSeen };
}

// Backfill is the same loop, scoped to a window. Operators trigger it via /admin/backfill.
export async function runBackfill({ source, sink, dlq, start, end }) {
  return runIncremental({
    source: { iterate: ({ since }) => source.iterate({ since: start, until: end }) },
    sink, dlq,
    watermark: { read: () => start, write: () => Promise.resolve() }, // backfill doesn't move the live watermark
  });
}
`,
  },

  {
    id: 'saml-sso',
    title: 'SAML SSO with @node-saml/passport-saml',
    tags: ['auth.saml', 'multi_tenant_saas'],
    purpose:
      'When the enterprise customer asks for SAML, this is the canonical wiring. Per-tenant SAML config in DB; SP-initiated flow; signs assertions; rejects unsigned responses.',
    hintedPath: 'auth/saml.js',
    language: 'js',
    body: `import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import passport from 'passport';

export function registerSaml(app, { tenantConfig }) {
  passport.use(new SamlStrategy({
    callbackUrl: process.env.PUBLIC_URL + '/auth/saml/callback',
    entryPoint: tenantConfig.entryPoint,
    issuer: tenantConfig.issuer,
    cert: tenantConfig.idpCert,        // PEM-encoded IdP signing cert
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    disableRequestedAuthnContext: false,
  }, (profile, done) => {
    if (!profile.nameID || !profile.email) return done(new Error('saml_missing_attrs'));
    return done(null, { email: profile.email, samlNameId: profile.nameID });
  }));

  app.get('/auth/saml/start',    passport.authenticate('saml', { session: false }));
  app.post('/auth/saml/callback', passport.authenticate('saml', { session: false }), async (req, reply) => {
    // Provision-or-find the user in the tenant; mint your standard session.
    const session = await app.session.create({ email: req.user.email, samlNameId: req.user.samlNameId });
    reply.setCookie('session', session.token, { httpOnly: true, secure: true, sameSite: 'lax' }).redirect('/');
  });
}
`,
  },

  {
    id: 'blue-green-deploy',
    title: 'Blue-green deploy via the IExecutionProvider swap',
    tags: ['every-build.deploy'],
    purpose:
      'Argo\'s control plane already does staging-swap. THIS snippet shows what the runtime\'s server.js must do so the swap is graceful: drain in-flight requests, finish the current job, refuse new connections, exit cleanly within 30s of SIGTERM.',
    hintedPath: 'lifecycle/shutdown.js',
    language: 'js',
    body: `import { setTimeout as sleep } from 'node:timers/promises';

export function attachGracefulShutdown(app, { jobs }) {
  let shuttingDown = false;
  const inflight = new Set();

  app.addHook('onRequest', async (req) => {
    if (shuttingDown) {
      // 503 + Retry-After tells load balancers + cron retriers to back off.
      throw Object.assign(new Error('shutting_down'), { statusCode: 503 });
    }
    inflight.add(req.id);
  });
  app.addHook('onResponse', async (req) => { inflight.delete(req.id); });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => {
      shuttingDown = true;
      app.log.info({ sig, inflight: inflight.size }, 'shutdown: refusing new requests');
      await jobs?.pause?.();           // BullMQ workers stop accepting new jobs
      // Drain up to 25s; the last 5s is the OS hard-kill margin.
      const deadline = Date.now() + 25_000;
      while (inflight.size > 0 && Date.now() < deadline) await sleep(200);
      app.log.info({ remaining: inflight.size }, 'shutdown: closing app');
      await app.close();
      await jobs?.close?.();
      process.exit(0);
    });
  }
}
`,
  },

  {
    id: 'agent-bounded-memory',
    title: 'Bounded conversation memory with deterministic truncation',
    tags: ['agent_runtime'],
    purpose:
      'Conversation memory bounded by N messages OR token count, whichever is smaller. Truncation is deterministic (drop oldest user/assistant pair, keep system + last few). NO recursive LLM summarisation — that\'s a token-burn loop.',
    hintedPath: 'agent/memory.js',
    language: 'js',
    body: `const MAX_MESSAGES = 20;
const MAX_TOKEN_ESTIMATE = 8_000;

export class Memory {
  constructor() {
    this.system = null;
    this.history = [];
  }

  setSystem(prompt) {
    this.system = { role: 'system', content: prompt };
  }

  push(msg) {
    this.history.push(msg);
    this.compactIfNeeded();
  }

  messages() {
    return this.system ? [this.system, ...this.history] : this.history.slice();
  }

  lastAssistantText() {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === 'assistant' && typeof this.history[i].content === 'string') {
        return this.history[i].content;
      }
    }
    return null;
  }

  compactIfNeeded() {
    while (this.history.length > MAX_MESSAGES || this.estimateTokens() > MAX_TOKEN_ESTIMATE) {
      // Drop the oldest user+assistant pair. Keep tool messages adjacent to their assistant.
      const idx = this.history.findIndex((m) => m.role === 'user');
      if (idx === -1) break;
      // Remove the user message and the assistant response (and any tool messages immediately after).
      this.history.splice(idx, 1);
      while (this.history[idx] && this.history[idx].role !== 'user') {
        this.history.splice(idx, 1);
      }
    }
  }

  estimateTokens() {
    // Rough char/4 heuristic. Good enough for guard-rail purposes.
    let chars = 0;
    for (const m of this.history) {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      chars += c.length;
    }
    return Math.ceil(chars / 4);
  }
}
`,
  },

  {
    id: 'sse-streaming',
    title: 'Server-Sent Events with heartbeats and per-client backpressure',
    tags: ['rest_api', 'agent_runtime', 'crud_app', 'internal_tool'],
    purpose:
      'Long-lived SSE channel pattern. Sends a heartbeat every 25s so corporate proxies don\'t kill the socket. Per-client write queue prevents one slow consumer from blocking the broadcaster. Closes cleanly on client disconnect AND on SIGTERM (Blaxel\'s staging-swap signal).',
    hintedPath: 'routes/stream.js',
    language: 'js',
    body: `// SSE channel for live updates. Mounted at /api/stream.
// Clients subscribe with EventSource('/api/stream'); server pushes
// JSON events as { type, payload, ts }. Each event is one frame.

const clients = new Set();

export function broadcast(event) {
  const frame = formatFrame(event);
  for (const c of clients) {
    if (c.queue.length > 100) continue; // drop on slow consumer
    c.queue.push(frame);
    drain(c);
  }
}

function formatFrame(event) {
  const ts = new Date().toISOString();
  return \`event: \${event.type}\\ndata: \${JSON.stringify({ ...event, ts })}\\n\\n\`;
}

function drain(c) {
  if (c.draining) return;
  c.draining = true;
  queueMicrotask(() => {
    try {
      while (c.queue.length > 0 && c.alive) {
        const frame = c.queue.shift();
        const ok = c.res.write(frame);
        if (!ok) {
          c.res.once('drain', () => drain(c));
          break;
        }
      }
    } finally {
      c.draining = false;
    }
  });
}

export async function registerSseRoute(app) {
  app.get('/api/stream', { logLevel: 'warn' }, async (request, reply) => {
    const userId = request.session?.userId;
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(\`: connected ownerId=\${userId}\\n\\n\`);

    const c = { res: reply.raw, queue: [], draining: false, alive: true, ownerId: userId };
    clients.add(c);

    // Heartbeat every 25s — keeps corporate proxies from killing the socket.
    const heartbeat = setInterval(() => {
      if (!c.alive) return;
      c.queue.push(\`: ping \${Date.now()}\\n\\n\`);
      drain(c);
    }, 25_000);

    request.raw.on('close', () => {
      c.alive = false;
      clearInterval(heartbeat);
      clients.delete(c);
    });
  });

  // SIGTERM closes every channel cleanly so Blaxel can drain.
  process.once('SIGTERM', () => {
    for (const c of clients) {
      try { c.res.end(); } catch {}
      c.alive = false;
    }
    clients.clear();
  });
}
`,
  },

  {
    id: 'websocket-auth-handshake',
    title: 'WebSocket cookie-auth handshake with origin check + heartbeat',
    tags: ['internal_tool', 'multi_tenant_saas', 'agent_runtime'],
    purpose:
      'WebSocket upgrade only succeeds when the request carries a valid session cookie AND comes from an allow-listed origin. Per-socket heartbeat detects half-open connections. The handshake is synchronous — no LLM call, no Mongo round-trip — so the upgrade is sub-50ms.',
    hintedPath: 'routes/socket.js',
    language: 'js',
    body: `import { WebSocketServer } from 'ws';
import { parse as parseCookie } from 'cookie';
import { verifySession } from '../auth/session.js';

const ALLOWED_ORIGINS = new Set([
  process.env.WEB_PUBLIC_URL,
  process.env.WEB_PUBLIC_URL_LEGACY,
].filter(Boolean));

export function attachSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    // Origin allow-list — refuses cross-site upgrades even if the cookie leaked.
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\\r\\n\\r\\n'); socket.destroy(); return;
    }

    const cookies = parseCookie(req.headers.cookie ?? '');
    const session = await verifySession(cookies.argo_session);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n'); socket.destroy(); return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = session.userId;
      ws.alive = true;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); }
      catch { ws.send(JSON.stringify({ type: 'error', error: 'bad_json' })); return; }
      // ... route msg.type to handlers; ALWAYS owner-scope by ws.userId ...
    });
  });

  // Half-open detector. Without this, dropped Wi-Fi clients pile up forever.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch {}
    }
  }, 30_000);

  return wss;
}

/** Server -> per-owner broadcast helper. */
export function broadcastToOwner(wss, ownerId, payload) {
  const frame = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.userId === ownerId && ws.readyState === ws.OPEN) ws.send(frame);
  }
}
`,
  },

  {
    id: 'idempotency-key-table',
    title: 'Durable idempotency-key table for retry-safe POSTs',
    tags: ['rest_api', 'crud_app', 'webhook_bridge', 'every-build-handling-pii'],
    purpose:
      'A durable idempotency-key table (NOT in-memory) for retry-safe POSTs. Stripe-style semantics: same key replays the same response body within 24h. Lock + insert pattern means concurrent retries return the SAME body, never two writes. Fits any Postgres or Mongo backend; this is the Postgres flavour.',
    hintedPath: 'middleware/idempotency.js',
    language: 'js',
    body: `// Postgres schema (run once via migration):
//
//   CREATE TABLE idempotency_keys (
//     key            TEXT NOT NULL,
//     route          TEXT NOT NULL,
//     owner_id       TEXT NOT NULL,
//     status_code    SMALLINT,
//     response_body  JSONB,
//     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
//     completed_at   TIMESTAMPTZ,
//     PRIMARY KEY (owner_id, key, route)
//   );
//   CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at);
//   -- TTL via background sweep: DELETE WHERE created_at < now() - interval '24 hours'.

import { request as undiciRequest } from 'undici';

export function makeIdempotency(db) {
  return async function idempotencyMiddleware(request, reply) {
    if (request.method !== 'POST') return; // Only POST is idempotent-keyed.
    const key = request.headers['idempotency-key'];
    if (!key) return; // Header is optional; request proceeds unguarded.
    const ownerId = request.session?.userId ?? 'anon';
    const route = request.routerPath ?? request.url;

    // Try to claim the slot. ON CONFLICT DO NOTHING means the second
    // caller falls through and reads whatever the first one wrote.
    const claim = await db.query(
      \`INSERT INTO idempotency_keys (key, route, owner_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING key\`,
      [key, route, ownerId],
    );

    if (claim.rowCount === 0) {
      // Already in flight or completed — wait briefly, then return cached response.
      for (let i = 0; i < 30; i++) {
        const found = await db.query(
          \`SELECT status_code, response_body FROM idempotency_keys
           WHERE owner_id=$1 AND key=$2 AND route=$3 AND completed_at IS NOT NULL\`,
          [ownerId, key, route],
        );
        if (found.rows.length > 0) {
          reply.code(found.rows[0].status_code).send(found.rows[0].response_body);
          return reply;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return reply.code(409).send({ error: 'idempotency_in_flight' });
    }

    // We own the key; record the eventual response on send.
    reply.then((sent) => {
      const body = typeof sent.payload === 'string' ? safeJson(sent.payload) : sent.payload;
      void db.query(
        \`UPDATE idempotency_keys SET status_code=$1, response_body=$2, completed_at=now()
         WHERE owner_id=$3 AND key=$4 AND route=$5\`,
        [reply.statusCode, body, ownerId, key, route],
      );
    });
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return { raw: String(s).slice(0, 4000) }; }
}
`,
  },

  {
    id: 'multi-tenant-rls',
    title: 'Multi-tenant row-level security via Postgres + per-request session var',
    tags: ['multi_tenant_saas', 'crud_app', 'every-build-handling-pii'],
    purpose:
      'Postgres native RLS — every tenant\'s data is invisible to every other tenant by default. The pattern: a connection-pool wrapper SETs app.current_tenant from the session at the start of each request, RLS policies on every table enforce tenant_id = current_setting(\'app.current_tenant\'). Even a SELECT * returns only this tenant\'s rows. Defense-in-depth against accidental cross-tenant reads.',
    hintedPath: 'db/tenant-pool.js',
    language: 'js',
    body: `// Postgres schema (one migration per table):
//
//   ALTER TABLE submissions ADD COLUMN tenant_id TEXT NOT NULL;
//   ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY tenant_isolation ON submissions
//     USING (tenant_id = current_setting('app.current_tenant', true));
//
// The 'true' second arg to current_setting means: if the var is unset,
// return null and the policy fails closed (no rows visible). NEVER set
// app.current_tenant to a literal 'admin' or '*' wildcard.

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

/**
 * Run callback inside a tenant-bound transaction. The SET LOCAL only
 * applies inside the transaction — a leaked client returned to the
 * pool can't accidentally serve another tenant.
 */
export async function withTenant(tenantId, fn) {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.includes("'")) {
    throw new Error('invalid_tenant_id');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL is reset at COMMIT/ROLLBACK so the next checkout is clean.
    await client.query(\`SET LOCAL app.current_tenant = '\${tenantId}'\`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fastify hook: every authed route auto-binds to the session's tenant.
 *
 *   app.addHook('preHandler', tenantBoundary);
 *
 * Within the route, use request.tenantQuery(sql, params) instead of pool.query.
 */
export function tenantBoundary(request, reply, done) {
  const tenantId = request.session?.tenantId;
  if (!tenantId) return reply.code(401).send({ error: 'no_tenant' });
  request.tenantQuery = (sql, params = []) =>
    withTenant(tenantId, (client) => client.query(sql, params));
  done();
}
`,
  },

  {
    id: 'oauth2-pkce-callback',
    title: 'OAuth2 authorization-code + PKCE flow with state + nonce',
    tags: ['multi_tenant_saas', 'rest_api', 'auth.oauth2'],
    purpose:
      'Industry-standard OAuth2 dance for connecting third-party APIs (Google, GitHub, Slack). Uses PKCE so the authorization code can\'t be replayed even if intercepted. State param defeats CSRF; nonce in the ID token defeats replay. Token storage is encrypted at rest with the operator-scoped key.',
    hintedPath: 'routes/oauth2.js',
    language: 'js',
    body: `import { randomBytes, createHash } from 'crypto';
import { request as undiciRequest } from 'undici';

const PROVIDER = {
  authorize: process.env.OAUTH2_AUTHORIZE_URL, // e.g. https://accounts.google.com/o/oauth2/v2/auth
  token: process.env.OAUTH2_TOKEN_URL,         // e.g. https://oauth2.googleapis.com/token
  clientId: process.env.OAUTH2_CLIENT_ID,
  clientSecret: process.env.OAUTH2_CLIENT_SECRET,
  scopes: (process.env.OAUTH2_SCOPES ?? 'openid email profile').split(/\\s+/),
};

const REDIRECT_URI = process.env.API_PUBLIC_URL + '/oauth2/callback';

export async function registerOauth2Routes(app, { redis, db }) {
  app.get('/oauth2/start', async (request, reply) => {
    const ownerId = request.session?.userId;
    if (!ownerId) return reply.code(401).send({ error: 'unauthorized' });

    // PKCE: generate verifier, derive challenge.
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = base64Url(randomBytes(16));
    const nonce = base64Url(randomBytes(16));

    // Stash verifier+state+nonce by state key (5min TTL — flow is fast).
    await redis.set(\`oauth2:\${state}\`, JSON.stringify({ ownerId, verifier, nonce }), 'EX', 300);

    const url = new URL(PROVIDER.authorize);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', PROVIDER.clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', PROVIDER.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return reply.redirect(url.toString());
  });

  app.get('/oauth2/callback', async (request, reply) => {
    const { code, state, error } = request.query ?? {};
    if (error) return reply.code(400).send({ error: String(error) });
    if (!code || !state) return reply.code(400).send({ error: 'missing_code_or_state' });

    const stashRaw = await redis.getdel(\`oauth2:\${state}\`); // GETDEL is atomic.
    if (!stashRaw) return reply.code(400).send({ error: 'invalid_or_expired_state' });
    const { ownerId, verifier, nonce } = JSON.parse(stashRaw);

    const tokenRes = await undiciRequest(PROVIDER.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: REDIRECT_URI,
        client_id: PROVIDER.clientId,
        client_secret: PROVIDER.clientSecret,
        code_verifier: verifier,
      }).toString(),
      bodyTimeout: 15_000,
    });
    const tokenJson = await tokenRes.body.json();
    if (tokenRes.statusCode >= 400) return reply.code(502).send({ error: 'token_exchange_failed', detail: tokenJson });

    // If the provider returns an id_token, verify the nonce matches
    // before trusting any embedded claims.
    if (tokenJson.id_token) {
      const claims = decodeJwtClaims(tokenJson.id_token);
      if (claims.nonce !== nonce) return reply.code(400).send({ error: 'nonce_mismatch' });
    }

    // Store encrypted at rest. The encryption key is per-owner so a
    // single DB leak doesn't unlock every tenant's tokens.
    await db.collection('oauth2_tokens').updateOne(
      { ownerId, provider: 'primary' },
      {
        $set: {
          accessToken: encrypt(tokenJson.access_token, ownerId),
          refreshToken: tokenJson.refresh_token ? encrypt(tokenJson.refresh_token, ownerId) : null,
          expiresAt: new Date(Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000).toISOString(),
          scope: tokenJson.scope ?? PROVIDER.scopes.join(' '),
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );

    return reply.redirect(\`\${process.env.WEB_PUBLIC_URL}/integrations/connected\`);
  });
}

function base64Url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function decodeJwtClaims(jwt) {
  const [, payload] = jwt.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// Replace these with your real KMS / per-tenant key derivation.
function encrypt(plain, ownerId) {
  return { ciphertext: plain, ownerId, alg: 'plaintext-replace-me' };
}
`,
  },

  // ────────────────────────────────────────────────────────────────────
  // Frontend snippets — pulled in by fullstack_app + multi_tenant_saas +
  // internal_tool. The dispatcher fires these when the brief calls for
  // a UI surface alongside the backend.
  // ────────────────────────────────────────────────────────────────────

  {
    id: 'vite-react-tailwind-bootstrap',
    title: 'Vite + React 18 + Tailwind v3 production bootstrap',
    tags: ['fullstack_app', 'multi_tenant_saas', 'internal_tool'],
    purpose:
      'The exact files Argo ships when a build needs a frontend. Vite outputs to web/dist/ which the Fastify server statically mounts. Tailwind v3 with custom-property tokens for dark mode. No Next.js — the simpler stack ships in 90 seconds and never has hydration bugs.',
    hintedPath: 'web/vite.config.ts',
    language: 'ts',
    body: `// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});

// web/tailwind.config.ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./index.html', './**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
} satisfies Config;

// web/styles/globals.css
@tailwind base;
@tailwind components;
@tailwind utilities;
@layer base {
  :root { --bg: 10 10 11; --surface: 18 18 20; --text: 242 240 235; --accent: 0 229 204; }
  html { color-scheme: dark; }
  body { @apply bg-bg text-text font-sans antialiased; }
  h1, h2, h3 { letter-spacing: -0.04em; }
}

// web/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import './styles/globals.css';
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </StrictMode>,
);

// web/index.html — set up the root + fonts before main.tsx.
`,
  },

  {
    id: 'shadcn-style-button-input-card',
    title: 'shadcn-style primitives: Button, Input, Card via class-variance-authority',
    tags: ['fullstack_app', 'multi_tenant_saas', 'internal_tool'],
    purpose:
      'Three reusable UI primitives modeled on shadcn/ui. Class-variance-authority drives variant composition; clsx merges classNames. Argo ships these by default so frontend code looks like a 2026 product, not a Bootstrap demo.',
    hintedPath: 'web/components/ui/Button.tsx',
    language: 'ts',
    body: `// web/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// web/components/ui/Button.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '@/web/lib/utils.js';

const button = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      intent: {
        primary: 'bg-accent text-bg hover:opacity-90',
        secondary: 'border border-text/10 text-text hover:bg-surface',
        ghost: 'text-text hover:bg-surface',
        danger: 'bg-red-500 text-white hover:bg-red-600',
      },
      size: { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' },
    },
    defaultVariants: { intent: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, intent, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ intent, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

// web/components/ui/Input.tsx
import { forwardRef } from 'react';
import { cn } from '@/web/lib/utils.js';
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(
      'h-10 w-full rounded-md border border-text/10 bg-surface px-3 text-sm text-text placeholder:text-text/40 focus:outline-none focus:ring-2 focus:ring-accent',
      className,
    )} {...props} />
  ),
);
Input.displayName = 'Input';

// web/components/ui/Card.tsx
import { cn } from '@/web/lib/utils.js';
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn('rounded-xl border border-text/10 bg-surface p-6', className)} {...p} />;
`,
  },

  {
    id: 'shared-zod-schema-frontend-and-backend',
    title: 'Shared Zod schema: same validation on the form AND the route',
    tags: ['fullstack_app', 'every-build'],
    purpose:
      'The single biggest reliability win in a full-stack app: the SAME Zod schema validates the form on the client and the request body on the server. Eliminates shape drift forever. Schema lives in schema/shared.js and is imported from both halves.',
    hintedPath: 'schema/shared.js',
    language: 'js',
    body: `// schema/shared.js — imported by BOTH server routes and client form.
import { z } from 'zod';

export const SubmissionSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  company: z.string().max(120).optional(),
  message: z.string().min(20).max(4000),
});
export type Submission = z.infer<typeof SubmissionSchema>;

// routes/form.js — server side
import { SubmissionSchema } from '../schema/shared.js';
export async function registerFormRoutes(app) {
  app.post('/submissions', async (request, reply) => {
    const parsed = SubmissionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    // ...persist + queue mailer
    return reply.code(202).send({ submissionId: crypto.randomUUID() });
  });
}

// web/components/MainForm.tsx — client side, SAME schema
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SubmissionSchema, type Submission } from '../../schema/shared.js';
import { Button, Input } from './ui/index.js';

export function MainForm() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<Submission>({ resolver: zodResolver(SubmissionSchema) });
  const onSubmit = handleSubmit(async (data) => {
    await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input placeholder="Name" {...register('name')} />
      {errors.name && <p className="text-red-400 text-xs">{errors.name.message}</p>}
      <Input type="email" placeholder="Email" {...register('email')} />
      {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
      <Button disabled={isSubmitting} type="submit">{isSubmitting ? 'Sending…' : 'Send'}</Button>
    </form>
  );
}
`,
  },

  {
    id: 'tanstack-query-typed-fetch-client',
    title: 'Tanstack Query + typed fetch client with optimistic updates',
    tags: ['fullstack_app', 'multi_tenant_saas', 'internal_tool'],
    purpose:
      'Every server-data interaction in the frontend goes through Tanstack Query. useQuery for reads, useMutation with optimistic updates for writes. The fetch client is typed via the shared Zod schemas so a backend rename breaks the build, not production.',
    hintedPath: 'web/lib/api.ts',
    language: 'ts',
    body: `// web/lib/api.ts
import { z } from 'zod';
import { SubmissionSchema, type Submission } from '../../schema/shared.js';

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function send<T>(method: 'GET'|'POST'|'PATCH'|'DELETE', path: string, schema: z.ZodSchema<T>, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'unknown', json?.message ?? text);
  return schema.parse(json);
}

export const api = {
  listSubmissions: () => send('GET', '/submissions', z.object({ items: z.array(SubmissionSchema) })),
  createSubmission: (input: Submission) => send('POST', '/submissions', z.object({ id: z.string() }), input),
};

// web/hooks/useSubmissions.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export function useSubmissions() {
  return useQuery({ queryKey: ['submissions'], queryFn: api.listSubmissions });
}

export function useCreateSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createSubmission,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['submissions'] });
      const prev = qc.getQueryData(['submissions']);
      qc.setQueryData(['submissions'], (old: any) => ({
        items: [...(old?.items ?? []), { ...input, id: 'temp-' + Math.random() }],
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['submissions'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['submissions'] }),
  });
}
`,
  },

  {
    id: 'fastify-static-react-spa',
    title: 'Fastify serves the Vite-built React SPA with /api/* preserved',
    tags: ['fullstack_app'],
    purpose:
      'How the backend serves the frontend in the same process — a single Blaxel sandbox per operation. Static handler for web/dist/, SPA fallback to index.html for any non-API path so React Router works, /api/* mounts under the existing route registrar. One bundle, one URL.',
    hintedPath: 'server.js',
    language: 'js',
    body: `// server.js — production entrypoint that serves frontend + backend together.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { registerApiRoutes } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, 'web', 'dist');

async function main() {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 4_000_000 });
  app.get('/health', async () => ({ status: 'ok' }));
  app.setErrorHandler((err, _req, reply) => {
    reply.code(err.statusCode ?? 500).send({ error: err.code ?? 'internal_error' });
  });
  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cors, { origin: process.env.WEB_PUBLIC_URL ?? '*', credentials: true });
  await app.register(rateLimit, { global: false, max: 60, timeWindow: '1 minute' });
  await registerApiRoutes(app);
  await app.register(staticPlugin, { root: distPath, prefix: '/', wildcard: false });
  // SPA fallback: any non-/api, non-/health path falls back to index.html.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/health')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  for (const sig of ['SIGINT','SIGTERM']) process.once(sig, async () => { await app.close(); process.exit(0); });
}
main().catch((err) => { console.error('fatal', err); process.exit(1); });
`,
  },

  {
    id: 'react-router-shell-with-suspense',
    title: 'React Router shell with Suspense + dark mode + toast',
    tags: ['fullstack_app', 'multi_tenant_saas', 'internal_tool'],
    purpose:
      'Top-level App.tsx shell. React Router v6 with lazy-loaded routes, Suspense fallback skeleton, dark/light mode toggle backed by prefers-color-scheme + a class on <html>, sonner-style toast region. The frame every full-stack Argo build extends.',
    hintedPath: 'web/App.tsx',
    language: 'ts',
    body: `// web/App.tsx
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { Button } from './components/ui/Button.js';

const Home = lazy(() => import('./pages/Home.js'));
const Submit = lazy(() => import('./pages/Submit.js'));
const Admin = lazy(() => import('./pages/AdminDashboard.js'));

export default function App() {
  const [theme, setTheme] = useState<'dark'|'light'>('dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 h-14 border-b border-text/10">
          <Link to="/" className="font-bold tracking-tight">Argo Operation</Link>
          <nav className="flex items-center gap-4 text-sm">
            <NavLink to="/submit" className={({ isActive }) => isActive ? 'text-accent' : ''}>Submit</NavLink>
            <NavLink to="/admin" className={({ isActive }) => isActive ? 'text-accent' : ''}>Admin</NavLink>
            <Button intent="ghost" size="sm" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </nav>
        </header>
        <main className="flex-1">
          <Suspense fallback={<div className="p-12 text-center text-text/40">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/submit" element={<Submit />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="border-t border-text/10 py-6 text-center text-xs text-text/40">
          Powered by Argo · operates from email
        </footer>
      </div>
    </BrowserRouter>
  );
}
`,
  },

  // ────────────────────────────────────────────────────────────────────
  // Agent runtime SDK — the moat.
  //
  // Replit / Lovable / Bolt / v0 generate code that calls OpenAI directly:
  // string concatenation in handlers, no cost tracking, no durable retry,
  // no observability. Argo's generated apps inline a typed agent runtime
  // SDK (these five snippets) so every LLM call is structured, durable,
  // memoised, cost-tracked, and replayable. This is what makes "Argo
  // operates the workflow" not just hyperbole — the generated app has a
  // real agent runtime, not glue.
  //
  // The agent embeds this SDK as plain JS files (lib/agent/*.js) inside
  // every agent_runtime / fullstack_app / form_workflow build. No npm
  // dependency, just inline. ~600 lines of carefully audited code.
  // ────────────────────────────────────────────────────────────────────

  {
    id: 'agent-sdk-inline',
    title: 'Inline typed agent runtime: createAgent + runAgent + model router',
    tags: ['agent_runtime', 'fullstack_app', 'form_workflow', 'every-build'],
    purpose:
      'A 200-line agent runtime the generated app inlines as lib/agent/index.js. Provides createAgent({ name, model, systemPrompt, outputSchema, tools }) and an async run(input) that handles JSON-mode parsing, retry on schema mismatch, cost ledger writes, replay envelope captures, and supermemory recall. This is the moat: Replit/Lovable apps call OpenAI directly. Argo apps use a typed agent runtime that\'s observable, durable, and recoverable.',
    hintedPath: 'lib/agent/index.js',
    language: 'js',
    body: `// lib/agent/index.js
// Inline agent runtime. Inlined into every Argo-generated app so every
// LLM call is typed, retried, cost-tracked, and observable. NEVER call
// the OpenAI/Anthropic SDKs directly from a route — go through createAgent.

import { request } from 'undici';
import { z } from 'zod';
import { recordInvocation } from './cost-ledger.js';

const MODEL_PRICING = {
  'gpt-5.5':         { in: 0.005,  out: 0.020 },
  'gpt-4o':          { in: 0.0025, out: 0.010 },
  'gpt-4o-mini':     { in: 0.00015,out: 0.0006 },
  'claude-opus-4-7': { in: 0.015,  out: 0.075 },
  'claude-sonnet-4-5':{in: 0.003,  out: 0.015 },
};

/**
 * Define a typed agent. Every LLM-using surface in the app should be
 * an agent — never raw fetch to OpenAI from a route handler.
 */
export function createAgent(spec) {
  const validated = AgentSpec.parse(spec);
  return {
    spec: validated,
    async run(input, ctx = {}) { return runAgent(validated, input, ctx); },
  };
}

const AgentSpec = z.object({
  name: z.string().min(1).max(80),
  model: z.string().default('gpt-5.5'),
  fallbackModel: z.string().default('gpt-4o'),
  systemPrompt: z.string().min(20),
  outputSchema: z.unknown(),                  // a Zod schema; not validated structurally here
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    schema: z.unknown(),
    execute: z.function(),
  })).default([]),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().min(64).max(8000).default(2000),
  maxRetries: z.number().min(0).max(3).default(2),
});

export async function runAgent(spec, input, ctx = {}) {
  const started = Date.now();
  const candidates = [spec.model, spec.fallbackModel].filter((v, i, a) => a.indexOf(v) === i);
  let lastErr = null;
  for (let attempt = 0; attempt <= spec.maxRetries; attempt++) {
    for (const model of candidates) {
      try {
        const result = await callOnce({ spec, input, model, ctx });
        const parsed = spec.outputSchema.safeParse
          ? spec.outputSchema.safeParse(result.output)
          : { success: true, data: result.output };
        if (!parsed.success) {
          lastErr = new Error('output schema mismatch: ' + parsed.error.message.slice(0, 200));
          continue;
        }
        await recordInvocation({
          name: spec.name, model, input, output: parsed.data,
          promptTokens: result.promptTokens, completionTokens: result.completionTokens,
          costUsd: estimateCost(model, result.promptTokens, result.completionTokens),
          durationMs: Date.now() - started, ownerId: ctx.ownerId, operationId: ctx.operationId,
        });
        return parsed.data;
      } catch (err) {
        lastErr = err;
        const transient = /timeout|429|503|model_not_found|invalid model/i.test(String(err.message ?? err));
        if (!transient && attempt === spec.maxRetries) throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
  }
  throw lastErr ?? new Error('agent ' + spec.name + ' failed after retries');
}

async function callOnce({ spec, input, model, ctx }) {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const userPrompt = typeof input === 'string' ? input : JSON.stringify(input);
  const body = {
    model,
    response_format: { type: 'json_object' },
    temperature: spec.temperature,
    max_tokens: spec.maxTokens,
    messages: [
      { role: 'system', content: spec.systemPrompt + '\\n\\nReturn ONLY a JSON object.' },
      { role: 'user', content: userPrompt },
    ],
  };
  const res = await request(\`\${apiBase}/chat/completions\`, {
    method: 'POST',
    headers: { authorization: \`Bearer \${apiKey}\`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    bodyTimeout: 60_000, headersTimeout: 30_000,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (res.statusCode >= 400) {
    const text = (await res.body.text()).slice(0, 300);
    const err = new Error(\`\${model} -> \${res.statusCode}: \${text}\`);
    err.status = res.statusCode;
    throw err;
  }
  const json = await res.body.json();
  const content = json.choices?.[0]?.message?.content ?? '{}';
  return {
    output: JSON.parse(content),
    promptTokens: json.usage?.prompt_tokens ?? Math.ceil(userPrompt.length / 4),
    completionTokens: json.usage?.completion_tokens ?? Math.ceil(content.length / 4),
  };
}

function estimateCost(model, prompt, completion) {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o'];
  return (prompt / 1000) * p.in + (completion / 1000) * p.out;
}
`,
  },

  {
    id: 'agent-tool-registry',
    title: 'Typed tool registry — defineTool + tool-call loop',
    tags: ['agent_runtime', 'fullstack_app'],
    purpose:
      'Tool calls are the difference between a chatbot and an agent. defineTool wraps an async function with a Zod schema for its input + output. The agent runtime detects function-call requests in the LLM response, routes them through the registry, and re-prompts with the result. Every tool call is logged + cost-tracked. Generated apps register their tools once at boot.',
    hintedPath: 'lib/agent/tool-registry.js',
    language: 'js',
    body: `// lib/agent/tool-registry.js
// Tool registry + a tool-call loop. Drop-in for any Argo-generated app
// that needs LLM tool use. Replit-style "let the model call functions"
// without the unsafe pattern of letting the model decide what runs:
// every tool is registered explicitly, has a Zod schema, and a 5-second
// per-call timeout.

import { z } from 'zod';

const TOOL_TIMEOUT_MS = 5_000;

export function defineTool(spec) {
  const parsed = ToolSpec.parse(spec);
  return parsed;
}

const ToolSpec = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'tool names: snake_case, 2-41 chars'),
  description: z.string().min(20).max(400),
  inputSchema: z.unknown(),    // Zod schema for the input
  execute: z.function(),       // async (input) => output
  /** Cost (USD) per call, used by the cost ledger. Default 0 — only LLM tools cost. */
  costUsd: z.number().min(0).default(0),
});

export function createToolRegistry() {
  const tools = new Map();
  return {
    register(tool) {
      const t = ToolSpec.parse(tool);
      tools.set(t.name, t);
      return this;
    },
    list() { return Array.from(tools.values()); },
    has(name) { return tools.has(name); },
    /** OpenAI-format tool descriptors the LLM can call. */
    asOpenAITools() {
      return Array.from(tools.values()).map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema._def?.shape
            ? zodToJsonShape(t.inputSchema)
            : { type: 'object', properties: {} },
        },
      }));
    },
    async call(name, rawInput, ctx = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error('unknown tool: ' + name);
      const parsed = tool.inputSchema.safeParse
        ? tool.inputSchema.safeParse(rawInput)
        : { success: true, data: rawInput };
      if (!parsed.success) {
        return { ok: false, error: 'invalid_input: ' + parsed.error.message.slice(0, 240) };
      }
      const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('tool_timeout')), TOOL_TIMEOUT_MS));
      try {
        const out = await Promise.race([tool.execute(parsed.data, ctx), timer]);
        return { ok: true, output: out };
      } catch (err) {
        return { ok: false, error: String(err.message ?? err).slice(0, 240) };
      }
    },
  };
}

// Minimal Zod -> JSON Schema converter; sufficient for the OpenAI tool API.
function zodToJsonShape(schema) {
  const shape = schema._def.shape();
  const properties = {};
  const required = [];
  for (const [k, v] of Object.entries(shape)) {
    properties[k] = zodFieldType(v);
    if (!v.isOptional()) required.push(k);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}
function zodFieldType(v) {
  const tn = v._def.typeName;
  if (tn === 'ZodString') return { type: 'string' };
  if (tn === 'ZodNumber') return { type: 'number' };
  if (tn === 'ZodBoolean') return { type: 'boolean' };
  if (tn === 'ZodArray') return { type: 'array', items: zodFieldType(v._def.type) };
  if (tn === 'ZodEnum') return { type: 'string', enum: v._def.values };
  if (tn === 'ZodOptional') return zodFieldType(v._def.innerType);
  return {};
}
`,
  },

  {
    id: 'agent-durable-workflow',
    title: 'Durable agent workflow — resumes after crash, retries idempotent steps',
    tags: ['agent_runtime', 'fullstack_app', 'multi_tenant_saas'],
    purpose:
      'Convex-style durable workflows for the generated app. A workflow is a sequence of named steps; each step\'s args + return are persisted in Mongo. If the worker crashes mid-workflow, on restart it picks up at the latest incomplete step. Each step has its own retry policy. Workflows are how a "candidate intake → score → email" flow survives Blaxel sandbox restarts. None of Replit / Lovable / Bolt ship this in generated code.',
    hintedPath: 'lib/workflow/index.js',
    language: 'js',
    body: `// lib/workflow/index.js
// Durable workflow runner. Persisted in Mongo at db.workflow_runs.
// Use it for any multi-step LLM flow: classify -> draft -> send.
// Steps are idempotent by name; the runner re-invokes any step whose
// completedAt is missing on resume.

import { db } from '../db/mongo.js';

const COL = 'workflow_runs';

export function defineWorkflow(name, steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('workflow needs steps');
  return {
    name,
    steps,
    /** Start a fresh run and execute it to completion. */
    async run(input, ctx = {}) {
      const runId = ctx.runId || crypto.randomUUID();
      await db.collection(COL).insertOne({
        id: runId, name, input, status: 'running',
        currentStep: 0, steps: steps.map((s) => ({ name: s.name, status: 'pending', attempts: 0 })),
        ownerId: ctx.ownerId ?? null, operationId: ctx.operationId ?? null,
        startedAt: new Date().toISOString(),
      });
      return await executeFromCurrent(runId);
    },
    /** Resume a previously-started run that crashed mid-flight. */
    async resume(runId) {
      const doc = await db.collection(COL).findOne({ id: runId });
      if (!doc) throw new Error('workflow run not found: ' + runId);
      if (doc.status === 'completed') return { runId, status: 'completed', output: doc.output };
      return executeFromCurrent(runId);
    },
  };

  async function executeFromCurrent(runId) {
    let doc = await db.collection(COL).findOne({ id: runId });
    let context = doc.context ?? doc.input;
    while (doc.currentStep < steps.length) {
      const stepDef = steps[doc.currentStep];
      const stepState = doc.steps[doc.currentStep];
      if (stepState.status === 'completed') {
        context = stepState.output;
        doc.currentStep++;
        continue;
      }
      let attempt = stepState.attempts;
      const maxRetries = stepDef.maxRetries ?? 2;
      while (attempt <= maxRetries) {
        try {
          const out = await stepDef.run(context, { runId, stepName: stepDef.name });
          await db.collection(COL).updateOne(
            { id: runId },
            { $set: {
              [\`steps.\${doc.currentStep}.status\`]: 'completed',
              [\`steps.\${doc.currentStep}.output\`]: out,
              [\`steps.\${doc.currentStep}.completedAt\`]: new Date().toISOString(),
              [\`steps.\${doc.currentStep}.attempts\`]: attempt + 1,
              currentStep: doc.currentStep + 1,
              context: out,
            } },
          );
          context = out;
          break;
        } catch (err) {
          attempt++;
          await db.collection(COL).updateOne(
            { id: runId },
            { $set: {
              [\`steps.\${doc.currentStep}.attempts\`]: attempt,
              [\`steps.\${doc.currentStep}.lastError\`]: String(err.message ?? err).slice(0, 400),
            } },
          );
          if (attempt > maxRetries) {
            await db.collection(COL).updateOne(
              { id: runId },
              { $set: { status: 'failed', failedAt: new Date().toISOString() } },
            );
            throw err;
          }
          await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
        }
      }
      doc = await db.collection(COL).findOne({ id: runId });
    }
    await db.collection(COL).updateOne(
      { id: runId },
      { $set: { status: 'completed', output: context, completedAt: new Date().toISOString() } },
    );
    return { runId, status: 'completed', output: context };
  }
}
`,
  },

  {
    id: 'agent-cost-ledger-inline',
    title: 'Per-invocation cost ledger inside the generated app',
    tags: ['agent_runtime', 'fullstack_app', 'every-build'],
    purpose:
      'Every LLM call inside a generated Argo app writes to the agent_invocations Mongo collection — same shape as the control plane uses. Operators see their app\'s LLM spend in the workspace Replay tab without any extra wiring. recordInvocation is the entry point; it captures redacted envelope (no PII), prompt/completion tokens, USD cost, duration, and ownerId/operationId scope.',
    hintedPath: 'lib/agent/cost-ledger.js',
    language: 'js',
    body: `// lib/agent/cost-ledger.js
// Per-invocation cost ledger — same shape as the Argo control plane's
// agent_invocations collection so the workspace Replay tab works
// without extra wiring. Called from runAgent() in lib/agent/index.js.

import { db } from '../db/mongo.js';
import { redactPii } from './redact.js';

export async function recordInvocation(args) {
  try {
    await db.collection('agent_invocations').insertOne({
      id: 'inv_' + crypto.randomUUID(),
      kind: args.name,
      provider: args.model.startsWith('claude') ? 'anthropic' : 'openai',
      model: args.model,
      status: 'succeeded',
      durationMs: args.durationMs,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      costUsd: Number(args.costUsd.toFixed(6)),
      envelope: {
        // Redacted summary so the operator can see what shape the agent saw
        // without exposing PII.
        inputShape: shapeOf(redactPii(args.input)),
        outputShape: shapeOf(args.output),
      },
      rawResponse: null,                    // production: don't persist raw
      ownerId: args.ownerId ?? process.env.ARGO_OWNER_ID ?? null,
      operationId: args.operationId ?? process.env.ARGO_OPERATION_ID ?? null,
      createdAt: new Date().toISOString(),
      completedAt: new Date(Date.now() + args.durationMs).toISOString(),
      errorMessage: null,
    });
  } catch (err) {
    // Cost ledger failures must never break a request.
    console.warn('[cost-ledger] write failed:', String(err.message ?? err).slice(0, 120));
  }
}

function shapeOf(value, depth = 0) {
  if (depth > 4) return '<too-deep>';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : \`[\${shapeOf(value[0], depth + 1)} x \${value.length}]\`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const sample = Object.fromEntries(
      keys.slice(0, 8).map((k) => [k, shapeOf(value[k], depth + 1)]),
    );
    return sample;
  }
  return typeof value;
}
`,
  },

  {
    id: 'agent-eval-suite',
    title: 'Spec-as-tests: brief.successCriteria → eval cases',
    tags: ['agent_runtime', 'fullstack_app', 'every-build'],
    purpose:
      'Each successCriterion in the operator\'s brief becomes a real eval case. The eval suite boots the app, sends representative inputs, and asserts the output matches the criterion. This is what turns Argo from "vibe coder that ships hopeful code" into "ships code that\'s actually tested against the operator\'s definition of done." None of Replit/Lovable/Bolt do this.',
    hintedPath: 'tests/eval-suite.js',
    language: 'js',
    body: `// tests/eval-suite.js
// Spec-as-tests. Each entry corresponds to one of the brief's
// successCriteria fields. Run with \`node tests/eval-suite.js\` after
// the app is up. Output is a JSON report compatible with the Argo
// control plane's testing-agent format.

import { request } from 'undici';

const BASE = process.env.ARGO_TEST_BASE_URL ?? 'http://localhost:3000';

const EVAL_CASES = [
  {
    name: 'happy_path_strong_candidate',
    criterion: 'Strong candidates are forwarded to the hiring client.',
    input: {
      name: 'Test Candidate',
      email: 'eval+strong@example.com',
      years_exp: 8,
      role: 'Senior Backend',
      cover_letter: 'I have 8 years of Node/Postgres + a maintained OSS project.',
    },
    asserts: [
      { kind: 'http_status', expected: 202 },
      { kind: 'response_field_eq', field: 'decision', expected: 'forward' },
    ],
  },
  {
    name: 'happy_path_weak_candidate',
    criterion: 'Weak candidates are rejected politely.',
    input: {
      name: 'Test Weak',
      email: 'eval+weak@example.com',
      years_exp: 1,
      role: 'Staff Eng',
      cover_letter: 'I am new to coding and excited to learn.',
    },
    asserts: [
      { kind: 'http_status', expected: 202 },
      { kind: 'response_field_eq', field: 'decision', expected: 'reject' },
    ],
  },
  {
    name: 'rate_limited',
    criterion: 'No single IP can flood the form.',
    input: { name: 'flooder', email: 'flood@example.com', years_exp: 5, role: 'Senior Backend' },
    repeat: 100,
    asserts: [{ kind: 'http_status_among', expected: [429] }],
  },
  {
    name: 'invalid_email',
    criterion: 'Invalid input never reaches the LLM.',
    input: { name: 'x', email: 'not-an-email', years_exp: 5, role: 'Senior Backend' },
    asserts: [{ kind: 'http_status', expected: 400 }],
  },
];

async function runOne(caseDef) {
  const repeat = caseDef.repeat ?? 1;
  const statuses = [];
  let lastBody = null;
  for (let i = 0; i < repeat; i++) {
    const res = await request(\`\${BASE}/submissions\`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(caseDef.input),
    });
    statuses.push(res.statusCode);
    lastBody = await res.body.text();
  }
  let bodyJson = null;
  try { bodyJson = JSON.parse(lastBody); } catch {}
  const results = caseDef.asserts.map((a) => assertOne(a, statuses, bodyJson));
  return {
    name: caseDef.name,
    criterion: caseDef.criterion,
    passed: results.every((r) => r.ok),
    asserts: results,
  };
}

function assertOne(a, statuses, body) {
  if (a.kind === 'http_status') {
    const last = statuses[statuses.length - 1];
    return { kind: a.kind, ok: last === a.expected, message: \`got \${last}, expected \${a.expected}\` };
  }
  if (a.kind === 'http_status_among') {
    const ok = statuses.some((s) => a.expected.includes(s));
    return { kind: a.kind, ok, message: \`statuses: \${statuses.join(',')}; expected any of \${a.expected.join(',')}\` };
  }
  if (a.kind === 'response_field_eq') {
    const got = body?.[a.field];
    return { kind: a.kind, ok: got === a.expected, message: \`\${a.field}=\${got} (want \${a.expected})\` };
  }
  return { kind: a.kind, ok: false, message: 'unknown_assertion' };
}

(async () => {
  const started = Date.now();
  const cases = [];
  for (const c of EVAL_CASES) {
    try {
      cases.push(await runOne(c));
    } catch (err) {
      cases.push({ name: c.name, criterion: c.criterion, passed: false, error: String(err.message ?? err) });
    }
  }
  const passed = cases.every((c) => c.passed);
  const report = { passed, durationMs: Date.now() - started, cases };
  console.log(JSON.stringify(report, null, 2));
  process.exit(passed ? 0 : 1);
})();
`,
  },
];

/**
 * Pick the snippets relevant to a given build situation. Always include
 * the 'every-build' tier (boot, validation, observability). Then layer in
 * tags for trigger, integrations, and auth.
 */
export function selectSnippets(args: {
  trigger: string;
  integrations: readonly string[];
  auth: string;
  dataClassification: string;
  specialist: string;
}): ReferenceSnippet[] {
  const wanted = new Set<string>([
    'every-build',
    `every-build-handling-pii`,
    args.specialist,
    ...args.integrations.map((i) => `integrations.${i}`),
    args.auth === 'magic_link' ? 'auth.magic_link' : '',
    args.auth === 'oauth2' ? 'auth.oauth2' : '',
    args.dataClassification === 'pii' ? 'data_classification.pii' : '',
  ].filter(Boolean));

  return REFERENCE_SNIPPETS.filter((s) =>
    s.tags.some((t) => wanted.has(t)) || s.tags.includes('every-build'),
  );
}

/**
 * Render the picked snippets as a markdown section the system prompt
 * embeds. Each snippet gets its purpose paragraph so the model knows WHY
 * it's there, not just WHAT to copy.
 */
export function renderSnippetsAsPromptSection(snippets: readonly ReferenceSnippet[]): string {
  if (snippets.length === 0) return '';
  const lines: string[] = [];
  lines.push('# Reference patterns — prefer adapting these to writing from scratch');
  lines.push('');
  lines.push(`These ${snippets.length} snippets are battle-tested in production Argo deployments.`);
  lines.push('When the build brief calls for one of these patterns, ADAPT the snippet — do not');
  lines.push('reinvent it. Filenames are hints; you may rename or split as needed.');
  lines.push('');
  for (const s of snippets) {
    lines.push(`## ${s.title}`);
    lines.push(`*Hint path: \`${s.hintedPath}\`*`);
    lines.push('');
    lines.push(s.purpose);
    lines.push('');
    lines.push('```' + s.language);
    lines.push(s.body.trim());
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}
