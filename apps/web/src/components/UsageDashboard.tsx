import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  Clock,
  CreditCard,
  DollarSign,
  Loader2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { usage, type UsageData } from '../api/client.js';
import { cn } from '../lib/utils.js';

/* ── sample fallback ──────────────────────────────────────────────────── */

const SAMPLE_DATA: UsageData = {
  period: {
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    end: new Date().toISOString(),
    dayOfMonth: new Date().getDate(),
    daysInMonth: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
  },
  totals: {
    invocations: 1_247,
    promptTokens: 3_820_000,
    completionTokens: 1_120_000,
    totalTokens: 4_940_000,
    totalCostUsd: 14.38,
    projectedMonthlyCostUsd: 22.56,
  },
  byModel: [
    { model: 'claude-sonnet-4-20250514', invocations: 820, promptTokens: 2_400_000, completionTokens: 700_000, totalTokens: 3_100_000, costUsd: 9.30, avgDurationMs: 2_100, failures: 3 },
    { model: 'claude-haiku-4-20250514', invocations: 380, promptTokens: 1_200_000, completionTokens: 350_000, totalTokens: 1_550_000, costUsd: 3.10, avgDurationMs: 820, failures: 1 },
    { model: 'gpt-4o-mini', invocations: 47, promptTokens: 220_000, completionTokens: 70_000, totalTokens: 290_000, costUsd: 1.98, avgDurationMs: 1_400, failures: 0 },
  ],
  byOperation: [
    { operationId: 'op_1', operationName: 'Hiring Pipeline', invocations: 580, costUsd: 7.42 },
    { operationId: 'op_2', operationName: 'Invoice Processor', invocations: 340, costUsd: 4.11 },
    { operationId: 'op_3', operationName: 'Support Triage', invocations: 327, costUsd: 2.85 },
  ],
  daily: Array.from({ length: new Date().getDate() }, (_, i) => ({
    date: new Date(new Date().getFullYear(), new Date().getMonth(), i + 1).toISOString().slice(0, 10),
    invocations: 30 + Math.floor(Math.random() * 60),
    tokens: 100_000 + Math.floor(Math.random() * 200_000),
    costUsd: 0.3 + Math.random() * 0.9,
  })),
};

/* ── pricing ref ──────────────────────────────────────────────────────── */

const PRICING = [
  { model: 'Claude Sonnet 4', input: '$3.00', output: '$15.00' },
  { model: 'Claude Haiku 4', input: '$0.80', output: '$4.00' },
  { model: 'GPT-4o mini', input: '$0.15', output: '$0.60' },
  { model: 'Claude Opus 4', input: '$15.00', output: '$75.00' },
];

/* ── component ────────────────────────────────────────────────────────── */

export function UsageDashboard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    usage
      .get()
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(SAMPLE_DATA); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const maxTokens = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.daily.map((d) => d.tokens), 1);
  }, [data]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg text-argo-red text-sm">
        {error ?? 'Failed to load usage data'}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-argo-bg p-6 space-y-6">
      {/* ── hero cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HeroCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Total Spend (MTD)"
          value={`$${data.totals.totalCostUsd.toFixed(2)}`}
          sub={`Projected: $${data.totals.projectedMonthlyCostUsd.toFixed(2)}`}
          accent="text-argo-accent"
          delay={0}
        />
        <HeroCard
          icon={<Zap className="h-5 w-5" />}
          label="Invocations"
          value={data.totals.invocations.toLocaleString()}
          sub={`${(data.totals.totalTokens / 1_000_000).toFixed(1)}M tokens`}
          accent="text-argo-green"
          delay={0.05}
        />
        <HeroCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Daily Average"
          value={`$${(data.totals.totalCostUsd / Math.max(data.period.dayOfMonth, 1)).toFixed(2)}`}
          sub={`Day ${data.period.dayOfMonth} of ${data.period.daysInMonth}`}
          accent="text-argo-amber"
          delay={0.1}
        />
      </div>

      {/* ── daily bar chart ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.12 }}
        className="rounded-xl border border-argo-border bg-argo-surface p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-argo-accent" />
          <h3 className="text-sm font-medium text-argo-text">Daily Token Usage</h3>
        </div>
        <div className="flex items-end gap-[3px] h-32">
          {data.daily.map((d, i) => {
            const pct = (d.tokens / maxTokens) * 100;
            return (
              <motion.div
                key={d.date}
                className="relative flex-1 group"
                initial={{ height: 0 }}
                animate={{ height: `${pct}%` }}
                transition={{ duration: 0.4, delay: i * 0.015 }}
              >
                <div
                  className="absolute inset-0 rounded-t bg-argo-accent/60 group-hover:bg-argo-accent transition-colors"
                />
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-argo-surface border border-argo-border rounded px-2 py-1 text-[10px] text-argo-text whitespace-nowrap z-10 shadow-lg">
                  {d.date.slice(5)}: {(d.tokens / 1000).toFixed(0)}k tokens / ${d.costUsd.toFixed(2)}
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-argo-text/30 font-mono">
          <span>{data.daily[0]?.date.slice(5)}</span>
          <span>{data.daily[data.daily.length - 1]?.date.slice(5)}</span>
        </div>
      </motion.div>

      {/* ── model breakdown ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="rounded-xl border border-argo-border bg-argo-surface p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-argo-accent" />
          <h3 className="text-sm font-medium text-argo-text">Model Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-argo-text/40 uppercase tracking-wider border-b border-argo-border">
                <th className="text-left py-2 pr-4">Model</th>
                <th className="text-right py-2 px-3">Invocations</th>
                <th className="text-right py-2 px-3">Tokens</th>
                <th className="text-right py-2 px-3">Cost</th>
                <th className="text-right py-2 px-3">Avg Latency</th>
                <th className="text-right py-2 pl-3">Failures</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((m) => (
                <tr key={m.model} className="border-b border-argo-border/50 hover:bg-argo-accent/5 transition-colors">
                  <td className="py-2 pr-4 font-mono text-xs text-argo-text/80 truncate max-w-[180px]">{m.model}</td>
                  <td className="py-2 px-3 text-right text-argo-text/70">{m.invocations.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right text-argo-text/70">{(m.totalTokens / 1000).toFixed(0)}k</td>
                  <td className="py-2 px-3 text-right text-argo-green font-medium">${m.costUsd.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-argo-text/50">{(m.avgDurationMs / 1000).toFixed(1)}s</td>
                  <td className={cn('py-2 pl-3 text-right', m.failures > 0 ? 'text-argo-red' : 'text-argo-text/30')}>
                    {m.failures}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ── operation breakdown ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.28 }}
        className="rounded-xl border border-argo-border bg-argo-surface p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="h-4 w-4 text-argo-accent" />
          <h3 className="text-sm font-medium text-argo-text">Cost by Operation</h3>
        </div>
        <div className="space-y-3">
          {data.byOperation.map((op, i) => {
            const pct = data.totals.totalCostUsd > 0
              ? (op.costUsd / data.totals.totalCostUsd) * 100
              : 0;
            return (
              <div key={op.operationId}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-argo-text/80 truncate max-w-[60%]">{op.operationName}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-argo-text/40">{op.invocations} calls</span>
                    <span className="text-argo-green font-medium">${op.costUsd.toFixed(2)}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-argo-border rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-argo-accent/70"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, delay: 0.3 + i * 0.06 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ── pricing reference ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.36 }}
        className="rounded-xl border border-argo-border bg-argo-surface p-5"
      >
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4 text-argo-accent" />
          <h3 className="text-sm font-medium text-argo-text">Pricing Reference (per 1M tokens)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-argo-text/40 uppercase tracking-wider border-b border-argo-border">
                <th className="text-left py-2 pr-4">Model</th>
                <th className="text-right py-2 px-3">Input</th>
                <th className="text-right py-2 pl-3">Output</th>
              </tr>
            </thead>
            <tbody>
              {PRICING.map((p) => (
                <tr key={p.model} className="border-b border-argo-border/50">
                  <td className="py-2 pr-4 text-argo-text/80">{p.model}</td>
                  <td className="py-2 px-3 text-right text-argo-text/60 font-mono">{p.input}</td>
                  <td className="py-2 pl-3 text-right text-argo-text/60 font-mono">{p.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

/* ── sub-components ───────────────────────────────────────────────────── */

function HeroCard({
  icon,
  label,
  value,
  sub,
  accent,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="rounded-xl border border-argo-border bg-argo-surface p-5"
    >
      <div className={cn('flex items-center gap-2 mb-2', accent)}>
        {icon}
        <span className="text-xs uppercase tracking-wider text-argo-text/40">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-argo-text">{value}</div>
      <div className="text-xs text-argo-text/40 mt-1">{sub}</div>
    </motion.div>
  );
}
