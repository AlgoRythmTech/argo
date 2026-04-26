import type { WorkflowMap } from '@argo/shared-types';

/**
 * The observability sidecar — a tiny in-process emitter that batches
 * runtime events and ships them to the Argo control plane. Section 11's
 * repair worker consumes from `runtime_events` (Mongo).
 */
export function generateObservabilitySidecar(_map: WorkflowMap): string {
  return `import { nanoid } from 'nanoid';

const buffer = [];
let flushing = false;

export function startObservability(app) {
  // Capture every error
  app.setErrorHandler((err, request, reply) => {
    enqueue({
      kind: 'unhandled_exception',
      severity: 'error',
      message: String(err.message || err).slice(0, 800),
      context: { method: request.method, url: request.url },
      stackTrace: String(err.stack || '').slice(0, 4000),
    });
    reply.code(err.statusCode || 500).send({
      error: 'internal',
      requestId: request.id,
    });
  });

  // Capture all 5xx
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500) {
      enqueue({
        kind: 'http_5xx',
        severity: 'error',
        message: ${'`'}${'$'}{request.method} ${'$'}{request.url} -> ${'$'}{reply.statusCode}${'`'},
        context: { method: request.method, url: request.url, statusCode: reply.statusCode },
        stackTrace: null,
      });
    }
  });

  // Memory check every 15s
  setInterval(() => {
    const m = process.memoryUsage();
    const rssMb = Math.round(m.rss / 1024 / 1024);
    if (rssMb > Number(process.env.MEMORY_THRESHOLD_MB || 850)) {
      enqueue({
        kind: 'memory_threshold',
        severity: 'warn',
        message: ${'`'}rss=${'$'}{rssMb}MB${'`'},
        context: { rssMb },
        stackTrace: null,
      });
    }
  }, 15_000).unref();

  // Background flush every 5s
  setInterval(flush, 5_000).unref();
}

function enqueue(evt) {
  buffer.push({
    id: 'evt_' + nanoid(12),
    occurredAt: new Date().toISOString(),
    operationId: process.env.ARGO_OPERATION_ID,
    deploymentId: process.env.ARGO_DEPLOYMENT_ID || 'unknown',
    ...evt,
  });
  if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
}

async function flush() {
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
    // On failure put a sample back so the next flush retries once.
    buffer.unshift(...batch.slice(0, 50));
  } finally {
    flushing = false;
  }
}
`;
}
