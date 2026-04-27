// Shared sandbox pool — free-tier agent hosting infrastructure.
//
// Free operators can't afford a full Blaxel sandbox per workflow ($X/mo
// just to keep an idle Node process alive). Argo's free tier solves
// this with a shared-sandbox model: we boot N "host" sandboxes, each
// running a multi-tenant agent runtime that hosts up to K agent slots.
// Each free user gets one slot. They co-tenant with other free users
// inside the same sandbox process; the host enforces strict per-slot
// resource isolation (CPU, memory, request rate).
//
// On upgrade to paid, we evict the slot, provision a dedicated sandbox,
// and migrate the agent's state. The free-tier slot frees up for the
// next signup.
//
// This file is the CONTROL-PLANE side: the pool, the slot allocator,
// the assignment table. The DATA-PLANE side (the actual agent runtime
// running inside each shared sandbox) is the multi-tenant-host package.
//
// Storage: Mongo collection `shared_sandbox_slots` keyed on slotId.
// Each slot doc:
//   {
//     slotId:        unique id we issue
//     sandboxName:   the Blaxel sandbox the slot lives in
//     hostUrl:       the public URL of the sandbox
//     ownerId:       null when free, set when assigned
//     agentName:     name of the operator's agent inside the host
//     status:        'free' | 'assigned' | 'evicted'
//     assignedAt:    ISO when assigned
//     lastInvocation: ISO of last agent run (for stale eviction)
//     monthlyInvocations: counter, reset on the 1st of every month
//   }

import { nanoid } from 'nanoid';
import type { Db } from 'mongodb';

const SLOT_COLLECTION = 'shared_sandbox_slots';

/**
 * How many agent slots each shared sandbox hosts. The user spec says
 * 2 — small enough that one noisy free user can't block the other,
 * big enough to amortise the sandbox cost.
 */
export const SLOTS_PER_HOST = 2;

/**
 * How many shared sandboxes the pool maintains. Tunable; higher means
 * faster signup (no cold provisioning) at higher floor cost.
 */
export const POOL_SIZE = Number(process.env.ARGO_FREE_POOL_SIZE ?? 4);

/**
 * Per-month invocation cap on a free slot. Past this we email the user
 * with an upgrade prompt and pause the agent.
 */
export const FREE_TIER_INVOCATION_CAP = Number(
  process.env.ARGO_FREE_INVOCATION_CAP ?? 1000,
);

export type SlotStatus = 'free' | 'assigned' | 'evicted';

export interface Slot {
  slotId: string;
  sandboxName: string;
  hostUrl: string;
  hostInternalUrl?: string;
  ownerId: string | null;
  agentName: string | null;
  status: SlotStatus;
  assignedAt: string | null;
  lastInvocation: string | null;
  monthlyInvocations: number;
  monthlyInvocationsResetAt: string;
}

export interface AssignSlotResult {
  ok: true;
  slot: Slot;
  /** Whether the assignment created a new slot (cold provision) or
   *  returned an existing free one (warm). */
  warm: boolean;
}

export interface AssignSlotFailure {
  ok: false;
  reason: 'pool_exhausted' | 'already_assigned' | 'storage_failed';
  detail: string;
}

export interface SharedSandboxPoolDeps {
  db: Db;
  /** Provision a new shared host. Returns the URL the host is reachable at. */
  provisionHost: (sandboxName: string) => Promise<{ hostUrl: string; hostInternalUrl?: string }>;
  /** Tear down a host (e.g. when a slot is upgraded to a dedicated sandbox). */
  teardownHost: (sandboxName: string) => Promise<void>;
  /** Register/unregister an agent inside a host. The host implements an
   *  internal HTTP control plane for slot management — see the
   *  multi-tenant-host reference snippet. */
  installAgentOnHost: (args: {
    hostUrl: string;
    slotId: string;
    agentName: string;
    agentSource: string;
    ownerId: string;
  }) => Promise<void>;
  uninstallAgentFromHost: (args: {
    hostUrl: string;
    slotId: string;
  }) => Promise<void>;
  /** Logger; just info / warn level needed. */
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

/**
 * Allocate a free-tier agent slot for an owner. Looks up an unassigned
 * slot in the pool; if none exists and the pool is below POOL_SIZE,
 * provisions a fresh host. If the pool is full and there are no free
 * slots, returns pool_exhausted (ops upgrade prompt or eviction sweep).
 */
export async function assignSlotToOwner(
  deps: SharedSandboxPoolDeps,
  args: { ownerId: string; agentName: string; agentSource: string },
): Promise<AssignSlotResult | AssignSlotFailure> {
  const col = deps.db.collection<Slot>(SLOT_COLLECTION);

  // Idempotent: if this owner already has a slot, return it.
  const existing = await col.findOne({ ownerId: args.ownerId, status: 'assigned' });
  if (existing) {
    return { ok: true, slot: existing, warm: true };
  }

  // Step 1: try to grab an existing free slot.
  const free = await col.findOneAndUpdate(
    { status: 'free' },
    {
      $set: {
        ownerId: args.ownerId,
        agentName: args.agentName,
        status: 'assigned' as SlotStatus,
        assignedAt: new Date().toISOString(),
        monthlyInvocations: 0,
        monthlyInvocationsResetAt: monthStartIso(),
      },
    },
    { returnDocument: 'after' },
  );
  if (free) {
    try {
      await deps.installAgentOnHost({
        hostUrl: free.hostUrl,
        slotId: free.slotId,
        agentName: args.agentName,
        agentSource: args.agentSource,
        ownerId: args.ownerId,
      });
    } catch (err) {
      // Roll back the assignment so another caller can retry.
      await col.updateOne(
        { slotId: free.slotId },
        { $set: { ownerId: null, agentName: null, status: 'free', assignedAt: null } },
      );
      return {
        ok: false,
        reason: 'storage_failed',
        detail: 'install_agent_on_host failed: ' + String((err as Error).message ?? err).slice(0, 240),
      };
    }
    deps.logger?.info?.({ slotId: free.slotId, ownerId: args.ownerId }, 'assigned warm slot');
    return { ok: true, slot: free, warm: true };
  }

  // Step 2: no warm slots — check whether we can provision a new host.
  const totalHosts = await col.distinct('sandboxName').then((arr) => arr.length);
  if (totalHosts >= POOL_SIZE) {
    return {
      ok: false,
      reason: 'pool_exhausted',
      detail: `Free-tier pool is at capacity (${POOL_SIZE} hosts × ${SLOTS_PER_HOST} slots). Upgrade to paid for a dedicated sandbox or wait for a free slot.`,
    };
  }

  // Step 3: cold-provision a new host with SLOTS_PER_HOST empty slots.
  const sandboxName = `argo-free-host-${nanoid(8).toLowerCase()}`;
  let hostUrl: string;
  let hostInternalUrl: string | undefined;
  try {
    const provisioned = await deps.provisionHost(sandboxName);
    hostUrl = provisioned.hostUrl;
    hostInternalUrl = provisioned.hostInternalUrl;
  } catch (err) {
    return {
      ok: false,
      reason: 'storage_failed',
      detail: 'provision_host failed: ' + String((err as Error).message ?? err).slice(0, 240),
    };
  }

  const newSlots: Slot[] = [];
  for (let i = 0; i < SLOTS_PER_HOST; i++) {
    const slot: Slot = {
      slotId: 'slot_' + nanoid(10),
      sandboxName,
      hostUrl,
      ...(hostInternalUrl ? { hostInternalUrl } : {}),
      ownerId: i === 0 ? args.ownerId : null,
      agentName: i === 0 ? args.agentName : null,
      status: i === 0 ? 'assigned' : 'free',
      assignedAt: i === 0 ? new Date().toISOString() : null,
      lastInvocation: null,
      monthlyInvocations: 0,
      monthlyInvocationsResetAt: monthStartIso(),
    };
    newSlots.push(slot);
  }
  await col.insertMany(newSlots);

  // Install the operator's agent on the new host's slot 0.
  const assignedSlot = newSlots[0]!;
  try {
    await deps.installAgentOnHost({
      hostUrl,
      slotId: assignedSlot.slotId,
      agentName: args.agentName,
      agentSource: args.agentSource,
      ownerId: args.ownerId,
    });
  } catch (err) {
    // Roll back: mark slot free, leave host running so the next caller
    // gets a warm slot.
    await col.updateOne(
      { slotId: assignedSlot.slotId },
      { $set: { ownerId: null, agentName: null, status: 'free', assignedAt: null } },
    );
    return {
      ok: false,
      reason: 'storage_failed',
      detail: 'install_agent_on_host failed: ' + String((err as Error).message ?? err).slice(0, 240),
    };
  }

  deps.logger?.info?.({ slotId: assignedSlot.slotId, sandboxName, ownerId: args.ownerId }, 'cold-provisioned new host + assigned slot');
  return { ok: true, slot: assignedSlot, warm: false };
}

/**
 * Release a slot — free-tier user upgraded to paid, or stale eviction.
 * Tears down the agent on the host but leaves the host running so the
 * remaining slot stays available.
 */
export async function releaseSlot(
  deps: SharedSandboxPoolDeps,
  args: { slotId: string; reason: 'upgrade' | 'evicted' | 'admin' },
): Promise<{ ok: boolean; detail?: string }> {
  const col = deps.db.collection<Slot>(SLOT_COLLECTION);
  const slot = await col.findOne({ slotId: args.slotId });
  if (!slot) return { ok: false, detail: 'slot_not_found' };
  if (slot.status === 'free') return { ok: true, detail: 'already_free' };

  try {
    await deps.uninstallAgentFromHost({ hostUrl: slot.hostUrl, slotId: slot.slotId });
  } catch (err) {
    deps.logger?.warn?.(
      { slotId: args.slotId, err: String((err as Error).message ?? err) },
      'uninstall_agent_from_host failed; marking slot free anyway',
    );
  }

  await col.updateOne(
    { slotId: args.slotId },
    {
      $set: {
        ownerId: null,
        agentName: null,
        status: args.reason === 'evicted' ? ('evicted' as SlotStatus) : ('free' as SlotStatus),
        assignedAt: null,
        lastInvocation: null,
        monthlyInvocations: 0,
        monthlyInvocationsResetAt: monthStartIso(),
      },
    },
  );

  // If the slot is on a host where ALL slots are now evicted/free, the
  // background sweep can teardown the host. We don't do it eagerly here
  // — keep that decision in a separate scheduled job.
  return { ok: true };
}

/**
 * Record an invocation against a slot. Increments the monthly counter,
 * resets it on the 1st of the month, returns whether the cap is hit.
 */
export async function recordInvocation(
  deps: SharedSandboxPoolDeps,
  args: { slotId: string },
): Promise<{ ok: boolean; underCap: boolean; count: number }> {
  const col = deps.db.collection<Slot>(SLOT_COLLECTION);
  const monthStart = monthStartIso();
  const slot = await col.findOne({ slotId: args.slotId });
  if (!slot) return { ok: false, underCap: false, count: 0 };

  const needsReset = slot.monthlyInvocationsResetAt !== monthStart;
  const newCount = needsReset ? 1 : slot.monthlyInvocations + 1;
  await col.updateOne(
    { slotId: args.slotId },
    {
      $set: {
        lastInvocation: new Date().toISOString(),
        monthlyInvocations: newCount,
        monthlyInvocationsResetAt: monthStart,
      },
    },
  );
  return {
    ok: true,
    underCap: newCount <= FREE_TIER_INVOCATION_CAP,
    count: newCount,
  };
}

/**
 * Sweep idle slots (no invocation in 30 days). Frees them so new signups
 * find a warm slot. Caller (a daily cron) decides what to do with the
 * affected ownerId — typically email + offer to re-claim.
 */
export async function sweepIdleSlots(
  deps: SharedSandboxPoolDeps,
  args: { idleDays?: number } = {},
): Promise<{ swept: string[] }> {
  const col = deps.db.collection<Slot>(SLOT_COLLECTION);
  const idleDays = args.idleDays ?? 30;
  const cutoff = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000).toISOString();

  const idle = await col
    .find({ status: 'assigned', lastInvocation: { $lt: cutoff } })
    .toArray();

  const swept: string[] = [];
  for (const s of idle) {
    const r = await releaseSlot(deps, { slotId: s.slotId, reason: 'evicted' });
    if (r.ok) swept.push(s.slotId);
  }
  return { swept };
}

/** Pool-wide stats for the admin / billing surface. */
export async function poolStats(deps: SharedSandboxPoolDeps): Promise<{
  totalHosts: number;
  totalSlots: number;
  freeSlots: number;
  assignedSlots: number;
  evictedSlots: number;
  capacityRemaining: number;
}> {
  const col = deps.db.collection<Slot>(SLOT_COLLECTION);
  const [hosts, totalSlots, freeSlots, assignedSlots, evictedSlots] = await Promise.all([
    col.distinct('sandboxName'),
    col.countDocuments({}),
    col.countDocuments({ status: 'free' }),
    col.countDocuments({ status: 'assigned' }),
    col.countDocuments({ status: 'evicted' }),
  ]);
  return {
    totalHosts: hosts.length,
    totalSlots,
    freeSlots,
    assignedSlots,
    evictedSlots,
    capacityRemaining:
      (POOL_SIZE - hosts.length) * SLOTS_PER_HOST + freeSlots,
  };
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
