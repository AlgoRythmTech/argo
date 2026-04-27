import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import {
  composeOperationReadme,
  fallbackNameFromSentence,
  proposeOperationName,
  renderReadmeAsMarkdown,
  type OperationReadme,
} from '@argo/agent';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity, recentActivity } from '../stores/activity-store.js';
import { logger } from '../logger.js';

const CreateOperationBody = z.object({
  name: z.string().min(3).max(80),
  timezone: z.string().min(3).max(64).default('America/New_York'),
});

const UpdateOperationBody = z.object({
  name: z.string().min(3).max(80).optional(),
  status: z.enum(['draft', 'paused', 'archived']).optional(),
});

export async function registerOperationsRoutes(app: FastifyInstance) {
  app.get('/api/operations', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const ops = await getPrisma().operation.findMany({
      where: { ownerId: session.userId, status: { not: 'archived' } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        publicUrl: true,
        pendingApprovals: true,
        submissionsToday: true,
        lastEventAt: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return ops;
  });

  app.post('/api/operations', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CreateOperationBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    // Smart auto-naming: when the operator submits a free-text sentence
    // as the operation name (looks like a sentence — has spaces, > 20 chars,
    // contains a verb-ish ending), ask GPT-5.5 for a clean 2-4 word
    // Title Case name. Fall back to a deterministic stop-word strip if
    // the LLM is unreachable. Operator's literal input wins for short
    // explicitly-named operations (<= 20 chars).
    const rawName = parsed.data.name.trim();
    let finalName = rawName;
    if (looksLikeSentence(rawName)) {
      try {
        const proposed = await proposeOperationName({ sentence: rawName });
        finalName = proposed.name;
      } catch (err) {
        logger.info({ err: String(err).slice(0, 200) }, 'auto-name LLM failed, using fallback');
        finalName = fallbackNameFromSentence(rawName);
      }
    }

    const slug = `${slugify(finalName)}-${nanoid(6).toLowerCase()}`;
    const op = await getPrisma().operation.create({
      data: {
        ownerId: session.userId,
        slug,
        name: finalName,
        timezone: parsed.data.timezone,
        status: 'draft',
      },
    });
    return reply.code(201).send(op);
  });

  app.get('/api/operations/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    return op;
  });

  /**
   * POST /api/operations/:id/archive — soft-archive. Status flips to
   * 'archived'; Blaxel sandbox is torn down; the operation drops out of
   * the operations list. Restorable for 30 days.
   */
  app.post('/api/operations/:id/archive', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    if (op.status === 'archived') return reply.send({ ok: true, alreadyArchived: true });

    // Best-effort tear down. Blaxel returns success even if the sandbox is gone.
    if (op.deploymentSandboxId) {
      try {
        const { createExecutionProvider } = await import('@argo/workspace-runtime');
        const provider = createExecutionProvider();
        await provider.teardown({
          provider: (op.deploymentProvider as 'blaxel' | 'docker_mock' | null) ?? 'docker_mock',
          environment: 'production',
          sandboxName: op.deploymentSandboxId,
          sandboxId: op.deploymentSandboxId,
          region: op.deploymentRegion,
          publicUrl: op.publicUrl ?? '',
          internalEndpoint: null,
          ports: [{ target: 3000, protocol: 'HTTP' }],
          createdAt: new Date(op.createdAt).toISOString(),
        });
      } catch {
        /* idempotent */
      }
    }

    const updated = await getPrisma().operation.update({
      where: { id },
      data: { status: 'archived', publicUrl: null },
    });
    await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'archived',
      message: `Archived ${op.name}.`,
    });
    return reply.send(updated);
  });

  /**
   * POST /api/operations/:id/restore — undo archive. Status returns to 'draft'.
   * The sandbox is NOT auto-rebuilt; the operator must redeploy.
   */
  app.post('/api/operations/:id/restore', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({
      where: { id, ownerId: session.userId, status: 'archived' },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    const restored = await getPrisma().operation.update({
      where: { id },
      data: { status: 'draft' },
    });
    await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'restored',
      message: `Restored ${op.name} — redeploy to bring it back online.`,
    });
    return reply.send(restored);
  });

  /**
   * DELETE /api/operations/:id — hard delete. Only allowed on archived
   * operations (operator must archive first). Tears down all per-operation
   * data: bundles, briefs, scoping questionnaires, approvals, templates,
   * runtime events, and the operation row itself. Audit lives in
   * operation_repairs (compliance — never deleted).
   */
  app.delete('/api/operations/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    if (op.status !== 'archived') {
      return reply.code(409).send({
        error: 'must_archive_first',
        message: 'Archive the operation before deleting. This is intentional friction.',
      });
    }

    const { db } = await getMongo();
    await Promise.all([
      db.collection('operation_bundles').deleteMany({ operationId: id }),
      db.collection('project_briefs').deleteMany({ operationId: id }),
      db.collection('scoping_questionnaires').deleteMany({ operationId: id }),
      db.collection('workflow_maps').deleteMany({ operationId: id }),
      db.collection('workflow_intents').deleteMany({ operationId: id }),
      db.collection('templates').deleteMany({ operationId: id }),
      db.collection('runtime_events').deleteMany({ operationId: id }),
      db.collection('agent_invocations').deleteMany({ operationId: id }),
      db.collection('submissions').deleteMany({ operationId: id }),
      db.collection('inbound_emails').deleteMany({ 'routingHint.operationId': id }),
      // operation_repairs is INTENTIONALLY preserved — compliance audit.
    ]);
    await getPrisma().approval.deleteMany({ where: { operationId: id } });
    await getPrisma().templateCounter.deleteMany({ where: { operationId: id } });
    await getPrisma().operation.delete({ where: { id } });

    return reply.code(204).send();
  });

  app.patch('/api/operations/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const parsed = UpdateOperationBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const owned = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!owned) return reply.code(404).send({ error: 'not_found' });
    const updated = await getPrisma().operation.update({ where: { id }, data: parsed.data });
    return updated;
  });

  app.get('/api/operations/:id/map', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const owned = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!owned) return reply.code(404).send({ error: 'not_found' });
    const { db } = await getMongo();
    const map = await db
      .collection('workflow_maps')
      .find({ operationId: id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!map) return reply.code(404).send({ error: 'no_map_yet' });
    return map;
  });

  app.get('/api/activity', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return recentActivity(session.userId, 100);
  });

  /**
   * GET /api/operations/:id/files — read-only listing of the latest deployed
   * bundle for an operation. Used by the workspace's "Show generated code"
   * surface. Maya never opens it; a dev-mode visitor can audit what Argo
   * wrote on her behalf.
   */
  app.get('/api/operations/:id/files', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    const { db } = await getMongo();
    const bundle = await db
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!bundle) return reply.code(404).send({ error: 'no_bundle_yet' });
    const manifest = (bundle as { manifest?: { generatedByModel?: string } }).manifest ?? {};
    const files =
      ((bundle as { filesSummary?: Array<{ path: string; sha256: string; argoGenerated: boolean; size: number }> })
        .filesSummary ?? []).slice().sort((a, b) => a.path.localeCompare(b.path));
    return reply.send({
      operationId: op.id,
      version: (bundle as { version?: number }).version ?? 0,
      generatedByModel: manifest.generatedByModel ?? 'unknown',
      files,
    });
  });

  /**
   * GET /api/operations/:id/bundle-versions
   * Lists every persisted bundle version (newest first) so the diff
   * viewer can populate its from/to dropdowns.
   */
  app.get('/api/operations/:id/bundle-versions', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    const { db } = await getMongo();
    const docs = await db
      .collection('operation_bundles')
      .find({ operationId: id })
      .project({ version: 1, createdAt: 1, generatedByModel: 1, aiCycles: 1 })
      .sort({ version: -1 })
      .limit(40)
      .toArray();
    return reply.send({
      operationId: id,
      versions: docs.map((d) => ({
        version: Number(d.version ?? 0),
        createdAt: String(d.createdAt ?? ''),
        generatedByModel: String(d.generatedByModel ?? 'unknown'),
        aiCycles: Number(d.aiCycles ?? 0),
      })),
    });
  });

  /**
   * GET /api/operations/:id/bundle-diff?from=N&to=M
   * Diffs two bundle versions for the operation. Each file is
   * one of: added, removed, modified, unchanged. Modified files include
   * both copies so the UI can render side-by-side or unified diffs.
   */
  app.get('/api/operations/:id/bundle-diff', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const fromV = Number((request.query as { from?: string }).from);
    const toV = Number((request.query as { to?: string }).to);
    if (!Number.isInteger(fromV) || !Number.isInteger(toV)) {
      return reply.code(400).send({ error: 'invalid_versions' });
    }

    const { db } = await getMongo();
    const [fromDoc, toDoc] = await Promise.all([
      db.collection('operation_bundles').findOne({ operationId: id, version: fromV }),
      db.collection('operation_bundles').findOne({ operationId: id, version: toV }),
    ]);
    if (!fromDoc || !toDoc) return reply.code(404).send({ error: 'bundle_version_not_found' });

    type BundleFile = { path: string; contents?: string; sha256: string };
    const fromFiles = (fromDoc.files ?? []) as BundleFile[];
    const toFiles = (toDoc.files ?? []) as BundleFile[];
    const fromMap = new Map(fromFiles.map((f) => [f.path, f]));
    const toMap = new Map(toFiles.map((f) => [f.path, f]));

    const allPaths = new Set<string>([...fromMap.keys(), ...toMap.keys()]);
    const diffs: Array<{
      path: string;
      change: 'added' | 'removed' | 'modified' | 'unchanged';
      fromSha: string | null;
      toSha: string | null;
      fromContents?: string;
      toContents?: string;
    }> = [];
    for (const p of Array.from(allPaths).sort()) {
      const a = fromMap.get(p);
      const b = toMap.get(p);
      if (a && !b)
        diffs.push({ path: p, change: 'removed', fromSha: a.sha256, toSha: null, ...(a.contents !== undefined ? { fromContents: a.contents } : {}) });
      else if (!a && b)
        diffs.push({ path: p, change: 'added', fromSha: null, toSha: b.sha256, ...(b.contents !== undefined ? { toContents: b.contents } : {}) });
      else if (a && b && a.sha256 !== b.sha256)
        diffs.push({
          path: p,
          change: 'modified',
          fromSha: a.sha256,
          toSha: b.sha256,
          ...(a.contents !== undefined ? { fromContents: a.contents } : {}),
          ...(b.contents !== undefined ? { toContents: b.contents } : {}),
        });
      else if (a && b)
        diffs.push({ path: p, change: 'unchanged', fromSha: a.sha256, toSha: b.sha256 });
    }

    return reply.send({
      operationId: id,
      from: fromV,
      to: toV,
      diffs,
      summary: {
        added: diffs.filter((d) => d.change === 'added').length,
        removed: diffs.filter((d) => d.change === 'removed').length,
        modified: diffs.filter((d) => d.change === 'modified').length,
        unchanged: diffs.filter((d) => d.change === 'unchanged').length,
      },
    });
  });

  /**
   * GET /api/operations/:id/files/contents?path=...
   * Returns one file's contents from the latest bundle, read-only. Used by
   * the syntax-highlighted code viewer. Path is validated against the
   * persisted manifest to prevent any path-traversal weirdness.
   */
  app.get('/api/operations/:id/files/contents', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const path = String((request.query as { path?: string }).path ?? '').trim();
    if (!path) return reply.code(400).send({ error: 'missing_path' });

    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const bundle = await db
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!bundle) return reply.code(404).send({ error: 'no_bundle_yet' });

    const files =
      ((bundle as { files?: Array<{ path: string; contents: string; argoGenerated: boolean; sha256: string }> }).files ?? []);
    const found = files.find((f) => f.path === path);
    if (!found) {
      // Legacy bundles persist only filesSummary; surface a helpful error.
      const inSummary = ((bundle as { filesSummary?: Array<{ path: string }> }).filesSummary ?? []).some(
        (f) => f.path === path,
      );
      if (inSummary) {
        return reply.code(409).send({
          error: 'legacy_bundle_no_contents',
          message: 'This bundle was generated before per-file persistence. Redeploy to view contents.',
        });
      }
      return reply.code(404).send({ error: 'file_not_found' });
    }

    return reply.send({
      operationId: op.id,
      path: found.path,
      contents: found.contents,
      sha256: found.sha256,
      argoGenerated: found.argoGenerated,
      bytes: found.contents.length,
    });
  });

  /**
   * GET /api/operations/:id/files/search?q=…&caseSensitive=true|false
   *
   * Server-side grep across every file in the latest bundle. Returns
   * up to 200 matches across up to 50 files. Each match carries the
   * 1-indexed line number, the matching line text (truncated to 240
   * chars), and a small snippet of context (1 line above + below).
   *
   * The auditor surface — operators rarely use it, but inspectors and
   * security reviewers always want a way to grep "where do we touch
   * credit cards" or "where is escapeForEmail called" without having
   * to download the bundle.
   */
  app.get('/api/operations/:id/files/search', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const q = String((request.query as { q?: string }).q ?? '').trim();
    const caseSensitive =
      String((request.query as { caseSensitive?: string }).caseSensitive ?? 'false').toLowerCase() ===
      'true';
    if (q.length < 2) return reply.code(400).send({ error: 'query_too_short' });
    if (q.length > 200) return reply.code(400).send({ error: 'query_too_long' });

    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const bundle = await db
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!bundle) return reply.code(404).send({ error: 'no_bundle_yet' });

    const files =
      ((bundle as { files?: Array<{ path: string; contents: string; argoGenerated: boolean }> }).files ?? []);
    if (files.length === 0) {
      return reply.code(409).send({
        error: 'legacy_bundle_no_contents',
        message: 'This bundle was generated before per-file persistence. Redeploy to enable search.',
      });
    }

    const needle = caseSensitive ? q : q.toLowerCase();
    const MAX_MATCHES = 200;
    const MAX_FILES = 50;
    const MAX_LINE_CHARS = 240;
    type Match = { line: number; text: string; before: string | null; after: string | null };
    const fileResults: Array<{ path: string; argoGenerated: boolean; matches: Match[]; truncated: boolean }> = [];
    let total = 0;
    let truncated = false;

    for (const f of files) {
      if (fileResults.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      const lines = f.contents.split('\n');
      const matches: Match[] = [];
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] ?? '';
        const haystack = caseSensitive ? raw : raw.toLowerCase();
        if (haystack.includes(needle)) {
          matches.push({
            line: i + 1,
            text: raw.length > MAX_LINE_CHARS ? raw.slice(0, MAX_LINE_CHARS) + '…' : raw,
            before: i > 0 ? (lines[i - 1] ?? '').slice(0, MAX_LINE_CHARS) : null,
            after: i < lines.length - 1 ? (lines[i + 1] ?? '').slice(0, MAX_LINE_CHARS) : null,
          });
          total++;
          if (total >= MAX_MATCHES) {
            truncated = true;
            break;
          }
        }
      }
      if (matches.length > 0) {
        fileResults.push({
          path: f.path,
          argoGenerated: f.argoGenerated,
          matches,
          truncated: false,
        });
      }
      if (truncated) break;
    }

    return reply.send({
      operationId: op.id,
      bundleVersion: (bundle as { version?: number }).version ?? null,
      query: q,
      caseSensitive,
      matchCount: total,
      fileCount: fileResults.length,
      truncated,
      files: fileResults,
    });
  });

  /**
   * GET /api/operations/:id/health
   *
   * One-glance health snapshot for the workspace HealthBadge and the
   * monthly check-in. Aggregates from:
   *   - submissions collection (volume, last activity)
   *   - agent_invocations (failed LLM calls in last 24h)
   *   - operation_repairs (pending approvals + stale ones)
   *   - operations Postgres row (status, lastEventAt)
   *
   * Returns a top-level tone (good/warn/bad) computed from the alerts
   * array so the UI can color the badge without re-deriving the rule.
   */
  app.get('/api/operations/:id/health', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const now = Date.now();
    const day = 86_400_000;
    const oneDayAgo = new Date(now - day).toISOString();
    const sevenDaysAgo = new Date(now - 7 * day).toISOString();

    const [
      lastSubmission,
      submissionsLast24h,
      submissionsLast7d,
      failedInvocations24h,
      pendingRepairs,
      staleRepairs,
    ] = await Promise.all([
      db
        .collection('submissions')
        .find({ operationId: op.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .next(),
      db.collection('submissions').countDocuments({
        operationId: op.id,
        createdAt: { $gte: oneDayAgo },
      }),
      db.collection('submissions').countDocuments({
        operationId: op.id,
        createdAt: { $gte: sevenDaysAgo },
      }),
      db.collection('agent_invocations').countDocuments({
        operationId: op.id,
        createdAt: { $gte: oneDayAgo },
        status: { $in: ['failed_parse', 'failed_provider'] },
      }),
      db.collection('operation_repairs').countDocuments({
        operationId: op.id,
        status: 'awaiting_approval',
      }),
      db.collection('operation_repairs').countDocuments({
        operationId: op.id,
        status: 'awaiting_approval',
        approvalEmailedAt: { $lt: new Date(now - 4 * 3_600_000).toISOString() },
      }),
    ]);

    const lastSubmissionAt =
      (lastSubmission as { createdAt?: string } | null)?.createdAt ?? null;
    const lastSubmissionAgeMs = lastSubmissionAt
      ? now - new Date(lastSubmissionAt).getTime()
      : null;

    type Alert = {
      severity: 'info' | 'warn' | 'bad';
      kind: string;
      message: string;
    };
    const alerts: Alert[] = [];

    if (op.status === 'failed_build') {
      alerts.push({
        severity: 'bad',
        kind: 'build_failed',
        message: 'Last build failed. Re-deploy from the workspace toolbar.',
      });
    } else if (op.status === 'paused') {
      alerts.push({
        severity: 'warn',
        kind: 'paused',
        message: 'Operation is paused. Submissions are queued but not processed.',
      });
    }

    if (op.publicUrl && lastSubmissionAt && lastSubmissionAgeMs! > 14 * day) {
      alerts.push({
        severity: 'warn',
        kind: 'stale',
        message: `No submissions in ${Math.round(lastSubmissionAgeMs! / day)} days. Surface still live; check the public URL.`,
      });
    }

    if (failedInvocations24h > 0) {
      alerts.push({
        severity: failedInvocations24h >= 5 ? 'bad' : 'warn',
        kind: 'failed_invocations',
        message: `${failedInvocations24h} agent call${failedInvocations24h === 1 ? '' : 's'} failed in the last 24h.`,
      });
    }

    if (staleRepairs > 0) {
      alerts.push({
        severity: 'warn',
        kind: 'stale_approval',
        message: `${staleRepairs} repair approval${staleRepairs === 1 ? '' : 's'} waiting on you for over 4 hours.`,
      });
    }

    // Tone is the worst alert severity; if none, "good".
    const tone: 'good' | 'warn' | 'bad' = alerts.some((a) => a.severity === 'bad')
      ? 'bad'
      : alerts.some((a) => a.severity === 'warn')
      ? 'warn'
      : 'good';

    return reply.send({
      operationId: op.id,
      tone,
      status: op.status,
      lastSubmissionAt,
      lastSubmissionAgeMs,
      submissionsLast24h,
      submissionsLast7d,
      failedInvocations24h,
      pendingRepairs,
      staleRepairs,
      lastEventAt: op.lastEventAt,
      alerts,
      checkedAt: new Date().toISOString(),
    });
  });

  /**
   * GET /api/operations/:id/readme[?regenerate=true]
   *
   * On-demand operation README. Cached per (operationId, bundleVersion)
   * in the operation_readmes collection so we don't re-burn $0.05 of
   * GPT-5.5 every time the modal opens. Pass regenerate=true to bust
   * the cache (operator clicks "Regenerate" if a brief change makes
   * the cached one stale).
   *
   * Falls back gracefully when no brief or no bundle exists yet.
   */
  app.get('/api/operations/:id/readme', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const regenerate =
      String((request.query as { regenerate?: string }).regenerate ?? '').toLowerCase() === 'true';

    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();

    const bundle = await db
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    const bundleVersion = (bundle as { version?: number } | null)?.version ?? null;
    const filePaths =
      ((bundle as { files?: Array<{ path: string }>; filesSummary?: Array<{ path: string }> } | null)
        ?.files ??
        (bundle as { filesSummary?: Array<{ path: string }> } | null)?.filesSummary ??
        []).map((f) => f.path);
    const newDependencies = (
      (bundle as { manifest?: { dependencies?: Record<string, string> } } | null)?.manifest
        ?.dependencies ?? {}
    );
    const depsList = Object.keys(newDependencies);

    if (!regenerate && bundleVersion != null) {
      const cached = await db
        .collection('operation_readmes')
        .findOne({ operationId: op.id, bundleVersion });
      if (cached) {
        return reply.send({
          operationId: op.id,
          bundleVersion,
          generatedAt: cached.generatedAt,
          cached: true,
          readme: cached.readme,
          markdown: renderReadmeAsMarkdown(cached.readme as OperationReadme),
        });
      }
    }

    const briefDoc = await db
      .collection('project_briefs')
      .find({ operationId: op.id })
      .sort({ persistedAt: -1 })
      .limit(1)
      .next();
    if (!briefDoc) {
      return reply.code(409).send({
        error: 'no_brief_yet',
        message: 'Finalize the scoping questionnaire first — Argo writes the README from your brief.',
      });
    }

    type Brief = {
      name?: string;
      audience?: string;
      outcome?: string;
      trigger?: string;
      integrations?: string[];
      auth?: string;
      persistence?: string;
      successCriteria?: string[];
      voiceTone?: string | null;
      replyStyle?: string;
      complianceNotes?: string | null;
    };
    const brief = briefDoc as Brief;

    let readme: OperationReadme;
    try {
      readme = await composeOperationReadme({
        operationName: op.name,
        brief: {
          name: brief.name ?? op.name,
          audience: brief.audience ?? 'the operator',
          outcome: brief.outcome ?? 'automate the workflow described in the brief',
          trigger: brief.trigger ?? 'form_submission',
          integrations: brief.integrations ?? [],
          auth: brief.auth ?? 'magic_link',
          persistence: brief.persistence ?? 'mongodb',
          successCriteria: brief.successCriteria ?? [],
          voiceTone: brief.voiceTone ?? null,
          replyStyle: brief.replyStyle ?? 'professional',
          complianceNotes: brief.complianceNotes ?? null,
        },
        filePaths,
        newDependencies: depsList,
      });
    } catch (err) {
      logger.warn({ err, operationId: op.id }, 'compose readme failed');
      return reply.code(502).send({ error: 'readme_generation_failed', detail: String(err).slice(0, 240) });
    }

    const generatedAt = new Date().toISOString();
    if (bundleVersion != null) {
      await db.collection('operation_readmes').updateOne(
        { operationId: op.id, bundleVersion },
        {
          $set: {
            operationId: op.id,
            bundleVersion,
            ownerId: session.userId,
            readme,
            generatedAt,
          },
        },
        { upsert: true },
      );
    }

    return reply.send({
      operationId: op.id,
      bundleVersion,
      generatedAt,
      cached: false,
      readme,
      markdown: renderReadmeAsMarkdown(readme),
    });
  });

  /**
   * POST /api/operations/:id/preview-action — the three live-preview controls.
   * refresh = no-op on backend (client bumps the iframe key).
   * restart = restart the running process inside the existing sandbox.
   * rebuild = enqueue a fresh build + deploy.
   */
  app.post('/api/operations/:id/preview-action', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const action = String((request.body as { action?: string } | null)?.action ?? '').toLowerCase();
    if (action !== 'refresh' && action !== 'restart' && action !== 'rebuild') {
      return reply.code(400).send({ error: 'invalid_action' });
    }
    const op = await getPrisma().operation.findFirst({ where: { id, ownerId: session.userId } });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    if (action === 'refresh') {
      return reply.send({ ok: true, action });
    }

    if (action === 'restart') {
      if (op.deploymentSandboxId && op.deploymentProvider === 'blaxel') {
        try {
          const { createExecutionProvider } = await import('@argo/workspace-runtime');
          const provider = createExecutionProvider();
          await provider.execCommand({
            handle: {
              provider: 'blaxel',
              environment: 'production',
              sandboxName: op.deploymentSandboxId,
              sandboxId: op.deploymentSandboxId,
              region: op.deploymentRegion,
              publicUrl: op.publicUrl ?? '',
              internalEndpoint: null,
              ports: [{ target: 3000, protocol: 'HTTP' }],
              createdAt: new Date(op.createdAt).toISOString(),
            },
            command: 'pkill -SIGTERM -f "node server.js" || true; cd /workspace && nohup node server.js > /tmp/server.log 2>&1 &',
            timeoutMs: 15_000,
          });
        } catch {
          /* best-effort */
        }
      }
      return reply.send({ ok: true, action });
    }

    return reply.send({
      ok: true,
      action,
      note: 'rebuild — call POST /api/operations/deploy to redeploy',
    });
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    || 'op';
}

/**
 * "Candidate Intake" -> false (already a tidy short name; respect the operator).
 * "I want a form that..." -> true (sentence-shaped; should be auto-named).
 * Heuristics: > 20 chars OR contains 4+ spaces OR ends with a sentence
 * punctuation. Conservative — false negatives just mean we keep the
 * original input, which is fine.
 */
function looksLikeSentence(s: string): boolean {
  if (s.length > 20) return true;
  const spaceCount = (s.match(/\s/g) ?? []).length;
  if (spaceCount >= 4) return true;
  if (/[.!?]\s*$/.test(s)) return true;
  return false;
}
