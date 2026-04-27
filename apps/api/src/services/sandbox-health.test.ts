import { describe, it, expect } from 'vitest';
import {
  probeOne,
  probeSweep,
  getLatestProbe,
  getOpenIncident,
  type HealthProbe,
  type Incident,
  type SandboxHealthDeps,
} from './sandbox-health.js';

// ─── In-memory Mongo mock (re-uses the shape from shared-sandbox-pool.test.ts) ───

function makeMockDb<T = unknown>(): {
  db: SandboxHealthDeps['db'];
  rows: Record<string, T[]>;
} {
  const rows: Record<string, T[]> = {};
  const matches = (doc: T, sel: any): boolean => {
    if (!sel) return true;
    for (const [k, v] of Object.entries(sel)) {
      const actual = (doc as any)[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$gte' in (v as any)) {
          if (!(actual && actual >= (v as any).$gte)) return false;
          continue;
        }
        if ('$lt' in (v as any)) {
          if (!(actual && actual < (v as any).$lt)) return false;
          continue;
        }
        if ('$in' in (v as any)) {
          if (!(v as any).$in.includes(actual)) return false;
          continue;
        }
      }
      if (actual !== v) return false;
    }
    return true;
  };
  const collection = (name: string) => {
    rows[name] = rows[name] ?? [];
    const list = rows[name]!;
    return {
      findOne: async (sel: any) => list.find((r) => matches(r, sel)) ?? null,
      insertOne: async (doc: T) => {
        const _doc = { ...doc, _id: 'id_' + list.length };
        list.push(_doc as T);
        return { insertedId: (_doc as any)._id };
      },
      insertMany: async (docs: T[]) => {
        for (const d of docs) {
          list.push({ ...d, _id: 'id_' + list.length } as T);
        }
        return { insertedCount: docs.length };
      },
      updateOne: async (sel: any, update: any) => {
        const idx = list.findIndex((r) => matches(r, sel));
        if (idx === -1) return { matchedCount: 0 };
        list[idx] = { ...list[idx]!, ...(update.$set ?? {}) };
        return { matchedCount: 1 };
      },
      deleteMany: async (sel: any) => {
        const before = list.length;
        for (let i = list.length - 1; i >= 0; i--) {
          if (matches(list[i]!, sel)) list.splice(i, 1);
        }
        return { deletedCount: before - list.length };
      },
      find: (sel: any) => {
        let cursor = list.filter((r) => matches(r, sel));
        const builder = {
          sort: (spec: Record<string, 1 | -1>) => {
            const [key, dir] = Object.entries(spec)[0] ?? ['probedAt', -1];
            cursor = [...cursor].sort((a, b) => {
              const av = (a as any)[key];
              const bv = (b as any)[key];
              if (av === bv) return 0;
              return av < bv ? -dir! : dir!;
            });
            return builder;
          },
          skip: (n: number) => {
            cursor = cursor.slice(n);
            return builder;
          },
          limit: (n: number) => {
            cursor = cursor.slice(0, n);
            return builder;
          },
          project: (_: any) => builder,
          toArray: async () => cursor,
          next: async () => cursor[0] ?? null,
        };
        return builder;
      },
    };
  };
  return {
    rows,
    db: { collection } as unknown as SandboxHealthDeps['db'],
  };
}

describe('probeOne', () => {
  it('returns healthy when fetch returns 200', async () => {
    const probe = await probeOne(
      { operationId: 'op_a', publicUrl: 'https://example.test' },
      {
        fetchOverride: async () => ({ statusCode: 200, durationMs: 42 }),
      },
    );
    expect(probe.outcome).toBe('healthy');
    expect(probe.statusCode).toBe(200);
    expect(probe.latencyMs).toBe(42);
    expect(probe.reason).toBeNull();
  });

  it('returns unhealthy when fetch returns 500', async () => {
    const probe = await probeOne(
      { operationId: 'op_a', publicUrl: 'https://example.test' },
      {
        fetchOverride: async () => ({ statusCode: 500, durationMs: 12 }),
      },
    );
    expect(probe.outcome).toBe('unhealthy');
    expect(probe.statusCode).toBe(500);
    expect(probe.reason).toBe('health_returned_500');
  });

  it('returns timeout when fetch throws a timeout error', async () => {
    const probe = await probeOne(
      { operationId: 'op_a', publicUrl: 'https://example.test' },
      {
        fetchOverride: async () => {
          throw new Error('Request aborted: timeout');
        },
      },
    );
    expect(probe.outcome).toBe('timeout');
    expect(probe.statusCode).toBeNull();
  });

  it('returns unreachable when fetch throws a generic network error', async () => {
    const probe = await probeOne(
      { operationId: 'op_a', publicUrl: 'https://example.test' },
      {
        fetchOverride: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    );
    expect(probe.outcome).toBe('unreachable');
  });
});

describe('probeSweep', () => {
  it('persists probes and recognises a healthy operation', async () => {
    const { db, rows } = makeMockDb<HealthProbe | Incident>();
    const deps: SandboxHealthDeps = {
      db,
      listMonitorableOperations: async () => [
        { operationId: 'op_a', publicUrl: 'https://op-a.test' },
      ],
      fetchOverride: async () => ({ statusCode: 200, durationMs: 30 }),
    };
    const r = await probeSweep(deps);
    expect(r.probed).toBe(1);
    expect(r.healthy).toBe(1);
    expect(r.unhealthy).toBe(0);
    expect(r.newIncidents).toBe(0);
    expect(rows['sandbox_health']).toHaveLength(1);
    // Healthy probe → no incidents opened.
    expect(rows['sandbox_incidents'] ?? []).toHaveLength(0);
  });

  it('opens an incident when a probe is unhealthy', async () => {
    const { db, rows } = makeMockDb<HealthProbe | Incident>();
    const deps: SandboxHealthDeps = {
      db,
      listMonitorableOperations: async () => [
        { operationId: 'op_a', publicUrl: 'https://op-a.test' },
      ],
      fetchOverride: async () => ({ statusCode: 500, durationMs: 80 }),
    };
    const r = await probeSweep(deps);
    expect(r.newIncidents).toBe(1);
    const inc = rows['sandbox_incidents'] as Incident[] | undefined;
    expect(inc).toHaveLength(1);
    expect(inc?.[0]?.kind).toBe('unhealthy');
    expect(inc?.[0]?.resolvedAt).toBeNull();
  });

  it('escalates from unhealthy to crashlooping after 3 unhealthy probes', async () => {
    const { db, rows } = makeMockDb<HealthProbe | Incident>();
    const deps: SandboxHealthDeps = {
      db,
      listMonitorableOperations: async () => [
        { operationId: 'op_a', publicUrl: 'https://op-a.test' },
      ],
      fetchOverride: async () => ({ statusCode: 500, durationMs: 80 }),
    };
    await probeSweep(deps);
    await probeSweep(deps);
    await probeSweep(deps);
    const incidents = rows['sandbox_incidents'] as Incident[];
    // Only one OPEN incident; its kind has escalated.
    const open = incidents.filter((i) => i.resolvedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]?.kind).toBe('crashlooping');
    expect(open[0]?.hits).toBe(3);
  });

  it('resolves an incident when a probe goes healthy', async () => {
    const { db, rows } = makeMockDb<HealthProbe | Incident>();
    let unhealthy = true;
    const deps: SandboxHealthDeps = {
      db,
      listMonitorableOperations: async () => [
        { operationId: 'op_a', publicUrl: 'https://op-a.test' },
      ],
      fetchOverride: async () =>
        unhealthy
          ? { statusCode: 500, durationMs: 60 }
          : { statusCode: 200, durationMs: 20 },
    };
    await probeSweep(deps); // open incident
    unhealthy = false;
    const r = await probeSweep(deps); // resolve it
    expect(r.resolvedIncidents).toBe(1);
    const open = (rows['sandbox_incidents'] as Incident[]).filter((i) => i.resolvedAt === null);
    expect(open).toHaveLength(0);
  });

  it('handles many operations with bounded concurrency', async () => {
    const { db } = makeMockDb<HealthProbe | Incident>();
    const ops = Array.from({ length: 40 }, (_, i) => ({
      operationId: `op_${i}`,
      publicUrl: `https://op-${i}.test`,
    }));
    let inflight = 0;
    let maxInflight = 0;
    const deps: SandboxHealthDeps = {
      db,
      listMonitorableOperations: async () => ops,
      fetchOverride: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        return { statusCode: 200, durationMs: 5 };
      },
    };
    await probeSweep(deps);
    expect(maxInflight).toBeLessThanOrEqual(16);
  });
});

describe('getLatestProbe / getOpenIncident', () => {
  it('returns null when no probes exist', async () => {
    const { db } = makeMockDb<HealthProbe | Incident>();
    const probe = await getLatestProbe(db as any, 'op_x');
    expect(probe).toBeNull();
    const inc = await getOpenIncident(db as any, 'op_x');
    expect(inc).toBeNull();
  });

  it('returns the most recent probe by probedAt', async () => {
    const { db, rows } = makeMockDb<HealthProbe | Incident>();
    rows['sandbox_health'] = [
      {
        operationId: 'op_a',
        publicUrl: 'x',
        outcome: 'healthy',
        statusCode: 200,
        latencyMs: 1,
        reason: null,
        probedAt: '2026-01-01T00:00:00Z',
      },
      {
        operationId: 'op_a',
        publicUrl: 'x',
        outcome: 'healthy',
        statusCode: 200,
        latencyMs: 1,
        reason: null,
        probedAt: '2026-01-01T00:00:30Z',
      },
    ] as HealthProbe[];
    const probe = await getLatestProbe(db as any, 'op_a');
    expect(probe?.probedAt).toBe('2026-01-01T00:00:30Z');
  });
});
