import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity, recentActivity } from '../stores/activity-store.js';

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

    const slug = `${slugify(parsed.data.name)}-${nanoid(6).toLowerCase()}`;
    const op = await getPrisma().operation.create({
      data: {
        ownerId: session.userId,
        slug,
        name: parsed.data.name,
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
