/**
 * CreditShield — visible credit protection badge and mini-dashboard.
 *
 * Shows users their money is protected. Directly addresses "credits burn in
 * loops/crashes" — the #2 complaint across AI app builder platforms.
 *
 * Two modes:
 *   - compact (badge): small pill showing savings with green shield icon
 *   - full (panel): hero card with stat breakdowns, loop detections, refunds
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  DollarSign,
  RotateCcw,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { api } from '../api/client.js';

// ── Types ──────────────────────────────────────────────────────────────

interface CreditShieldProps {
  compact?: boolean;
}

/** Matches backend GET /api/credits/summary response */
interface CreditSummary {
  totalSpentUsd: number;
  totalRefundedUsd: number;
  netChargedUsd: number;
  loopDetections: number;
  platformErrorRefunds: number;
  period: { start: string; end: string };
}

/** Helper to adapt backend names to display names */
function displaySummary(d: CreditSummary) {
  return {
    totalSpent: d.totalSpentUsd,
    autoRefunded: d.totalRefundedUsd,
    netCharged: d.netChargedUsd,
    loopDetections: d.loopDetections,
    platformErrorRefunds: d.platformErrorRefunds,
    periodLabel: `${new Date(d.period.start).toLocaleDateString()} — ${new Date(d.period.end).toLocaleDateString()}`,
  };
}

// ── Fallback data ──────────────────────────────────────────────────────

const SAMPLE_DATA: CreditSummary = {
  totalSpentUsd: 0,
  totalRefundedUsd: 0,
  netChargedUsd: 0,
  loopDetections: 0,
  platformErrorRefunds: 0,
  period: { start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(), end: new Date().toISOString() },
};

// ── Helpers ────────────────────────────────────────────────────────────

function formatUsd(cents: number): string {
  return `$${cents.toFixed(2)}`;
}

// ── Component ──────────────────────────────────────────────────────────

export function CreditShield({ compact }: CreditShieldProps) {
  const [rawData, setRawData] = useState<CreditSummary>(SAMPLE_DATA);
  const data = useMemo(() => displaySummary(rawData), [rawData]);
  const [loading, setLoading] = useState(true);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CreditSummary>('/api/credits/summary')
      .then((res) => {
        if (!cancelled) {
          setRawData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRawData(SAMPLE_DATA);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Compact (badge) mode ────────────────────────────────────────────

  if (compact) {
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
      >
        {/* Badge pill */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-argo-green/10 border border-argo-green/20 cursor-default select-none"
        >
          {/* Pulsing green dot */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-argo-green opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-argo-green" />
          </span>
          <ShieldCheck className="h-3 w-3 text-argo-green" />
          <span className="text-[10px] font-mono text-argo-green whitespace-nowrap">
            {loading ? '...' : `${formatUsd(data.autoRefunded)} saved by CreditShield`}
          </span>
        </motion.div>

        {/* Tooltip */}
        <AnimatePresence>
          {tooltipOpen && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full mt-2 right-0 z-50 w-56 bg-argo-bg border border-argo-border rounded-xl shadow-xl shadow-black/30 p-3"
            >
              <div className="text-[10px] font-mono text-argo-textSecondary uppercase tracking-widest mb-2">
                {data.periodLabel}
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-argo-text">
                  <span>Total spent</span>
                  <span className="font-mono">{formatUsd(data.totalSpent)}</span>
                </div>
                <div className="flex items-center justify-between text-argo-green">
                  <span>Auto-refunded</span>
                  <span className="font-mono">-{formatUsd(data.autoRefunded)}</span>
                </div>
                <div className="h-px bg-argo-border" />
                <div className="flex items-center justify-between text-argo-text font-semibold">
                  <span>Net charged</span>
                  <span className="font-mono">{formatUsd(data.netCharged)}</span>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-argo-border space-y-1 text-[10px] text-argo-textSecondary">
                <div className="flex items-center justify-between">
                  <span>Loop detections</span>
                  <span className="font-mono text-argo-amber">{data.loopDetections}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Error refunds</span>
                  <span className="font-mono text-argo-green">{data.platformErrorRefunds}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Full panel mode ─────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full overflow-y-auto bg-argo-bg p-5"
    >
      {/* Hero card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="relative overflow-hidden rounded-2xl border border-argo-green/20 bg-gradient-to-br from-argo-green/5 to-transparent p-6 mb-5"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-argo-green/15 flex items-center justify-center">
            <Shield className="h-7 w-7 text-argo-green" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-argo-text">CreditShield Active</h2>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-argo-green opacity-50" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-argo-green" />
              </span>
            </div>
            <p className="text-xs text-argo-textSecondary mt-0.5">
              Your credits are protected from platform errors, AI loops, and environment crashes.
            </p>
          </div>
        </div>

        {/* Decorative glow */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-argo-green/5 blur-3xl pointer-events-none" />
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="border border-argo-border rounded-xl p-4 bg-argo-surface/30"
        >
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-argo-textSecondary" />
            <span className="text-[10px] font-mono text-argo-textSecondary uppercase tracking-widest">
              Total spent
            </span>
          </div>
          <div className="text-xl font-semibold text-argo-text font-mono">
            {loading ? '...' : formatUsd(data.totalSpent)}
          </div>
          <div className="text-[10px] text-argo-textSecondary mt-1">{data.periodLabel}</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="border border-argo-green/20 rounded-xl p-4 bg-argo-green/5"
        >
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw className="h-4 w-4 text-argo-green" />
            <span className="text-[10px] font-mono text-argo-green uppercase tracking-widest">
              Auto-refunded
            </span>
          </div>
          <div className="text-xl font-semibold text-argo-green font-mono">
            {loading ? '...' : formatUsd(data.autoRefunded)}
          </div>
          <div className="text-[10px] text-argo-green/70 mt-1">Returned to your balance</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="border border-argo-border rounded-xl p-4 bg-argo-surface/30"
        >
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-4 w-4 text-argo-accent" />
            <span className="text-[10px] font-mono text-argo-textSecondary uppercase tracking-widest">
              Net charged
            </span>
          </div>
          <div className="text-xl font-semibold text-argo-text font-mono">
            {loading ? '...' : formatUsd(data.netCharged)}
          </div>
          <div className="text-[10px] text-argo-textSecondary mt-1">Total minus refunds</div>
        </motion.div>
      </div>

      {/* Protection details */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="border border-argo-border rounded-xl overflow-hidden mb-5"
      >
        <div className="px-4 py-3 border-b border-argo-border bg-argo-surface/50">
          <h3 className="text-xs font-semibold text-argo-text">Protection Events</h3>
        </div>

        <div className="divide-y divide-argo-border">
          {/* Loop detections */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-argo-amber/10 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-argo-amber" />
              </div>
              <div>
                <div className="text-xs font-semibold text-argo-text">Loop detections</div>
                <div className="text-[10px] text-argo-textSecondary">
                  AI build loops caught and halted before burning credits
                </div>
              </div>
            </div>
            <div className="text-lg font-semibold font-mono text-argo-amber">
              {loading ? '...' : data.loopDetections}
            </div>
          </div>

          {/* Platform error refunds */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-argo-green/10 flex items-center justify-center">
                <RotateCcw className="h-4 w-4 text-argo-green" />
              </div>
              <div>
                <div className="text-xs font-semibold text-argo-text">Platform error refunds</div>
                <div className="text-[10px] text-argo-textSecondary">
                  Credits returned for failures caused by our infrastructure
                </div>
              </div>
            </div>
            <div className="text-lg font-semibold font-mono text-argo-green">
              {loading ? '...' : data.platformErrorRefunds}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Promise statement */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className={cn(
          'flex items-start gap-3 rounded-xl border border-argo-accent/15 bg-argo-accent/5 px-4 py-3',
        )}
      >
        <ShieldCheck className="h-5 w-5 text-argo-accent flex-shrink-0 mt-0.5" />
        <p className="text-xs text-argo-text leading-relaxed">
          <strong>Argo never charges you for platform errors, AI loops, or environment crashes.</strong>{' '}
          Every wasted credit is automatically detected and refunded to your balance. No tickets, no
          waiting — it just happens.
        </p>
      </motion.div>
    </motion.div>
  );
}
