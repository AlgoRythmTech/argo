// Blaxel sandbox health monitor.
//
// Every deployed operation gets a public URL backed by a Blaxel sandbox.
// This service polls the sandbox's /health endpoint, records latency and
// status to Mongo, detects crashloops (deaths within a sliding window),
// and surfaces incidents so the operator's activity feed catches issues
// the moment they happen — not the next time someone hits the form.
//
// Design choices:
//
//   • Polling interval: 30s by default. Faster wastes Blaxel egress + Argo
//     cost; slower lets operators discover the dead form themselves
//     (catastrophic for trust).
//
//   • Sliding window for crashloops: 5 minutes. If we see N≥3 distinct
//     unhealthy probes in a 5-min window, we mark the operation as
//     `crashlooping` so the activity feed shows a dedicated incident
//     row rather than a sea of identical alarms.
//
//   • Storage: `sandbox_health` collection holds rolling probe history
//     (capped at 200 most-recent rows per operation). `sandbox_incidents`
//     holds open incidents — one row per (operationId, kind), updated
//     on each probe that confirms or clears it.
//
//   • Concurrency: probes run in a Promise.all batch with a small in-flight
//     cap. We DON'T issue 1000 health probes simultaneously when a free
//     tier scales up; the cap is `MAX_INFLIGHT_PROBES = 16`.

import { request } from 'undici';
import type { Db } from 'mongodb';

const HEALTH_COLLECTION = 'sandbox_health';
const INCIDENTS_COLLECTION = 'sandbox_incidents';

const DEFAULT_PROBE_INTERVAL_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const CRASHLOOP_WINDOW_MS = 5 * 60_000; // 5 minutes
const CRASHLOOP_THRESHOLD = 3; // unhealthy probes within window
const MAX_INFLIGHT_PROBES = 16;
const HISTORY_CAP = 200;

export type ProbeOutcome = 'healthy' | 'unhealthy' | 'unreachable' | 'timeout';

export interface HealthProbe {
  operationId: string;
  publicUrl: string;
  /** Outcome bucket for fast aggregation. */
  outcome: ProbeOutcome;
  /** HTTP status if we got one, otherwise null. */
  statusCode: number | null;
  /** Latency in ms; null if probe never completed. */
  latencyMs: number | null;
  /** Short error description if outcome != 'healthy'. */
  reason: string | null;
  probedAt: string;
}

export type IncidentKind = 'unhealthy' | 'crashlooping' | 'unreachable';

export interface Incident {
  operationId: string;
  kind: IncidentKind;
  openedAt: string;
  /** Most recent probe that confirmed the incident is still live. */
  confirmedAt: string;
  /** Set when the incident clears. */
  resolvedAt: string | null;
  /** How many distinct probes have confirmed it. */
  hits: number;
  /** Last probe's reason field — useful for the activity feed copy. */
  lastReason: string | null;
}

export interface SandboxHealthDeps {
  db: Db;
  /** List the operations we should probe right now. The pool/operations
   *  service decides what's "live" — typically status === 'deployed' AND
   *  publicUrl is set AND owner hasn't paused billing. */
  listMonitorableOperations: () => Promise<Array<{ operationId: string; publicUrl: string }>>;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  /** Override fetch for tests. Defaults to undici.request. */
  fetchOverride?: (url: string, opts: { timeoutMs: number }) => Promise<{
    statusCode: number;
    durationMs: number;
  }>;
}

/**
 * Probe one URL. Returns a HealthProbe; never throws — network errors
 * become outcome === 'unreachable' or 'timeout'.
 */
export async function probeOne(
  args: { operationId: string; publicUrl: string; timeoutMs?: number },
  deps?: { fetchOverride?: SandboxHealthDeps['fetchOverride'] },
): Promise<HealthProbe> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probedAt = new Date().toISOString();
  const url = args.publicUrl.replace(/\/+$/, '') + '/health';

  if (deps?.fetchOverride) {
    try {
      const r = await deps.fetchOverride(url, { timeoutMs });
      return classifyProbe({
        operationId: args.operationId,
        publicUrl: args.publicUrl,
        probedAt,
        statusCode: r.statusCode,
        latencyMs: r.durationMs,
        errorKind: null,
      });
    } catch (err) {
      return classifyProbe({
        operationId: args.operationId,
        publicUrl: args.publicUrl,
        probedAt,
        statusCode: null,
        latencyMs: null,
        errorKind: detectErrorKind(err),
      });
    }
  }

  const start = Date.now();
  try {
    const r = await request(url, {
      method: 'GET',
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    // Drain body so the connection closes promptly.
    void r.body.dump?.();
    const durationMs = Date.now() - start;
    return classifyProbe({
      operationId: args.operationId,
      publicUrl: args.publicUrl,
      probedAt,
      statusCode: r.statusCode,
      latencyMs: durationMs,
      errorKind: null,
    });
  } catch (err) {
    return classifyProbe({
      operationId: args.operationId,
      publicUrl: args.publicUrl,
      probedAt,
      statusCode: null,
      latencyMs: null,
      errorKind: detectErrorKind(err),
    });
  }
}

function detectErrorKind(err: unknown): 'timeout' | 'unreachable' {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  if (msg.includes('timeout') || msg.includes('aborted')) return 'timeout';
  return 'unreachable';
}

function classifyProbe(args: {
  operationId: string;
  publicUrl: string;
  probedAt: string;
  statusCode: number | null;
  latencyMs: number | null;
  errorKind: 'timeout' | 'unreachable' | null;
}): HealthProbe {
  const base = {
    operationId: args.operationId,
    publicUrl: args.publicUrl,
    probedAt: args.probedAt,
    statusCode: args.statusCode,
    latencyMs: args.latencyMs,
  };
  if (args.errorKind === 'timeout') {
    return { ...base, outcome: 'timeout', reason: 'health_probe_timeout' };
  }
  if (args.errorKind === 'unreachable') {
    return { ...base, outcome: 'unreachable', reason: 'sandbox_unreachable' };
  }
  if (args.statusCode !== null && args.statusCode >= 200 && args.statusCode < 400) {
    return { ...base, outcome: 'healthy', reason: null };
  }
  return {
    ...base,
    outcome: 'unhealthy',
    reason: args.statusCode !== null ? `health_returned_${args.statusCode}` : 'no_response',
  };
}

/**
 * Run one full sweep: pull the live operations list, probe each (capped
 * at MAX_INFLIGHT_PROBES concurrent), persist the probes, recompute
 * incidents.
 *
 * Returns a summary the caller can log.
 */
export async function probeSweep(deps: SandboxHealthDeps): Promise<{
  probed: number;
  healthy: number;
  unhealthy: number;
  newIncidents: number;
  resolvedIncidents: number;
}> {
  const ops = await deps.listMonitorableOperations();
  const probes: HealthProbe[] = [];

  // Bounded-concurrency batch.
  for (let i = 0; i < ops.length; i += MAX_INFLIGHT_PROBES) {
    const batch = ops.slice(i, i + MAX_INFLIGHT_PROBES);
    const results = await Promise.all(
      batch.map((op) =>
        probeOne(
          { operationId: op.operationId, publicUrl: op.publicUrl },
          { ...(deps.fetchOverride ? { fetchOverride: deps.fetchOverride } : {}) },
        ),
      ),
    );
    probes.push(...results);
  }

  await persistProbes(deps.db, probes);
  const incidentDelta = await reconcileIncidents(deps.db, probes);

  const healthy = probes.filter((p) => p.outcome === 'healthy').length;
  return {
    probed: probes.length,
    healthy,
    unhealthy: probes.length - healthy,
    newIncidents: incidentDelta.opened,
    resolvedIncidents: incidentDelta.resolved,
  };
}

async function persistProbes(db: Db, probes: HealthProbe[]): Promise<void> {
  if (probes.length === 0) return;
  const col = db.collection<HealthProbe>(HEALTH_COLLECTION);
  await col.insertMany(probes);
  // Trim per-operation history. We do this in a loop to keep query
  // pressure low — health records compact every minute, so spikes
  // don't cause hot-spots.
  const seen = new Set(probes.map((p) => p.operationId));
  for (const opId of seen) {
    const docs = await col
      .find({ operationId: opId })
      .sort({ probedAt: -1 })
      .skip(HISTORY_CAP)
      .project<{ _id: unknown }>({ _id: 1 })
      .toArray();
    if (docs.length === 0) continue;
    const ids = docs.map((d) => d._id as never);
    await col.deleteMany({ _id: { $in: ids } });
  }
}

/**
 * For each probe, compute the operation's current incident state from
 * the rolling window history, then upsert/resolve incidents accordingly.
 */
async function reconcileIncidents(
  db: Db,
  probes: HealthProbe[],
): Promise<{ opened: number; resolved: number }> {
  if (probes.length === 0) return { opened: 0, resolved: 0 };
  const healthCol = db.collection<HealthProbe>(HEALTH_COLLECTION);
  const incidentCol = db.collection<Incident>(INCIDENTS_COLLECTION);
  const cutoff = new Date(Date.now() - CRASHLOOP_WINDOW_MS).toISOString();
  let opened = 0;
  let resolved = 0;

  for (const probe of probes) {
    const recent = await healthCol
      .find({ operationId: probe.operationId, probedAt: { $gte: cutoff } })
      .toArray();
    const unhealthyHits = recent.filter((p) => p.outcome !== 'healthy').length;
    const isCrashlooping = unhealthyHits >= CRASHLOOP_THRESHOLD;
    const isUnhealthy = probe.outcome !== 'healthy';

    const desiredKind: IncidentKind | null = isCrashlooping
      ? 'crashlooping'
      : isUnhealthy
      ? probe.outcome === 'unreachable'
        ? 'unreachable'
        : 'unhealthy'
      : null;

    const open = await incidentCol.findOne({
      operationId: probe.operationId,
      resolvedAt: null,
    });

    if (desiredKind === null) {
      // Probe is healthy. Resolve any open incident.
      if (open) {
        await incidentCol.updateOne(
          { _id: open._id },
          { $set: { resolvedAt: probe.probedAt } },
        );
        resolved++;
      }
      continue;
    }

    if (!open) {
      // No open incident — open one.
      await incidentCol.insertOne({
        operationId: probe.operationId,
        kind: desiredKind,
        openedAt: probe.probedAt,
        confirmedAt: probe.probedAt,
        resolvedAt: null,
        hits: 1,
        lastReason: probe.reason,
      });
      opened++;
      continue;
    }

    // There IS an open incident. If the kind escalated (unhealthy →
    // crashlooping), update it; otherwise just bump confirmedAt + hits.
    const update: Partial<Incident> = {
      confirmedAt: probe.probedAt,
      hits: open.hits + 1,
      lastReason: probe.reason,
    };
    if (open.kind !== desiredKind) {
      update.kind = desiredKind;
    }
    await incidentCol.updateOne({ _id: open._id }, { $set: update });
  }
  return { opened, resolved };
}

/** Long-running loop. Caller invokes once at server boot. */
export function startSandboxHealthLoop(
  deps: SandboxHealthDeps,
  opts: { intervalMs?: number } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const r = await probeSweep(deps);
      deps.logger?.info?.({ ...r }, 'sandbox_health_sweep');
    } catch (err) {
      deps.logger?.warn?.(
        { err: String((err as Error).message ?? err) },
        'sandbox_health_sweep_failed',
      );
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  // Best-effort: don't keep the event loop alive just for this.
  if (typeof handle.unref === 'function') handle.unref();
  // Kick off immediately so first sweep doesn't wait an interval.
  void tick();
  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}

/**
 * Read the latest probe for an operation. Used by the operations API to
 * surface "last seen healthy at HH:MM" in the workspace UI.
 */
export async function getLatestProbe(db: Db, operationId: string): Promise<HealthProbe | null> {
  return await db
    .collection<HealthProbe>(HEALTH_COLLECTION)
    .find({ operationId })
    .sort({ probedAt: -1 })
    .limit(1)
    .next();
}

/** Read the open incident for an operation, if any. */
export async function getOpenIncident(db: Db, operationId: string): Promise<Incident | null> {
  return await db
    .collection<Incident>(INCIDENTS_COLLECTION)
    .findOne({ operationId, resolvedAt: null });
}
