// Memory transparency panel — the operator's window into what Argo
// has internalised about them via supermemory.ai. Master prompt §11
// promised persistent memory; this surface delivers on the second
// half of that promise: every fact is visible, every fact is
// deletable, the operator is never surprised by what Argo knows.
//
// Lives behind a workspace tab. When SUPERMEMORY_ENABLED=false the
// API returns enabled=false and we render a friendly off-state with
// a hint about how to flip it on.

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Loader2, Search, Trash2, Sparkles, ShieldOff } from 'lucide-react';
import { memory, type MemoryEntry } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface MemoryPanelProps {
  /** When set, list is scoped to one operation. Omit for the operator's full memory. */
  operationId?: string;
  onClose?: () => void;
}

const KIND_LABEL: Record<string, { label: string; tint: string }> = {
  voice_preference: { label: 'Voice', tint: 'text-argo-accent border-argo-accent/30 bg-argo-accent/10' },
  client_quirk: { label: 'Client', tint: 'text-argo-amber border-argo-amber/30 bg-argo-amber/10' },
  workflow_decision: { label: 'Workflow', tint: 'text-argo-text border-argo-border bg-argo-surface' },
  recurring_request: { label: 'Recurring', tint: 'text-argo-text border-argo-border bg-argo-surface' },
  do_not_do: { label: 'Avoid', tint: 'text-argo-red border-argo-red/30 bg-argo-red/10' },
  memory: { label: 'Note', tint: 'text-argo-textSecondary border-argo-border bg-argo-surface' },
};

export function MemoryPanel({ operationId, onClose }: MemoryPanelProps) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    memory
      .list({ ...(operationId ? { operationId } : {}), limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setEntries(res.memories);
        setEnabled(res.enabled);
        setNote(res.note ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err?.message ?? err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId]);

  const kinds = useMemo(() => {
    if (!entries) return [];
    return Array.from(new Set(entries.map((e) => e.kind))).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const ql = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (kindFilter && e.kind !== kindFilter) return false;
      if (ql && !e.content.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [entries, kindFilter, q]);

  const forget = async (id: string) => {
    setForgettingId(id);
    try {
      await memory.forget(id);
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    } catch (err) {
      setError(`Couldn't forget that one — ${String((err as Error)?.message ?? err)}`);
    } finally {
      setForgettingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-argo-text">
          <Brain className="h-4 w-4 text-argo-accent" />
          <span className="text-sm">What Argo remembers</span>
          {enabled && entries && entries.length > 0 && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-argo-textSecondary border border-argo-border rounded px-1.5 py-0.5">
              {entries.length} {entries.length === 1 ? 'fact' : 'facts'}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-argo-textSecondary hover:text-argo-text text-xs px-2"
          >
            Close
          </button>
        )}
      </header>

      {enabled && (
        <div className="flex items-center gap-2 border-b border-argo-border px-3 h-10 flex-shrink-0">
          <Search className="h-3.5 w-3.5 text-argo-textSecondary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search memories…"
            className="flex-1 bg-transparent text-argo-text text-sm placeholder:text-argo-textSecondary focus:outline-none"
          />
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="bg-argo-surface border border-argo-border rounded text-xs text-argo-text px-2 py-0.5 font-mono"
          >
            <option value="">all kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]?.label ?? k}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="border-b border-argo-red/30 bg-argo-red/10 px-4 py-2 text-xs text-argo-red font-mono">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-argo-textSecondary">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading memories…
          </div>
        )}

        {!loading && !enabled && (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <ShieldOff className="h-8 w-8 text-argo-textSecondary mb-3" />
            <h3 className="text-argo-text text-base mb-2 argo-body">
              Persistent memory is off
            </h3>
            <p className="text-argo-textSecondary text-sm max-w-md argo-body">
              {note ?? 'Set SUPERMEMORY_ENABLED=true to let Argo remember your voice, your clients, and the decisions you\'ve already approved.'}
            </p>
          </div>
        )}

        {!loading && enabled && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <Sparkles className="h-8 w-8 text-argo-textSecondary mb-3" />
            <h3 className="text-argo-text text-base mb-2 argo-body">
              No memories yet.
            </h3>
            <p className="text-argo-textSecondary text-sm max-w-md argo-body">
              Argo writes a memory when you finalise a brief, approve a repair, or set
              compliance rules. They show up here so you can review or remove them.
            </p>
          </div>
        )}

        {!loading && enabled && filtered.length > 0 && (
          <ul className="divide-y divide-argo-border">
            <AnimatePresence initial={false}>
              {filtered.map((m) => {
                const meta = KIND_LABEL[m.kind] ?? KIND_LABEL.memory!;
                return (
                  <motion.li
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="px-4 py-3 hover:bg-argo-surface/50 group"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'text-[10px] font-mono uppercase tracking-widest border rounded px-1.5 py-0.5 mt-0.5 flex-shrink-0',
                          meta.tint,
                        )}
                      >
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-argo-text argo-body leading-relaxed">
                          {m.content}
                        </p>
                        {m.tags && m.tags.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {m.tags.map((t) => (
                              <span
                                key={t}
                                className="text-[10px] font-mono text-argo-textSecondary"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => forget(m.id)}
                        disabled={forgettingId === m.id}
                        title="Forget this memory"
                        aria-label="Forget this memory"
                        className="text-argo-textSecondary hover:text-argo-red opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 disabled:opacity-50"
                      >
                        {forgettingId === m.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {enabled && entries && entries.length > 0 && (
        <footer className="border-t border-argo-border px-4 py-2 text-[11px] text-argo-textSecondary font-mono">
          Memories are owner-scoped. Argo never shares them with anyone outside your account.
        </footer>
      )}
    </div>
  );
}
