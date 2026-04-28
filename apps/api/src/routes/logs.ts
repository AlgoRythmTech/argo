import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createExecutionProvider, type DeploymentHandle } from '@argo/workspace-runtime';
import { getPrisma } from '../db/prisma.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { logger } from '../logger.js';

const executionProvider = createExecutionProvider();

export async function registerLogsRoutes(app: FastifyInstance) {
  /**
   * GET /api/operations/:id/logs
   *
   * Returns recent logs from the operation's deployed sandbox.
   * Query params:
   *   - tail  (number, default 200) — how many recent lines to return
   *   - follow (boolean, default false) — if true, stream via SSE
   */
  app.get('/api/operations/:id/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const query = request.query as { tail?: string; follow?: string };
    const tail = Math.min(Math.max(parseInt(query.tail ?? '200', 10) || 200, 1), 5000);
    const follow = query.follow === 'true';

    const op = await getPrisma().operation.findFirst({
      where: { id, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    if (!op.deploymentSandboxId || !op.publicUrl) {
      return reply.code(409).send({ error: 'not_deployed', message: 'Operation has no active deployment.' });
    }

    const handle: DeploymentHandle = {
      provider: op.deploymentProvider as 'blaxel' | 'docker_mock',
      environment: 'production' as const,
      sandboxName: `argo-op-${op.id}`,
      sandboxId: op.deploymentSandboxId!,
      region: op.deploymentRegion,
      publicUrl: op.publicUrl!,
      internalEndpoint: null,
      ports: [{ target: 3000, protocol: 'HTTP' as const }],
      createdAt: op.createdAt.toISOString(),
    };

    if (follow) {
      // ── SSE stream mode ──────────────────────────────────────────────
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

      // Heartbeat so proxies don't drop the connection.
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
        const stream = executionProvider.streamLogs({ handle, tail, follow: true });
        for await (const logLine of stream) {
          if (ac.signal.aborted) break;
          writeEvent('log', logLine);
        }
        writeEvent('done', { reason: 'stream_ended' });
      } catch (err) {
        if (!ac.signal.aborted) {
          logger.error({ err, operationId: id }, 'log stream error');
          writeEvent('error', { message: String(err).slice(0, 500) });
        }
      } finally {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    } else {
      // ── Non-follow mode: collect and return as JSON ──────────────────
      try {
        const stream = executionProvider.streamLogs({ handle, tail, follow: false });
        const lines: unknown[] = [];
        for await (const logLine of stream) {
          lines.push(logLine);
        }
        return reply.send({ operationId: id, lines });
      } catch (err) {
        logger.error({ err, operationId: id }, 'log fetch error');
        return reply.code(502).send({ error: 'log_fetch_failed', detail: String(err).slice(0, 400) });
      }
    }
  });
}
