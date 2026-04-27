// SSE streaming build endpoint. The web Workspace opens an EventSource on
// POST /api/build/stream (sent body in the initial fetch, then upgraded
// internally to text/event-stream). Server forwards three event kinds:
//   - chunk    : raw text delta from GPT-5.5 (operator never sees it)
//   - action   : a parsed dyad-* action — file appearing in the Code tab
//   - cycle    : auto-fix cycle status (start, gate_run, complete)
//   - report   : final QualityReport when the loop finishes
//   - bundle   : the bundle manifest (sha256s + paths only)
//   - error    : terminal failure
//
// Wired straight into apps/api/src/server.ts.

import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { runAutoFixLoop, type AutoFixCycleEvent } from '@argo/build-engine';
import { pickSpecialist } from '@argo/agent';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';

const Body = z.object({
  operationId: z.string(),
  prompt: z.string().min(20).max(8000),
  /** Override the auto-detected specialist (admin tool). */
  specialistOverride: z
    .enum([
      'rest_api',
      'crud_app',
      'scraper_pipeline',
      'scheduled_job',
      'webhook_bridge',
      'slack_bot',
      'form_workflow',
      'multi_tenant_saas',
      'agent_runtime',
      'generic',
    ])
    .optional(),
});

export async function registerBuildStreamRoutes(app: FastifyInstance) {
  app.post('/api/build/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const parsed = Body.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const op = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const specialist =
      parsed.data.specialistOverride ??
      pickSpecialist({
        archetype: 'form_workflow',
        triggerKind: 'form_submission',
        description: parsed.data.prompt,
      });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const writeEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      for (const line of payload.split('\n')) reply.raw.write(`data: ${line}\n`);
      reply.raw.write('\n');
    };

    // Heartbeat so proxies don't drop the connection on a quiet stream.
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    const ac = new AbortController();
    request.raw.on('close', () => {
      ac.abort();
    });

    try {
      writeEvent('start', {
        operationId: op.id,
        specialist,
        bundleVersion: op.bundleVersion + 1,
      });

      // If the operator already finalised a brief, derive augmentation
      // from it so the build agent gets reference snippets + memory.
      const { db } = await getMongo();
      const briefDoc = await db
        .collection('project_briefs')
        .find({ operationId: op.id })
        .sort({ persistedAt: -1 })
        .limit(1)
        .next();
      type BriefShape = {
        trigger?: string;
        integrations?: string[];
        auth?: string;
        dataClassification?: string;
      };
      const brief = (briefDoc ?? null) as BriefShape | null;

      const result = await runAutoFixLoop({
        specialist,
        userPrompt: parsed.data.prompt,
        manifest: {
          operationId: op.id,
          operationSlug: op.slug,
          bundleVersion: op.bundleVersion + 1,
          workflowMapVersion: op.workflowMapVersion,
          requiredEnv: ['ARGO_OPERATION_ID', 'ARGO_CONTROL_PLANE_URL', 'INTERNAL_API_KEY', 'MONGODB_URI'],
        },
        augmentation: {
          ...(brief?.trigger ? { trigger: brief.trigger } : {}),
          ...(brief?.integrations ? { integrations: brief.integrations } : {}),
          ...(brief?.auth ? { auth: brief.auth } : {}),
          ...(brief?.dataClassification ? { dataClassification: brief.dataClassification } : {}),
          ownerId: session.userId,
        },
        signal: ac.signal,
        onChunk: (delta) => writeEvent('chunk', { delta }),
        onCycle: (evt: AutoFixCycleEvent) => {
          if (evt.kind === 'actions_parsed') {
            for (const action of evt.actions) {
              writeEvent('action', { cycle: evt.cycle, action });
            }
            writeEvent('prose', { cycle: evt.cycle, prose: evt.prose });
          } else if (evt.kind === 'gate_run') {
            writeEvent('gate', {
              cycle: evt.cycle,
              passed: evt.report.passed,
              errorCount: evt.report.errorCount,
              warnCount: evt.report.warnCount,
              issues: evt.report.issues.slice(0, 25),
            });
          } else if (evt.kind === 'cycle_start') {
            writeEvent('cycle_start', { cycle: evt.cycle, promptLength: evt.promptLength });
          } else if (evt.kind === 'cycle_complete') {
            writeEvent('cycle_complete', { cycle: evt.cycle, passed: evt.passed });
          } else if (evt.kind === 'aborted') {
            writeEvent('aborted', {});
          }
        },
      });

      writeEvent('report', {
        success: result.success,
        cycles: result.cycles,
        finalReport: result.finalReport,
        prose: result.prose,
        newDependencies: result.newDependencies,
      });

      if (result.bundle) {
        writeEvent('bundle', {
          manifest: result.bundle.manifest,
          files: result.bundle.files.map((f) => ({
            path: f.path,
            sha256: f.sha256,
            argoGenerated: f.argoGenerated,
            size: f.contents.length,
          })),
        });
      }

      writeEvent('done', { success: result.success });
    } catch (err) {
      writeEvent('error', { message: String(err).slice(0, 500) });
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  });
}
