// Demo seeder — pops a fully-loaded example operation into the
// caller's workspace so a board demo doesn't have to wait through a
// real build. Session-authed (you can only seed your own workspace).
// Idempotent by name: re-running upserts the same operation id.
//
//   POST /api/dev/seed-demo  -> { operationId, name }
//
// Inserts:
//   - 1 Operation row (status=running, publicUrl set)
//   - 1 project_brief
//   - 1 operation_bundle (8 files of realistic-shape contents)
//   - 12 submissions across the past week
//   - 14 agent_invocations with cost/duration/status mix
//   - 6 activity_feed entries
//   - 1 operation_repair (awaiting approval, stale)
//   - 1 operation_readme (cached)

import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { logger } from '../logger.js';

const DEMO_NAME = 'Candidate Intake';
const DEMO_SLUG_PREFIX = 'candidate-intake-demo';

export async function registerDevRoutes(app: FastifyInstance) {
  app.post('/api/dev/seed-demo', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    // Re-runs upsert by deterministic slug per owner.
    const ownerId = session.userId;
    const slug = `${DEMO_SLUG_PREFIX}-${ownerId.slice(-6)}`;

    let op = await getPrisma().operation.findFirst({
      where: { ownerId, slug },
    });
    if (!op) {
      op = await getPrisma().operation.create({
        data: {
          ownerId,
          slug,
          name: DEMO_NAME,
          timezone: 'America/New_York',
          status: 'running',
          publicUrl: `https://demo.argo.run/${slug}`,
          submissionsToday: 4,
          pendingApprovals: 1,
          bundleVersion: 3,
          deploymentProvider: 'blaxel',
          deploymentSandboxId: `sb_demo_${slug}`,
          deploymentRegion: 'us-east-1',
          lastEventAt: new Date(),
        },
      });
    }

    const { db } = await getMongo();
    const now = Date.now();
    const day = 86_400_000;
    const ago = (ms: number) => new Date(now - ms).toISOString();

    // ── Brief ───────────────────────────────────────────────────────
    await db.collection('project_briefs').deleteMany({ operationId: op.id });
    await db.collection('project_briefs').insertOne({
      operationId: op.id,
      ownerId,
      name: DEMO_NAME,
      audience: 'Software-engineering candidates applying to a recruiting client',
      outcome:
        'Read each application, reject the weakest with a personalised note, forward strong ones to the hiring client with a one-click approval.',
      trigger: 'form_submission',
      fields: [
        { id: 'name', label: 'Full name', type: 'short_text', required: true, options: [] },
        { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
        { id: 'github', label: 'GitHub URL', type: 'url', required: false, options: [] },
        { id: 'years_exp', label: 'Years of experience', type: 'number', required: true, options: [] },
        {
          id: 'role',
          label: 'Role applying for',
          type: 'select',
          required: true,
          options: ['Senior Backend', 'Senior Frontend', 'Staff Eng'],
        },
        { id: 'cover_letter', label: 'Cover letter', type: 'long_text', required: false, options: [] },
      ],
      integrations: ['mongodb'],
      auth: 'magic_link',
      persistence: 'mongodb',
      rateLimits: { formPerMinutePerIp: 60, webhookPerMinutePerIp: 1000 },
      dataClassification: 'pii',
      successCriteria: [
        'Every applicant receives a reply within 24 hours.',
        'Strong candidates land in the hiring client\'s inbox with a one-click approval link.',
        'Maya can override the auto-reject within a 4-minute hold window.',
      ],
      voiceTone: 'Warm, direct, never patronising. Maya signs off as "Maya at Pinwheel Recruiting".',
      replyStyle: 'professional',
      scheduling: { digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' },
      notificationRecipients: [session.email],
      complianceNotes: 'Do not store SSN/EIN. Strip resume URLs from outbound mail to the hiring client.',
      defaulted: [],
      questionnaireId: 'q_demo_seed',
      generatedAt: ago(7 * day),
      buildPrompt: '# Build prompt for "Candidate Intake"\n\n(seeded for demo)',
      persistedAt: ago(7 * day),
    } as Record<string, unknown>);

    // ── Bundle ──────────────────────────────────────────────────────
    await db.collection('operation_bundles').deleteMany({ operationId: op.id });
    const files = demoBundleFiles();
    await db.collection('operation_bundles').insertOne({
      operationId: op.id,
      version: 3,
      manifest: {
        operationId: op.id,
        operationSlug: slug,
        bundleVersion: 3,
        workflowMapVersion: 1,
        requiredEnv: ['ARGO_OPERATION_ID', 'INTERNAL_API_KEY', 'MONGODB_URI'],
        dependencies: {
          fastify: '4.28.1',
          '@fastify/helmet': '11.1.1',
          '@fastify/cors': '9.0.1',
          '@fastify/rate-limit': '9.1.0',
          zod: '3.23.8',
          undici: '6.19.8',
          mongodb: '6.8.0',
          pino: '9.4.0',
        },
      },
      files: files.map((f) => ({
        path: f.path,
        contents: f.contents,
        sha256: '0'.repeat(64),
        argoGenerated: f.argoGenerated,
        sourceStepId: 'seed',
        size: f.contents.length,
      })),
      filesSummary: files.map((f) => ({
        path: f.path,
        sha256: '0'.repeat(64),
        argoGenerated: f.argoGenerated,
        size: f.contents.length,
      })),
      generatedByModel: 'gpt-5.5',
      aiCycles: 2,
      createdAt: ago(2 * day),
    } as Record<string, unknown>);

    // ── Submissions ─────────────────────────────────────────────────
    await db.collection('submissions').deleteMany({ operationId: op.id });
    const submissions = [
      { name: 'Maya Lin', role: 'Senior Backend', years: 7, ageMs: 2 * 3_600_000 },
      { name: 'Jordan Reeves', role: 'Senior Frontend', years: 5, ageMs: 5 * 3_600_000 },
      { name: 'Priya Shah', role: 'Staff Eng', years: 11, ageMs: 12 * 3_600_000 },
      { name: 'Tom Webb', role: 'Senior Backend', years: 3, ageMs: 1 * day },
      { name: 'Sam Park', role: 'Senior Frontend', years: 6, ageMs: 1.5 * day },
      { name: 'Alex Doyle', role: 'Senior Backend', years: 8, ageMs: 2 * day },
      { name: 'Riya Mehta', role: 'Staff Eng', years: 13, ageMs: 2.5 * day },
      { name: 'Chris Vu', role: 'Senior Frontend', years: 4, ageMs: 3 * day },
      { name: 'Naomi Park', role: 'Senior Backend', years: 6, ageMs: 4 * day },
      { name: 'Diego Marin', role: 'Senior Backend', years: 9, ageMs: 5 * day },
      { name: 'Sofia Costa', role: 'Senior Frontend', years: 7, ageMs: 6 * day },
      { name: 'Ben Karp', role: 'Staff Eng', years: 14, ageMs: 6.5 * day },
    ];
    await db.collection('submissions').insertMany(
      submissions.map((s, i) => ({
        id: `sub_demo_${i}_${nanoid(6)}`,
        operationId: op.id,
        ownerId,
        receivedAt: ago(s.ageMs),
        createdAt: ago(s.ageMs),
        payload: {
          name: s.name,
          email: `${s.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
          role: s.role,
          years_exp: s.years,
        },
      })) as Record<string, unknown>[],
    );

    // ── Agent invocations ───────────────────────────────────────────
    await db.collection('agent_invocations').deleteMany({ operationId: op.id });
    const invocations: Record<string, unknown>[] = [
      // 2 build cycles for the original deploy
      mkInv({ kind: 'build_stream', model: 'gpt-5.5', status: 'succeeded', ageMs: 7 * day, durationMs: 28_400, prompt: 5240, completion: 8120, costUsd: 0.188 }),
      mkInv({ kind: 'build_stream', model: 'gpt-5.5', status: 'succeeded', ageMs: 7 * day - 35_000, durationMs: 24_900, prompt: 7430, completion: 8000, costUsd: 0.197 }),
      // Classification of every submission
      ...submissions.map((s) =>
        mkInv({
          kind: 'classify_submission',
          model: 'gpt-4o-mini',
          status: 'succeeded',
          ageMs: s.ageMs - 60_000,
          durationMs: 850 + Math.floor(Math.random() * 400),
          prompt: 720,
          completion: 180,
          costUsd: 0.000_22,
          operationId: op.id,
          ownerId,
        }),
      ),
      // 1 weekly digest
      mkInv({ kind: 'compose_digest', model: 'gpt-4o', status: 'succeeded', ageMs: 1 * day, durationMs: 4_200, prompt: 1900, completion: 980, costUsd: 0.0148 }),
      // 1 readme generation
      mkInv({ kind: 'compose_readme', model: 'gpt-5.5', status: 'succeeded', ageMs: 1 * day - 60_000, durationMs: 6_800, prompt: 1320, completion: 980, costUsd: 0.0263 }),
      // 1 repair proposal
      mkInv({ kind: 'propose_repair', model: 'claude-opus-4-7', status: 'succeeded', ageMs: 5 * 3_600_000, durationMs: 9_400, prompt: 2240, completion: 3010, costUsd: 0.260 }),
      // 1 failed parse (visible in stats)
      mkInv({ kind: 'classify_submission', model: 'gpt-4o-mini', status: 'failed_parse', ageMs: 4 * 3_600_000, durationMs: 1_100, prompt: 740, completion: 60, costUsd: 0.000_15 }),
    ];
    // attach common fields
    for (const inv of invocations) {
      (inv as Record<string, unknown>).operationId = op.id;
      (inv as Record<string, unknown>).ownerId = ownerId;
    }
    await db.collection('agent_invocations').insertMany(invocations);

    // ── Activity feed ───────────────────────────────────────────────
    await db.collection('activity_feed').deleteMany({ ownerId, operationId: op.id });
    await db.collection('activity_feed').insertMany([
      {
        id: 'act_demo_1',
        ownerId,
        operationId: op.id,
        operationName: DEMO_NAME,
        kind: 'deployed',
        message: 'Shipped v3 via GPT-5.5 (2 cycles) — live at demo.argo.run.',
        occurredAt: ago(2 * day),
        readAt: ago(2 * day - 60_000),
      },
      {
        id: 'act_demo_2',
        ownerId,
        operationId: op.id,
        operationName: DEMO_NAME,
        kind: 'submission',
        message: '3 new candidate applications today.',
        occurredAt: ago(2 * 3_600_000),
        readAt: null,
      },
      {
        id: 'act_demo_3',
        ownerId,
        operationId: op.id,
        operationName: DEMO_NAME,
        kind: 'approval_pending',
        message: 'Strong candidate forwarded — awaiting your approve/edit/decline.',
        occurredAt: ago(5 * 3_600_000),
        readAt: null,
      },
      {
        id: 'act_demo_4',
        ownerId,
        operationId: op.id,
        operationName: DEMO_NAME,
        kind: 'repair_proposed',
        message: 'Argo proposed a repair — outbound mail SPF was failing on Tom Webb\'s reject.',
        occurredAt: ago(5 * 3_600_000 + 60_000),
        readAt: null,
      },
      {
        id: 'act_demo_5',
        ownerId,
        operationId: op.id,
        operationName: DEMO_NAME,
        kind: 'digest',
        message: 'Monday digest sent: 12 applications, 8 rejects, 4 forwarded.',
        occurredAt: ago(1 * day),
        readAt: ago(20 * 3_600_000),
      },
      {
        id: 'act_demo_6',
        ownerId,
        operationId: op.id,
        operationName: DEMO_NAME,
        kind: 'memory_written',
        message: 'Saved voice preference: "warm, direct, never patronising".',
        occurredAt: ago(7 * day),
        readAt: ago(6 * day),
      },
    ] as Record<string, unknown>[]);

    // ── Repair (awaiting approval, stale) ──────────────────────────
    await db.collection('operation_repairs').deleteMany({ operationId: op.id });
    await db.collection('operation_repairs').insertOne({
      id: 'rep_demo_' + nanoid(8),
      operationId: op.id,
      triggerEventIds: ['evt_demo_spf_fail'],
      failureKind: 'outbound_mail_spf_misalignment',
      status: 'awaiting_approval',
      cycleNumber: 1,
      smallerChangeForced: false,
      diagnosis:
        'Outbound mail to Tom Webb\'s domain bounced — SPF lookup returned softfail because the From envelope used the operator domain but DKIM was signed by Argo\'s sender.',
      plainEnglishSummary:
        'Switch the From envelope to the verified Argo sender so SPF aligns. Recipient sees the same Reply-To.',
      whatBroke:
        'SPF softfail on apply.example.com → bounce on bigcorp.com. Reject email to Tom Webb didn\'t deliver.',
      whatChanged:
        'Updated email/templates/reject.js to set envelope.from = MAILER_FROM_VERIFIED instead of operator.email.',
      whatWeTested:
        'Re-ran the synthetic happy-path test against bigcorp.com sandbox; mail accepted with PASS on SPF + DKIM.',
      patchedFiles: [
        {
          path: 'email/templates/reject.js',
          beforeSha256: '0'.repeat(64),
          afterSha256: '0'.repeat(64),
          diffUnified: '-  envelope.from = operator.email;\n+  envelope.from = process.env.MAILER_FROM_VERIFIED;',
          reason: 'SPF must align with the envelope sender, not the operator address.',
        },
      ],
      testReport: null,
      approvalTokenHash: '0'.repeat(64),
      approvalEmailedAt: ago(5 * 3_600_000),
      approvedAt: null,
      deployedAt: null,
      rolledBackAt: null,
      createdAt: ago(5 * 3_600_000),
      proposedFiles: [],
    } as Record<string, unknown>);

    // ── Cached README ──────────────────────────────────────────────
    await db
      .collection('operation_readmes')
      .deleteMany({ operationId: op.id });
    await db.collection('operation_readmes').insertOne({
      operationId: op.id,
      ownerId,
      bundleVersion: 3,
      readme: {
        title: 'Candidate Intake',
        oneLine: 'Every applicant gets a thoughtful reply within 24 hours, automatically.',
        whatItDoes:
          'Pinwheel Recruiting receives 50–80 candidate applications a week. This operation reads each one, scores fit against the role brief, and either rejects the weakest with a personalised note in Maya\'s voice or forwards strong ones to the hiring client with a one-click approval link.\n\nMaya gets a Monday-morning prose digest summarising the week so she never opens Argo unless something needs her judgement.',
        howItWorks:
          'A form on the recruiting site posts to Argo. Argo runs a small classifier on each submission and decides reject / hold / forward.\n\nStrong candidates land in Maya\'s email with three buttons: Approve, Edit, Decline. Weak candidates get a personalised rejection email written in Maya\'s voice — Argo waits 4 minutes before sending so a human can intercept.',
        ifSomethingBreaks:
          'If a submission doesn\'t show up, check the public form URL in the workspace and resubmit. If the auto-reply has the wrong tone, edit the voice card in Scoping; the next reply will use the new style.\n\nIf anything serious breaks, Argo will email you with a proposed fix and three buttons. Repairs are never auto-applied.',
      },
      generatedAt: ago(2 * day),
    } as Record<string, unknown>);

    logger.info({ operationId: op.id, ownerId }, 'demo seeder completed');

    return reply.send({
      ok: true,
      operationId: op.id,
      name: op.name,
      slug: op.slug,
      publicUrl: op.publicUrl,
    });
  });
}

// ── helpers ────────────────────────────────────────────────────────

function mkInv(args: {
  kind: string;
  model: string;
  status: string;
  ageMs: number;
  durationMs: number;
  prompt: number;
  completion: number;
  costUsd: number;
  operationId?: string;
  ownerId?: string;
}): Record<string, unknown> {
  return {
    id: 'inv_demo_' + nanoid(10),
    kind: args.kind,
    provider: args.model.startsWith('claude') ? 'anthropic' : 'openai',
    model: args.model,
    status: args.status,
    durationMs: args.durationMs,
    promptTokens: args.prompt,
    completionTokens: args.completion,
    costUsd: args.costUsd,
    createdAt: new Date(Date.now() - args.ageMs).toISOString(),
    completedAt: new Date(Date.now() - args.ageMs + args.durationMs).toISOString(),
    errorMessage: args.status.startsWith('failed') ? 'JSON parse failed at offset 412' : null,
    envelope: { redacted: true, demo: true },
    rawResponse: '(seeded demo invocation — raw response not included)',
  };
}

function demoBundleFiles(): Array<{ path: string; contents: string; argoGenerated: boolean }> {
  return [
    {
      path: 'package.json',
      argoGenerated: false,
      contents: JSON.stringify(
        {
          name: 'candidate-intake',
          version: '0.3.0',
          type: 'module',
          main: 'server.js',
          scripts: { start: 'node server.js' },
          dependencies: {
            fastify: '4.28.1',
            '@fastify/helmet': '11.1.1',
            '@fastify/cors': '9.0.1',
            '@fastify/rate-limit': '9.1.0',
            zod: '3.23.8',
            undici: '6.19.8',
            mongodb: '6.8.0',
            pino: '9.4.0',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'server.js',
      argoGenerated: true,
      contents: `// argo:generated
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import pino from 'pino';
import { registerSubmissions } from './routes/submissions.js';
import { registerWebhooks } from './routes/webhooks.js';
import { connectMongo } from './db/mongo.js';

const log = pino({ name: 'candidate-intake', level: process.env.LOG_LEVEL ?? 'info' });

async function main() {
  const app = Fastify({ logger: log, trustProxy: true, bodyLimit: 2_000_000 });
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.setErrorHandler((err, _req, reply) => {
    log.warn({ err: err.message, code: err.statusCode }, 'request_error');
    reply.code(err.statusCode ?? 500).send({ error: err.code ?? 'internal_error' });
  });
  await app.register(helmet, { global: true });
  await app.register(cors, { origin: process.env.FORM_ALLOWED_ORIGINS?.split(',') ?? '*' });
  await app.register(rateLimit, { global: false, max: 60, timeWindow: '1 minute' });
  await connectMongo();
  await registerSubmissions(app);
  await registerWebhooks(app);
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'candidate-intake listening');
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, async () => { log.info({ sig }, 'shutting down'); await app.close(); process.exit(0); });
  }
}
main().catch((err) => { console.error('fatal', err); process.exit(1); });
`,
    },
    {
      path: 'routes/submissions.js',
      argoGenerated: true,
      contents: `// argo:generated
import { z } from 'zod';
import { db } from '../db/mongo.js';
import { classify } from '../classifier/score-fit.js';
import { sendReject, queueForward } from '../mailer/index.js';

const Submission = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  github: z.string().url().optional(),
  years_exp: z.number().min(0).max(60),
  role: z.enum(['Senior Backend', 'Senior Frontend', 'Staff Eng']),
  cover_letter: z.string().max(4000).optional(),
});

export async function registerSubmissions(app) {
  app.post('/submissions', async (request, reply) => {
    request.log.info({ ip: request.ip }, 'inbound_submission');
    const body = Submission.parse(request.body);
    const id = crypto.randomUUID();
    const score = await classify(body);
    await db.collection('submissions').insertOne({
      id, ...body, score, status: score.decision, createdAt: new Date().toISOString(),
    });
    if (score.decision === 'reject') queueForward(id, 'reject', body, score);
    if (score.decision === 'forward') queueForward(id, 'forward', body, score);
    reply.code(202).type('application/json').send({ submissionId: id });
  });
}
`,
    },
    {
      path: 'classifier/score-fit.js',
      argoGenerated: true,
      contents: `// argo:generated
import { request as undiciRequest } from 'undici';

const SYSTEM = \`You are a recruiting screener. Given a candidate's role, years of experience,
and cover letter, return a JSON object: { decision: 'reject'|'hold'|'forward', reason: string }.\`;

export async function classify(submission) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await undiciRequest('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: \`Bearer \${apiKey}\`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(submission) },
      ],
    }),
    bodyTimeout: 8_000,
  });
  const data = await res.body.json();
  return JSON.parse(data.choices[0].message.content);
}
`,
    },
    {
      path: 'mailer/index.js',
      argoGenerated: true,
      contents: `// argo:generated
import { renderRejectEmail, renderForwardEmail } from './templates.js';

const QUEUE = [];
const HOLD_MS = 4 * 60 * 1000;

export function queueForward(submissionId, kind, body, score) {
  const sendAt = Date.now() + (kind === 'reject' ? HOLD_MS : 0);
  QUEUE.push({ submissionId, kind, body, score, sendAt });
}

export async function sendReject(submission, score) {
  const html = renderRejectEmail(submission, score);
  // delegate to operator's verified sender via /internal/send
  await fetch(process.env.ARGO_CONTROL_PLANE_URL + '/internal/send-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-key': process.env.INTERNAL_API_KEY,
    },
    body: JSON.stringify({ to: submission.email, subject: 'Your application', html }),
  });
}
`,
    },
    {
      path: 'mailer/templates.js',
      argoGenerated: true,
      contents: `// argo:generated
import { escapeForEmail } from '../security/escape.js';

export function renderRejectEmail(s, score) {
  return \`<p>Hi \${escapeForEmail(s.name.split(' ')[0])},</p>
<p>Thank you for applying for the \${escapeForEmail(s.role)} role. After reviewing your background,
we're not moving forward at this time. \${escapeForEmail(score.reason ?? '')}.</p>
<p>Wishing you the best,<br>Maya at Pinwheel Recruiting</p>\`;
}

export function renderForwardEmail(s, score) {
  return \`<p>Strong applicant for \${escapeForEmail(s.role)}:</p>
<ul>
  <li>Name: \${escapeForEmail(s.name)}</li>
  <li>Email: \${escapeForEmail(s.email)}</li>
  <li>Years: \${escapeForEmail(String(s.years_exp))}</li>
  <li>Score: \${escapeForEmail(score.reason ?? '')}</li>
</ul>\`;
}
`,
    },
    {
      path: 'security/escape.js',
      argoGenerated: false,
      contents: `// scaffolding — frozen
const MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
export function escapeForEmail(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, (c) => MAP[c]);
}
`,
    },
    {
      path: 'db/mongo.js',
      argoGenerated: false,
      contents: `// scaffolding — frozen
import { MongoClient } from 'mongodb';
let client; export let db;
export async function connectMongo() {
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db();
  await db.collection('submissions').createIndex({ createdAt: -1 });
  await db.collection('submissions').createIndex({ email: 1 });
}
`,
    },
  ];
}
