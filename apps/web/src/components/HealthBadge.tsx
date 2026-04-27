// One-glance operation health badge for the workspace header.
//
// The doctrine (master prompt §8): operators don't open Argo daily —
// the workspace exists for setup + the monthly check-in. The first
// thing they should see when they DO check in is a single signal:
// is everything fine, do I need to glance, do I need to act.
//
// Tone rules (server-derived):
//   - good: no alerts -> green dot, "All good"
//   - warn: any warn but no bad -> amber dot, summarise top alert
//   - bad : any bad -> red dot, summarise top alert
//
// Click opens a small popover with the full alerts list and the
// 24h / 7d submission counts.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, AlertCircle, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { operations } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface HealthBadgeProps {
  operationId: string;
  /** Refresh interval in ms. Default 60s. */
  refreshMs?: number;
}

interface HealthSnapshot {
  tone: 'good' | 'warn' | 'bad';
  status: string;
  lastSubmissionAt: string | null;
  lastSubmissionAgeMs: number | null;
  submissionsLast24h: number;
  submissionsLast7d: number;
  failedInvocations24h: number;
  pendingRepairs: number;
  staleRepairs: number;
  alerts: Array<{ severity: 'info' | 'warn' | 'bad'; kind: string; message: string }>;
  checkedAt: string;
}

export function HealthBadge({ operationId, refreshMs = 60_000 }: HealthBadgeProps) {
  const [data, setData] = useState<HealthSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await operations.health(operationId);
        if (cancelled) return;
        setData(res);
      } catch {
        /* hush — header signal must never throw */
      }
    };
    void load();
    const id = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [operationId, refreshMs]);

  // Click outside closes the popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!data) return null;

  const Icon = data.tone === 'good' ? CheckCircle2 : data.tone === 'warn' ? AlertTriangle : AlertCircle;
  const tonePill =
    data.tone === 'good'
      ? 'border-argo-green/40 text-argo-green bg-argo-green/10'
      : data.tone === 'warn'
      ? 'border-argo-amber/40 text-argo-amber bg-argo-amber/10'
      : 'border-argo-red/40 text-argo-red bg-argo-red/10';

  const summary = data.alerts[0]?.message ?? `All good · ${data.submissionsLast24h} today`;
  const trimmed = summary.length > 48 ? summary.slice(0, 48) + '…' : summary;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={summary}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-mono select-none',
          tonePill,
        )}
      >
        <Icon className="h-3 w-3" />
        <span className="truncate max-w-[220px]">{trimmed}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-argo-border bg-argo-surface shadow-2xl shadow-black/40 z-30 overflow-hidden"
          >
            <header className="px-4 py-2.5 border-b border-argo-border/60 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-argo-text">
                <Activity className="h-3 w-3 text-argo-accent" />
                <span className="text-xs uppercase tracking-widest font-mono">Operation health</span>
              </div>
              <span className="text-[10px] text-argo-textSecondary font-mono">
                {formatRelative(data.checkedAt)}
              </span>
            </header>

            <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Stat label="Submissions (24h)" value={data.submissionsLast24h.toString()} />
              <Stat label="Submissions (7d)" value={data.submissionsLast7d.toString()} />
              <Stat
                label="Last submission"
                value={
                  data.lastSubmissionAgeMs != null
                    ? formatAge(data.lastSubmissionAgeMs)
                    : 'never'
                }
              />
              <Stat
                label="Pending approvals"
                value={data.pendingRepairs.toString()}
                tone={data.staleRepairs > 0 ? 'warn' : undefined}
              />
              <Stat
                label="Failed agent calls (24h)"
                value={data.failedInvocations24h.toString()}
                tone={data.failedInvocations24h >= 5 ? 'bad' : data.failedInvocations24h > 0 ? 'warn' : undefined}
              />
              <Stat label="Status" value={data.status} mono />
            </div>

            {data.alerts.length > 0 && (
              <div className="px-4 py-3 border-t border-argo-border/60 space-y-2">
                {data.alerts.map((a) => (
                  <div
                    key={a.kind}
                    className={cn(
                      'flex items-start gap-2 text-xs p-2 rounded border',
                      a.severity === 'bad'
                        ? 'border-argo-red/30 bg-argo-red/5 text-argo-text'
                        : a.severity === 'warn'
                        ? 'border-argo-amber/30 bg-argo-amber/5 text-argo-text'
                        : 'border-argo-border bg-argo-surfaceAlt text-argo-textSecondary',
                    )}
                  >
                    {a.severity === 'bad' ? (
                      <AlertCircle className="h-3 w-3 text-argo-red flex-shrink-0 mt-0.5" />
                    ) : a.severity === 'warn' ? (
                      <AlertTriangle className="h-3 w-3 text-argo-amber flex-shrink-0 mt-0.5" />
                    ) : (
                      <Activity className="h-3 w-3 text-argo-accent flex-shrink-0 mt-0.5" />
                    )}
                    <span>{a.message}</span>
                  </div>
                ))}
              </div>
            )}

            <footer className="px-4 py-2 border-t border-argo-border/60 flex items-center justify-between">
              <button
                type="button"
                onClick={() => operations.health(operationId).then(setData).catch(() => undefined)}
                className="inline-flex items-center gap-1 text-[11px] text-argo-textSecondary hover:text-argo-text font-mono"
                title="Re-check now"
              >
                <RefreshCw className="h-3 w-3" /> Re-check
              </button>
              <span className="text-[10px] text-argo-textSecondary font-mono">
                Auto-refreshes every minute
              </span>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'bad';
  mono?: boolean;
}) {
  const valueClass =
    tone === 'bad'
      ? 'text-argo-red'
      : tone === 'warn'
      ? 'text-argo-amber'
      : 'text-argo-text';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">
        {label}
      </div>
      <div className={cn('text-sm', mono && 'font-mono', valueClass)}>{value}</div>
    </div>
  );
}

function formatAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatRelative(iso: string): string {
  return formatAge(Date.now() - new Date(iso).getTime());
}
