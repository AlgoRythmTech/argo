// Public operation status page.
//
// GET /status/:slug — unauthenticated endpoint that returns a health
// dashboard for an operation, designed to be shared with the operator's
// clients. No session required; the slug acts as the public identifier.
//
// Data sources:
//   - operations (Postgres via Prisma)    — name, status, publicUrl
//   - sandbox_health (Mongo)              — probe history, uptime, response times
//   - sandbox_incidents (Mongo)           — recent incidents
//   - operation_bundles (Mongo)           — deploy history

import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';

const HEALTH_COLLECTION = 'sandbox_health';
const INCIDENTS_COLLECTION = 'sandbox_incidents';
const BUNDLES_COLLECTION = 'operation_bundles';

/** Thirty days in milliseconds. */
const UPTIME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function registerStatusPageRoutes(app: FastifyInstance) {
  app.get('/status/:slug', async (request, reply) => {
    const slug = String((request.params as { slug: string }).slug);

    // ── Look up operation by slug ──────────────────────────────────
    const op = await getPrisma().operation.findFirst({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        publicUrl: true,
        createdAt: true,
      },
    });

    if (!op) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const { db } = await getMongo();
    const now = Date.now();
    const uptimeCutoff = new Date(now - UPTIME_WINDOW_MS).toISOString();

    // ── Parallel queries ───────────────────────────────────────────
    const [
      latestProbe,
      totalProbes,
      successfulProbes,
      recentIncidents,
      recentDeploys,
      probesForLatency,
    ] = await Promise.all([
      // Latest health probe
      db
        .collection(HEALTH_COLLECTION)
        .find({ operationId: op.id })
        .sort({ probedAt: -1 })
        .limit(1)
        .next(),

      // Total probes in uptime window
      db.collection(HEALTH_COLLECTION).countDocuments({
        operationId: op.id,
        probedAt: { $gte: uptimeCutoff },
      }),

      // Successful probes in uptime window
      db.collection(HEALTH_COLLECTION).countDocuments({
        operationId: op.id,
        probedAt: { $gte: uptimeCutoff },
        outcome: 'healthy',
      }),

      // Recent incidents (last 10, newest first)
      db
        .collection(INCIDENTS_COLLECTION)
        .find({ operationId: op.id })
        .sort({ openedAt: -1 })
        .limit(10)
        .project({
          _id: 1,
          kind: 1,
          hits: 1,
          lastReason: 1,
          openedAt: 1,
          resolvedAt: 1,
        })
        .toArray(),

      // Deploy history (last 10, newest first)
      db
        .collection(BUNDLES_COLLECTION)
        .find({ operationId: op.id })
        .sort({ version: -1 })
        .limit(10)
        .project({
          version: 1,
          createdAt: 1,
          generatedByModel: 1,
          aiCycles: 1,
        })
        .toArray(),

      // Probes with latency for response time stats (last 200 healthy probes)
      db
        .collection(HEALTH_COLLECTION)
        .find({
          operationId: op.id,
          probedAt: { $gte: uptimeCutoff },
          outcome: 'healthy',
          latencyMs: { $ne: null },
        })
        .sort({ probedAt: -1 })
        .limit(200)
        .project({ latencyMs: 1 })
        .toArray(),
    ]);

    // ── Health tone ────────────────────────────────────────────────
    type ProbeDoc = { outcome?: string; probedAt?: string };
    const probe = latestProbe as ProbeDoc | null;
    const isHealthy = probe?.outcome === 'healthy';
    const hasOpenIncident = recentIncidents.some(
      (i) => (i as { resolvedAt?: string | null }).resolvedAt === null,
    );

    const tone: 'good' | 'warn' | 'bad' = !probe
      ? 'warn'
      : isHealthy && !hasOpenIncident
        ? 'good'
        : hasOpenIncident
          ? 'bad'
          : 'warn';

    const healthStatus = !probe
      ? 'no_data'
      : isHealthy
        ? 'operational'
        : probe.outcome === 'timeout'
          ? 'timeout'
          : probe.outcome === 'unreachable'
            ? 'unreachable'
            : 'degraded';

    // ── Uptime ─────────────────────────────────────────────────────
    const uptimePercentage =
      totalProbes > 0
        ? Math.round((successfulProbes / totalProbes) * 10_000) / 100
        : 100;

    // ── Response time percentiles ──────────────────────────────────
    const latencies = probesForLatency
      .map((p) => Number((p as { latencyMs?: number }).latencyMs ?? 0))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);

    const avgMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
        : 0;
    const p95Ms = percentile(latencies, 0.95);
    const p99Ms = percentile(latencies, 0.99);

    // ── Incidents mapping ──────────────────────────────────────────
    type IncidentDoc = {
      _id?: unknown;
      kind?: string;
      hits?: number;
      lastReason?: string | null;
      openedAt?: string;
      resolvedAt?: string | null;
    };
    const incidents = recentIncidents.map((raw) => {
      const d = raw as IncidentDoc;
      return {
        id: String(d._id ?? ''),
        kind: String(d.kind ?? 'unknown'),
        severity: d.kind === 'crashlooping' ? 'critical' : d.kind === 'unreachable' ? 'major' : 'minor',
        message: d.lastReason ?? null,
        startedAt: d.openedAt ?? null,
        resolvedAt: d.resolvedAt ?? null,
      };
    });

    // ── Deploys mapping ────────────────────────────────────────────
    type DeployDoc = {
      version?: number;
      createdAt?: string;
      generatedByModel?: string;
      aiCycles?: number;
    };
    const deploys = recentDeploys.map((raw) => {
      const d = raw as DeployDoc;
      return {
        version: Number(d.version ?? 0),
        createdAt: String(d.createdAt ?? ''),
        model: String(d.generatedByModel ?? 'unknown'),
        aiCycles: Number(d.aiCycles ?? 0),
      };
    });

    // ── Response ───────────────────────────────────────────────────
    return reply.send({
      operation: {
        name: op.name,
        slug: op.slug,
        status: op.status,
        publicUrl: op.publicUrl,
        createdAt: op.createdAt,
      },
      health: {
        tone,
        status: healthStatus,
        checkedAt: probe?.probedAt ?? null,
      },
      uptime: {
        percentage: uptimePercentage,
        totalProbes,
        successfulProbes,
        period: '30d',
      },
      incidents,
      deploys,
      responseTime: {
        avgMs,
        p95Ms,
        p99Ms,
      },
    });
  });
}

/** Compute a percentile value from a sorted array. Returns 0 for empty input. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
