import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { recentActivity } from '../stores/activity-store.js';

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
