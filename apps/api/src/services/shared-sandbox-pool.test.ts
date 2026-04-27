import { describe, it, expect, beforeEach } from 'vitest';
import {
  assignSlotToOwner,
  releaseSlot,
  recordInvocation,
  poolStats,
  sweepIdleSlots,
  SLOTS_PER_HOST,
  FREE_TIER_INVOCATION_CAP,
  type SharedSandboxPoolDeps,
  type Slot,
} from './shared-sandbox-pool.js';

// ─── Tiny in-memory Mongo collection mock ───────────────────────────
//
// We don't want to spin up a real Mongo for unit tests. The pool uses
// a small subset of the driver: findOne / findOneAndUpdate / updateOne /
// insertMany / countDocuments / distinct / find().toArray(). This mock
// implements just those, in-memory, with the minimal selector logic the
// pool needs.

type Doc = Slot;

function makeMockDb(): { db: SharedSandboxPoolDeps['db']; rows: Doc[] } {
  const rows: Doc[] = [];
  const matches = (doc: Doc, selector: any): boolean => {
    for (const [k, v] of Object.entries(selector ?? {})) {
      const actual = (doc as any)[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // operators we use: $lt
        if ('$lt' in (v as any)) {
          if (!(actual && actual < (v as any).$lt)) return false;
          continue;
        }
      }
      if (actual !== v) return false;
    }
    return true;
  };
  const collection = () => ({
    findOne: async (selector: any) => rows.find((r) => matches(r, selector)) ?? null,
    findOneAndUpdate: async (selector: any, update: any, _opts: any) => {
      const idx = rows.findIndex((r) => matches(r, selector));
      if (idx === -1) return null;
      const updated = { ...rows[idx]!, ...(update.$set ?? {}) };
      rows[idx] = updated;
      return updated;
    },
    updateOne: async (selector: any, update: any) => {
      const idx = rows.findIndex((r) => matches(r, selector));
      if (idx === -1) return { matchedCount: 0 };
      rows[idx] = { ...rows[idx]!, ...(update.$set ?? {}) };
      return { matchedCount: 1 };
    },
    insertMany: async (docs: Doc[]) => {
      rows.push(...docs);
      return { insertedCount: docs.length };
    },
    countDocuments: async (selector?: any) =>
      rows.filter((r) => matches(r, selector ?? {})).length,
    distinct: async (field: string, selector?: any) => {
      const out = new Set<unknown>();
      for (const r of rows.filter((row) => matches(row, selector ?? {}))) {
        out.add((r as any)[field]);
      }
      return Array.from(out);
    },
    find: (selector: any) => ({
      toArray: async () => rows.filter((r) => matches(r, selector ?? {})),
    }),
  });
  return {
    rows,
    db: { collection } as unknown as SharedSandboxPoolDeps['db'],
  };
}

function makeDeps(): { deps: SharedSandboxPoolDeps; rows: Doc[]; calls: { provision: number; install: number; uninstall: number } } {
  const { db, rows } = makeMockDb();
  const calls = { provision: 0, install: 0, uninstall: 0 };
  const deps: SharedSandboxPoolDeps = {
    db,
    provisionHost: async (sandboxName) => {
      calls.provision++;
      return { hostUrl: `https://${sandboxName}.example.test` };
    },
    teardownHost: async () => {},
    installAgentOnHost: async () => {
      calls.install++;
    },
    uninstallAgentFromHost: async () => {
      calls.uninstall++;
    },
  };
  return { deps, rows, calls };
}

describe('assignSlotToOwner', () => {
  let h: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    h = makeDeps();
  });

  it('cold-provisions a host on first signup and assigns slot 0', async () => {
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'user_a',
      agentName: 'maya-bot',
      agentSource: 'export const run = async () => 1;',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warm).toBe(false);
    expect(r.slot.ownerId).toBe('user_a');
    expect(r.slot.status).toBe('assigned');
    // SLOTS_PER_HOST rows should now exist; one assigned, the rest free.
    expect(h.rows).toHaveLength(SLOTS_PER_HOST);
    expect(h.rows.filter((s) => s.status === 'free')).toHaveLength(SLOTS_PER_HOST - 1);
    expect(h.calls.provision).toBe(1);
    expect(h.calls.install).toBe(1);
  });

  it('returns a warm slot on second signup (no extra provision)', async () => {
    await assignSlotToOwner(h.deps, {
      ownerId: 'user_a',
      agentName: 'a',
      agentSource: 'export const run = async () => 1;',
    });
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'user_b',
      agentName: 'b',
      agentSource: 'export const run = async () => 2;',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warm).toBe(true);
    expect(h.calls.provision).toBe(1); // still just one host
    expect(h.calls.install).toBe(2);
    // Both slots on the same host now assigned.
    const assigned = h.rows.filter((s) => s.status === 'assigned');
    expect(assigned).toHaveLength(2);
    const sandboxNames = new Set(h.rows.map((r) => r.sandboxName));
    expect(sandboxNames.size).toBe(1);
  });

  it('is idempotent: same owner returns the same slot, no double-install', async () => {
    const r1 = await assignSlotToOwner(h.deps, {
      ownerId: 'user_a',
      agentName: 'a',
      agentSource: 'x',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = await assignSlotToOwner(h.deps, {
      ownerId: 'user_a',
      agentName: 'a',
      agentSource: 'x',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.slot.slotId).toBe(r1.slot.slotId);
    expect(h.calls.install).toBe(1); // not two
  });
});

describe('recordInvocation', () => {
  it('increments and returns underCap=true while below cap', async () => {
    const h = makeDeps();
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'u', agentName: 'a', agentSource: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inv1 = await recordInvocation(h.deps, { slotId: r.slot.slotId });
    expect(inv1.ok).toBe(true);
    expect(inv1.count).toBe(1);
    expect(inv1.underCap).toBe(true);
  });

  it('returns underCap=false once cap is exceeded', async () => {
    const h = makeDeps();
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'u', agentName: 'a', agentSource: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Push the row directly above the cap to avoid 1000 increments.
    h.rows[0]!.monthlyInvocations = FREE_TIER_INVOCATION_CAP;
    const inv = await recordInvocation(h.deps, { slotId: r.slot.slotId });
    expect(inv.count).toBe(FREE_TIER_INVOCATION_CAP + 1);
    expect(inv.underCap).toBe(false);
  });
});

describe('releaseSlot', () => {
  it('frees an assigned slot and uninstalls the agent', async () => {
    const h = makeDeps();
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'u', agentName: 'a', agentSource: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const released = await releaseSlot(h.deps, { slotId: r.slot.slotId, reason: 'upgrade' });
    expect(released.ok).toBe(true);
    expect(h.calls.uninstall).toBe(1);
    const slot = h.rows.find((s) => s.slotId === r.slot.slotId);
    expect(slot?.status).toBe('free');
    expect(slot?.ownerId).toBeNull();
  });
});

describe('poolStats', () => {
  it('reports zeros on an empty pool', async () => {
    const h = makeDeps();
    const s = await poolStats(h.deps);
    expect(s.totalSlots).toBe(0);
    expect(s.assignedSlots).toBe(0);
  });

  it('reports correct counts after one signup', async () => {
    const h = makeDeps();
    await assignSlotToOwner(h.deps, {
      ownerId: 'u', agentName: 'a', agentSource: 'x',
    });
    const s = await poolStats(h.deps);
    expect(s.totalHosts).toBe(1);
    expect(s.totalSlots).toBe(SLOTS_PER_HOST);
    expect(s.assignedSlots).toBe(1);
    expect(s.freeSlots).toBe(SLOTS_PER_HOST - 1);
  });
});

describe('sweepIdleSlots', () => {
  it('evicts slots whose lastInvocation is older than the cutoff', async () => {
    const h = makeDeps();
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'u', agentName: 'a', agentSource: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Manually set lastInvocation to 60 days ago.
    h.rows[0]!.lastInvocation = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const swept = await sweepIdleSlots(h.deps, { idleDays: 30 });
    expect(swept.swept).toContain(r.slot.slotId);
    const slot = h.rows.find((s) => s.slotId === r.slot.slotId);
    expect(slot?.status).toBe('evicted');
  });

  it('does not evict slots that were just used', async () => {
    const h = makeDeps();
    const r = await assignSlotToOwner(h.deps, {
      ownerId: 'u', agentName: 'a', agentSource: 'x',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await recordInvocation(h.deps, { slotId: r.slot.slotId });
    const swept = await sweepIdleSlots(h.deps, { idleDays: 30 });
    expect(swept.swept).toHaveLength(0);
  });
});
