// Replay tab — Section 16's "Replay Test" acceptance criterion.
//
// The Michelin upgrade (Day 4 part 7):
//   • Stats strip at top: invocation count, total cost USD, success
//     rate, median duration. The bookkeeping the operator wants on
//     their monthly check-in without reading every row.
//   • Timeline strip: one dot per invocation in chronological order,
//     colored by status, sized by costUsd. Click a dot to scroll the
//     matching row into view + open it.
//   • Cost USD column on every row (now that the cost ledger writes
//     a number per invocation, surface it).
//
// The expandable per-row detail (envelope + raw response) is unchanged.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Hash,
  Loader2,
  Sparkles,
} from 'lucide-react';
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

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

  // Sort filtered chronologically (oldest -> newest) for the timeline.
  // The list still renders newest-first for reading.
  const chronological = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [filtered],
  );

  const stats = useMemo(() => deriveStats(filtered), [filtered]);

  const focusInvocation = (id: string) => {
    setOpenId(id);
    const el = rowRefs.current.get(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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

      {!loading && filtered.length > 0 && (
        <>
          <StatsStrip stats={stats} />
          <Timeline
            items={chronological}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onSelect={focusInvocation}
          />
        </>
      )}

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
              const dim = hoveredId !== null && hoveredId !== inv.id;
              return (
                <li
                  key={inv.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(inv.id, el);
                    else rowRefs.current.delete(inv.id);
                  }}
                  className={cn(
                    'border-b border-argo-border/60 transition-opacity',
                    dim && 'opacity-40',
                    hoveredId === inv.id && 'bg-argo-accent/5',
                  )}
                  onMouseEnter={() => setHoveredId(inv.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
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
                    {(inv.costUsd ?? null) !== null && (
                      <span
                        title="LLM cost for this invocation"
                        className="text-xs text-argo-accent font-mono flex-shrink-0 inline-flex items-center gap-1"
                      >
                        <CircleDollarSign className="h-3 w-3" />
                        {formatUsd(inv.costUsd!)}
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

// ── Stats summary strip ────────────────────────────────────────────────

interface ReplayStats {
  count: number;
  succeeded: number;
  failed: number;
  successRatePct: number;
  totalUsd: number;
  totalTokens: number;
  medianMs: number;
}

function deriveStats(items: ReplayInvocation[]): ReplayStats {
  if (items.length === 0) {
    return { count: 0, succeeded: 0, failed: 0, successRatePct: 0, totalUsd: 0, totalTokens: 0, medianMs: 0 };
  }
  let totalUsd = 0;
  let totalTokens = 0;
  let succeeded = 0;
  let failed = 0;
  const durations: number[] = [];
  for (const i of items) {
    if (i.costUsd != null) totalUsd += i.costUsd;
    if (i.promptTokens != null) totalTokens += i.promptTokens;
    if (i.completionTokens != null) totalTokens += i.completionTokens;
    if (i.status === 'succeeded') succeeded++;
    else if (i.status === 'failed_parse' || i.status === 'failed_provider') failed++;
    if (i.durationMs != null) durations.push(i.durationMs);
  }
  durations.sort((a, b) => a - b);
  const medianMs = durations.length ? durations[Math.floor(durations.length / 2)]! : 0;
  const successRatePct =
    succeeded + failed === 0 ? 0 : Math.round((succeeded / (succeeded + failed)) * 100);
  return { count: items.length, succeeded, failed, successRatePct, totalUsd, totalTokens, medianMs };
}

function StatsStrip({ stats }: { stats: ReplayStats }) {
  return (
    <div className="grid grid-cols-4 gap-px bg-argo-border border-b border-argo-border flex-shrink-0">
      <Stat icon={<Hash className="h-3 w-3" />} label="Invocations" value={stats.count.toString()} />
      <Stat
        icon={<CheckCircle2 className="h-3 w-3" />}
        label="Success rate"
        value={`${stats.successRatePct}%`}
        tone={stats.successRatePct >= 95 ? 'good' : stats.successRatePct >= 80 ? 'warn' : 'bad'}
      />
      <Stat
        icon={<Clock className="h-3 w-3" />}
        label="Median latency"
        value={stats.medianMs ? `${formatMs(stats.medianMs)}` : '—'}
      />
      <Stat
        icon={<CircleDollarSign className="h-3 w-3" />}
        label="LLM spend"
        value={formatUsd(stats.totalUsd)}
        sub={stats.totalTokens ? `${formatTokens(stats.totalTokens)} tokens` : undefined}
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const valueClass =
    tone === 'good'
      ? 'text-argo-green'
      : tone === 'warn'
      ? 'text-argo-amber'
      : tone === 'bad'
      ? 'text-argo-red'
      : 'text-argo-text';
  return (
    <div className="bg-argo-bg px-4 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono mb-1">
        {icon}
        {label}
      </div>
      <div className={cn('text-base font-mono', valueClass)}>{value}</div>
      {sub && <div className="text-[10px] text-argo-textSecondary font-mono mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Timeline strip ─────────────────────────────────────────────────────

function Timeline({
  items,
  hoveredId,
  onHover,
  onSelect,
}: {
  items: ReplayInvocation[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  // Each invocation is a dot; size scales with cost (cap so a $10 outlier
  // doesn't drown out a row of $0.001 invocations).
  const maxCost = Math.max(0.001, ...items.map((i) => i.costUsd ?? 0));
  return (
    <div className="border-b border-argo-border px-4 py-2 flex-shrink-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono mb-1.5">
        <Clock className="h-3 w-3" />
        Timeline · {items.length} invocations · {formatRelative(items[0]!.createdAt)} → {formatRelative(items[items.length - 1]!.createdAt)}
      </div>
      <div className="flex items-end gap-[2px] h-8" role="list">
        {items.map((inv) => {
          const cost = inv.costUsd ?? 0;
          const sizePct = Math.max(0.18, Math.sqrt(cost / maxCost));
          const tone =
            inv.status === 'succeeded'
              ? 'bg-argo-accent'
              : inv.status === 'failed_parse' || inv.status === 'failed_provider'
              ? 'bg-argo-red'
              : 'bg-argo-amber';
          const isHovered = hoveredId === inv.id;
          return (
            <button
              key={inv.id}
              type="button"
              role="listitem"
              onMouseEnter={() => onHover(inv.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(inv.id)}
              title={`${inv.kind} · ${inv.status} · ${inv.durationMs ?? '?'}ms · ${formatUsd(inv.costUsd ?? 0)}`}
              aria-label={`Replay ${inv.kind} invocation`}
              className={cn(
                'flex-1 min-w-[3px] rounded-t transition-all hover:!opacity-100',
                tone,
                isHovered ? 'opacity-100 ring-1 ring-argo-text/40' : 'opacity-70',
              )}
              style={{ height: `${sizePct * 100}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

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

function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}
