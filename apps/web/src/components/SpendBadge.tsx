// Per-operation cost-and-spend badge — shown in the workspace header.
// Master prompt §14: $30/month is the per-operation LLM budget. The badge
// turns amber at $20 and red at $30; tooltip shows the breakdown.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleDollarSign } from 'lucide-react';
import { billing } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface SpendBadgeProps {
  /** Operation to scope to. Omit for the global total. */
  operationId?: string;
  /** Per-operation budget cap in USD. Defaults to $30 (master prompt §14). */
  budgetUsd?: number;
  /** Refresh interval in ms. Default 60s. */
  refreshMs?: number;
}

export function SpendBadge({ operationId, budgetUsd = 30, refreshMs = 60_000 }: SpendBadgeProps) {
  const [spend, setSpend] = useState<{
    totalUsd: number;
    invocations: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const u = await billing.usage();
        if (cancelled) return;
        if (operationId) {
          const row = u.perOperation.find((p) => p.operationId === operationId);
          setSpend({
            totalUsd: row?.totalUsd ?? 0,
            invocations: row?.invocations ?? 0,
          });
        } else {
          setSpend({
            totalUsd: u.totalUsd,
            invocations: u.perOperation.reduce((s, p) => s + p.invocations, 0),
          });
        }
      } catch {
        /* hush — header badge is non-critical */
      }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [operationId, refreshMs]);

  if (!spend) return null;
  const pct = Math.min(100, (spend.totalUsd / budgetUsd) * 100);
  const tone =
    spend.totalUsd >= budgetUsd
      ? 'border-argo-red/40 text-argo-red bg-argo-red/10'
      : spend.totalUsd >= budgetUsd * 0.66
      ? 'border-argo-amber/40 text-argo-amber bg-argo-amber/10'
      : 'border-argo-border text-argo-textSecondary bg-argo-surface/40';

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      title={`This month so far: ${formatUsd(spend.totalUsd)} across ${spend.invocations} agent invocations.\nBudget: ${formatUsd(budgetUsd)} per operation per month.`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-mono select-none',
        tone,
      )}
    >
      <CircleDollarSign className="h-3 w-3" />
      <span>{formatUsd(spend.totalUsd)}</span>
      <span className="text-[10px] opacity-70">· {pct.toFixed(0)}%</span>
    </motion.span>
  );
}

function formatUsd(n: number): string {
  if (n < 0.01) return '$0.00';
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}
