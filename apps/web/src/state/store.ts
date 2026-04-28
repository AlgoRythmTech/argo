import { create } from 'zustand';
import type { ActivityEntry, Me, Operation } from '../api/client.js';

/**
 * UI state — operations list, active selection, activity feed, builder
 * dialogue, deploy progress. Server state lives in TanStack Query.
 */

export type DeployPhase =
  | { phase: 'idle' }
  | { phase: 'building'; message: string }
  | { phase: 'testing'; message: string }
  | { phase: 'deploying'; message: string; filesUploaded?: number; filesTotal?: number }
  | { phase: 'ready'; publicUrl: string }
  | { phase: 'failed'; message: string };

export type AppView = 'landing' | 'sign-in' | 'workspace' | 'repair-review' | 'studio' | 'demo' | 'guarantees';

interface ArgoStore {
  view: AppView;
  setView: (view: AppView) => void;

  me: Me | null;
  setMe: (me: Me | null) => void;

  operations: Operation[];
  setOperations: (ops: Operation[]) => void;
  upsertOperation: (op: Operation) => void;

  activeOperationId: string | null;
  setActiveOperation: (id: string | null) => void;

  activity: ActivityEntry[];
  setActivity: (entries: ActivityEntry[]) => void;
  pushActivity: (entry: ActivityEntry) => void;

  deploy: DeployPhase;
  setDeploy: (state: DeployPhase) => void;

  workflowMaps: Record<string, { version: number; map: unknown }>;
  setWorkflowMap: (operationId: string, version: number, map: unknown) => void;

  reviewRepairId: string | null;
  setReviewRepair: (id: string | null) => void;
}

export const useArgo = create<ArgoStore>((set) => ({
  view: 'landing',
  setView: (view) => set({ view }),

  me: null,
  setMe: (me) => set({ me, view: me ? 'workspace' : 'sign-in' }),

  operations: [],
  setOperations: (operations) => set({ operations }),
  upsertOperation: (op) =>
    set((state) => {
      const idx = state.operations.findIndex((o) => o.id === op.id);
      if (idx === -1) return { operations: [op, ...state.operations] };
      const next = state.operations.slice();
      next[idx] = op;
      return { operations: next };
    }),

  activeOperationId: null,
  setActiveOperation: (id) => set({ activeOperationId: id }),

  activity: [],
  setActivity: (activity) => set({ activity }),
  pushActivity: (entry) =>
    set((state) => ({
      activity: [entry, ...state.activity.filter((e) => e.id !== entry.id)].slice(0, 200),
    })),

  deploy: { phase: 'idle' },
  setDeploy: (deploy) => set({ deploy }),

  workflowMaps: {},
  setWorkflowMap: (operationId, version, map) =>
    set((state) => ({ workflowMaps: { ...state.workflowMaps, [operationId]: { version, map } } })),

  reviewRepairId: null,
  setReviewRepair: (reviewRepairId) =>
    set({ reviewRepairId, view: reviewRepairId ? 'repair-review' : 'workspace' }),
}));
