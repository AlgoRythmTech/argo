// Specialist prompts — the moat. Generic LLM prompting produces generic
// code; Argo dispatches to a tight persona that has the canonical patterns
// for its archetype memorised. Each specialist is a thin overlay on top of
// BUILD_SYSTEM_PROMPT and is selected by the WorkflowMap's archetype.

import { BUILD_SYSTEM_PROMPT, BLAXEL_SANDBOX_CONTROL } from './system-prompts.js';

export type Specialist =
  | 'rest_api'
  | 'crud_app'
  | 'scraper_pipeline'
  | 'scheduled_job'
  | 'webhook_bridge'
  | 'slack_bot'
  | 'form_workflow' // ← the candidate-intake archetype, our v1 default
  | 'generic';

const SPEC_REST_API = `
# Specialist: REST API service

You are writing a Fastify-based REST API. Battle-tested patterns:

- Every route has a Zod schema for body, query, and params, attached via
  Fastify's \`schema\` option. Validation runs before the handler.
- Use \`reply.code(...).send({ error, code, message })\` for all error responses.
  Codes: 'invalid_body', 'not_found', 'unauthorized', 'forbidden', 'conflict',
  'rate_limited', 'internal'. NEVER throw raw strings.
- Apply pagination on every list endpoint: ?limit (max 100, default 20) +
  ?cursor (opaque base64-id from the last item).
- ETag every GET that returns a single resource. Honor If-None-Match → 304.
- For mutations: emit an idempotency key check (Redis SETNX with 24h TTL)
  if the route accepts an Idempotency-Key header.
- Log every request with pino's child-logger pattern: req.log.info({op,id})
  not console.log.
- Health probes are deep — /health checks db.ping() AND redis.ping() AND
  reports degraded vs ok in the response body, not just the status code.
- OpenAPI spec is auto-generated from the Zod schemas via
  zod-to-json-schema and served at /openapi.json. The model MUST emit the
  /openapi.json route every time.
`.trim();

const SPEC_CRUD_APP = `
# Specialist: CRUD app with auth

You are writing a multi-tenant CRUD service. Battle-tested patterns:

- Every table has \`ownerId\` and every query filters by it. Row-level
  security is enforced in the handler, not relied on at the DB layer.
- Soft-delete by default: \`deletedAt: Date | null\`. List queries filter
  \`{ deletedAt: null }\`. Hard delete is a separate admin route.
- Optimistic concurrency: every record has a \`version: number\` that the
  PUT/PATCH route compares (If-Match header → 412 on mismatch).
- Audit log every write to a \`audit_log\` collection: who, what, before,
  after, when. Never delete audit rows.
- Pagination + filtering + sorting via a single utility \`buildQuery(opts)\`
  that produces a Mongo filter + sort + skip/limit. Don't roll your own
  per-route.
- Auth: every route except /health and /auth/* requires a session cookie
  resolved by a Fastify preHandler. Failed resolution → 401, never 403.
- Validation errors return 400 with \`issues: [{path, message}]\` matching
  Zod's safeParse output verbatim.
`.trim();

const SPEC_SCRAPER_PIPELINE = `
# Specialist: scraper / data pipeline

You are writing a job that pulls data from external sources and stores
the normalised result. Battle-tested patterns:

- HTTP fetch through undici with timeout: 10s connect, 30s body, 3 retries
  with exponential backoff (250ms, 750ms, 2000ms). NEVER use raw fetch
  without a timeout.
- Respect robots.txt — fetch and parse it before scraping any new domain.
  Cache for 24h.
- Rate-limit per domain: max 1 req/sec by default, configurable in
  config/rate-limits.json. Use bottleneck (allow-listed) or a simple
  token-bucket in Redis.
- User-Agent: identifies as 'Argo/1.0 (https://argo-ops.run)'. Rotating
  UAs are a smell — refuse to write that.
- Parsing: cheerio for HTML, undici's stream JSON for big payloads.
- Idempotency: every scraped record has a stable hash (sha256 of canonical
  fields) used as the Mongo _id. Re-runs are upserts, not duplicates.
- Failure handling: per-item try/catch is OK here (this is the one
  exception to the no-try/catch rule). Failures append to a \`scrape_errors\`
  collection with the URL, error, and a snapshot of the response.
`.trim();

const SPEC_SCHEDULED_JOB = `
# Specialist: scheduled job

You are writing a cron-driven job. Battle-tested patterns:

- Use croner (allow-listed). NEVER node-cron — it has timezone bugs.
- Always pass { timezone: '<IANA>' } explicitly. UTC by default if unset.
- The job body is a single async function exported as default. The cron
  shell only handles scheduling.
- Distributed locking via Redis SETNX with TTL = job.maxDurationMs * 2.
  If the lock can't be acquired, the job logs and exits gracefully — it
  does NOT throw.
- Every job emits start / success / failure events to runtime_events so
  the observability sidecar tracks job health.
- Long-running jobs (>60s) write progress checkpoints every 30s so the
  repair worker knows the job is alive vs hung.
- On SIGTERM, finish the current iteration, write a checkpoint, exit
  cleanly. Never abort mid-iteration.
`.trim();

const SPEC_WEBHOOK_BRIDGE = `
# Specialist: webhook bridge / inbound HTTP handler

You are writing a service that receives webhooks from a third party and
forwards normalised events. Battle-tested patterns:

- Verify HMAC signature BEFORE reading the body (use a raw-body parser
  hook). Unsigned requests return 401 immediately, no body read.
- Acknowledge fast: respond 200 within 200ms, do real work in a queued
  job. The webhook contract demands fast acks.
- Replay protection: store each delivery's id in Redis with 7d TTL. Reject
  duplicates with 200 (not 409 — vendors retry on non-200).
- Normalise the payload to an Argo-internal event shape BEFORE persisting,
  so the rest of the system never sees vendor-specific JSON.
- Forwarding: use BullMQ to a downstream queue. The queue's job options:
  { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100 }.
- Log the vendor event id + the internal event id so traces correlate.
`.trim();

const SPEC_SLACK_BOT = `
# Specialist: Slack bot

You are writing a Slack app's backend. Battle-tested patterns:

- Use @slack/bolt (request its addition via dyad-add-dependency).
- Verify Slack signature on every inbound — Bolt does this automatically
  if you give it the SLACK_SIGNING_SECRET.
- Acknowledge interactive payloads within 3 seconds. Push real work to
  BullMQ. ack() before doing anything.
- Block Kit only — never legacy attachments. JSON-build blocks; never
  string-template them.
- Modals: every submission validates input, returns response_action:
  'errors' on failure, 'clear' on success.
- Threading: every bot message in a thread uses thread_ts of the original
  trigger so conversations don't pollute the channel.
- DM the user on errors that are their fault; log silently on errors that
  are ours. Don't post error messages publicly.
`.trim();

const SPEC_FORM_WORKFLOW = `
# Specialist: form-submission workflow (Argo's v1 default — Maya's archetype)

You are writing the deterministic runtime for a form-submission workflow:
public form → submission → classification → human approval → outbound
email → digest. Battle-tested patterns:

- The form HTML is server-rendered, no client framework. Tailwind via CDN
  is fine in this one specific case (the form is single-purpose). NO React,
  NO build step for the form HTML.
- The submission endpoint validates with Zod, persists to Mongo, then
  POSTs to the Argo control plane's /internal/submission endpoint. The
  control plane handles classification, drafting, and approval — the
  runtime stays dumb.
- Approval URLs (/a/:token) are one-time, sha256-hashed at rest, expire
  in 72h, send a 48h reminder, auto-decline at 72h.
- Email rendering uses escapeForEmail() for every variable. Never inline
  user-supplied strings.
- The Monday digest cron (croner, '0 9 * * 1', timezone from env)
  POSTs to /internal/digest-tick and exits — composition happens upstream.
- Every error in any handler emits to /internal/events so the observability
  sidecar sees it. Don't catch+swallow.
- The runtime exposes /health (always 200 once Mongo is connected) and
  /readiness (200 only when the seed-templates job has completed).
`.trim();

const SPEC_GENERIC = `
# Specialist: generic Node.js service

Default to the conventions in BUILD_SYSTEM_PROMPT. Prefer minimal
dependencies; use the standard library where possible.
`.trim();

const SPECIALIST_BLOCKS: Record<Specialist, string> = {
  rest_api: SPEC_REST_API,
  crud_app: SPEC_CRUD_APP,
  scraper_pipeline: SPEC_SCRAPER_PIPELINE,
  scheduled_job: SPEC_SCHEDULED_JOB,
  webhook_bridge: SPEC_WEBHOOK_BRIDGE,
  slack_bot: SPEC_SLACK_BOT,
  form_workflow: SPEC_FORM_WORKFLOW,
  generic: SPEC_GENERIC,
};

/**
 * Heuristic dispatch — given the workflow archetype + trigger + a free-text
 * description, pick the specialist whose patterns best fit. Deterministic;
 * the model never picks its own persona.
 */
export function pickSpecialist(args: {
  archetype: string;
  triggerKind: string;
  description: string;
}): Specialist {
  const desc = args.description.toLowerCase();
  if (args.archetype === 'candidate_intake' || args.archetype === 'lead_qualification') {
    return 'form_workflow';
  }
  if (args.triggerKind === 'scheduled') return 'scheduled_job';
  if (/\bslack\b/.test(desc)) return 'slack_bot';
  if (/\b(scrape|scraper|crawl|crawler|extract data)\b/.test(desc)) return 'scraper_pipeline';
  if (/\b(webhook|callback|inbound http)\b/.test(desc)) return 'webhook_bridge';
  if (/\b(crud|admin panel|dashboard with edit|manage records)\b/.test(desc)) return 'crud_app';
  if (/\b(api|rest|graphql|endpoints?)\b/.test(desc)) return 'rest_api';
  if (args.triggerKind === 'form_submission') return 'form_workflow';
  return 'generic';
}

/**
 * Construct the full system prompt for a specific specialist invocation.
 * Layers: BUILD prompt + Blaxel runtime contract + specialist patterns.
 */
export function buildSpecialistSystemPrompt(specialist: Specialist): string {
  return [
    BUILD_SYSTEM_PROMPT,
    `\n\n# Runtime contract (Blaxel)\n\n${BLAXEL_SANDBOX_CONTROL}`,
    `\n\n${SPECIALIST_BLOCKS[specialist]}`,
  ].join('');
}

export const ALL_SPECIALISTS: readonly Specialist[] = [
  'rest_api',
  'crud_app',
  'scraper_pipeline',
  'scheduled_job',
  'webhook_bridge',
  'slack_bot',
  'form_workflow',
  'generic',
] as const;
