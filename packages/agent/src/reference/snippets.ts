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
