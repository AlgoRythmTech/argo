// Replay tab — Section 16's "Replay Test" acceptance criterion. Lists
// every agent invocation; expand a row to see the full envelope + raw
// response. PII is already redacted at write-time.

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { replay, type ReplayInvocation } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface ReplayPanelProps {
  /** Optional: scope to one operation. Omit to see every invocation. */
  operationId?: string;
}

export function ReplayPanel({ operationId }: ReplayPanelProps) {
  const [items, setItems] = useState<ReplayInvocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    replay
      .list({ ...(operationId !== undefined ? { operationId } : {}), limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.invocations);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    replay
      .get(openId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setDetailLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const kinds = useMemo(() => {
    if (!items) return [];
    return Array.from(new Set(items.map((i) => i.kind))).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (!kindFilter) return items;
    return items.filter((i) => i.kind === kindFilter);
  }, [items, kindFilter]);

  return (
    <div className="h-full flex flex-col bg-argo-bg overflow-hidden">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-argo-text">
          <Sparkles className="h-4 w-4 text-argo-accent" />
          <span className="text-sm">Replay · agent invocations</span>
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="bg-argo-surface border border-argo-border rounded text-xs text-argo-text px-2 py-0.5 font-mono"
        >
          <option value="">all kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-argo-textSecondary text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12">
            <div className="max-w-sm text-sm argo-body">
              No invocations yet. Once Argo's agent runs (scope, build, repair, digest, classification),
              every call lands here for replay + audit.
            </div>
          </div>
        ) : (
          <ul>
            {filtered.map((inv) => {
              const open = openId === inv.id;
              return (
                <li key={inv.id} className="border-b border-argo-border/60">
                  <button
                    type="button"
                    onClick={() => setOpenId((o) => (o === inv.id ? null : inv.id))}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-argo-surface/30 transition-colors"
                  >
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-argo-textSecondary flex-shrink-0 transition-transform',
                        open && 'rotate-180',
                      )}
                    />
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-widest font-mono px-1.5 py-0.5 rounded',
                        inv.status === 'succeeded'
                          ? 'bg-argo-green/10 text-argo-green'
                          : inv.status === 'failed_parse' || inv.status === 'failed_provider'
                          ? 'bg-argo-red/10 text-argo-red'
                          : 'bg-argo-amber/10 text-argo-amber',
                      )}
                    >
                      {inv.status}
                    </span>
                    <span className="text-sm text-argo-text font-mono truncate">{inv.kind}</span>
                    <span className="text-xs text-argo-textSecondary font-mono ml-auto flex-shrink-0">
                      {inv.model} · {inv.durationMs ?? '?'}ms
                    </span>
                    {(inv.promptTokens ?? null) !== null && (
                      <span className="text-xs text-argo-textSecondary font-mono flex-shrink-0">
                        in {inv.promptTokens} · out {inv.completionTokens}
                      </span>
                    )}
                  </button>
                  <AnimatePresence>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden bg-[#0a0a0b] border-t border-argo-border/40"
                      >
                        <div className="p-4 space-y-3">
                          {detailLoading ? (
                            <div className="text-argo-textSecondary text-xs">
                              <Loader2 className="h-3 w-3 animate-spin inline mr-1.5" /> Loading detail…
                            </div>
                          ) : !detail ? (
                            <div className="text-argo-amber text-xs">Couldn't load detail.</div>
                          ) : (
                            <>
                              <Field title="Envelope (PII-redacted)">
                                <pre className="text-[11px] text-argo-textSecondary whitespace-pre-wrap font-mono">
                                  {prettyJson((detail as { envelope?: unknown }).envelope)}
                                </pre>
                              </Field>
                              <Field title="Raw response">
                                <pre className="text-[11px] text-argo-textSecondary whitespace-pre-wrap font-mono max-h-64 overflow-auto">
                                  {String((detail as { rawResponse?: string | null }).rawResponse ?? '(empty)').slice(
                                    0,
                                    8000,
                                  )}
                                </pre>
                              </Field>
                              {(detail as { errorMessage?: string | null }).errorMessage && (
                                <Field title="Error">
                                  <pre className="text-[11px] text-argo-red whitespace-pre-wrap font-mono">
                                    {String((detail as { errorMessage?: string | null }).errorMessage)}
                                  </pre>
                                </Field>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function prettyJson(value: unknown): string {
  if (value === undefined) return '(empty)';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
