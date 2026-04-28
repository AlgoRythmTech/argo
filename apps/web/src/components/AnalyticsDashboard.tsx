import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { analytics, type AnalyticsOverview } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface AnalyticsDashboardProps {
  onClose?: () => void;
}

export function AnalyticsDashboard({ onClose }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    analytics
      .overview()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String((err as Error)?.message ?? err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg px-8 text-center">
        <div>
          <BarChart3 className="h-8 w-8 text-argo-red mx-auto mb-3" />
          <p className="text-sm text-argo-red">{error ?? 'Failed to load analytics'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-argo-bg overflow-y-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-argo-border px-5 h-12 flex-shrink-0 sticky top-0 bg-argo-bg z-10">
        <div className="flex items-center gap-2 text-argo-text">
          <BarChart3 className="h-4 w-4 text-argo-accent" />
          <span className="text-sm font-medium">Analytics</span>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-argo-textSecondary hover:text-argo-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="p-5 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-3">
          <KpiCard
            icon={<Activity className="h-4 w-4" />}
            label="Operations"
            value={data.operationCount}
            sub={`${data.runningCount} running`}
            tint="text-argo-accent"
          />
          <KpiCard
            icon={<Zap className="h-4 w-4" />}
            label="Submissions Today"
            value={data.totalSubmissionsToday}
            sub={`${data.totalPendingApprovals} pending`}
            tint="text-argo-green"
          />
          <KpiCard
            icon={<DollarSign className="h-4 w-4" />}
            label="LLM Cost (30d)"
            value={`$${data.llm.totalCostUsd}`}
            sub={`${data.llm.totalInvocations} calls`}
            tint="text-argo-amber"
          />
          <KpiCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Approval Rate"
            value={`${data.approvals.approvalRate}%`}
            sub={`${data.approvals.total} total`}
            tint="text-argo-accent"
          />
        </div>

        {/* Timeline Charts */}
        <div className="grid grid-cols-2 gap-4">
          <ChartCard title="Submissions (30d)" data={data.submissionsTimeline} color="bg-argo-accent" />
          <ChartCard title="Errors (30d)" data={data.errorsTimeline} color="bg-argo-red" />
        </div>

        {/* LLM Stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Avg Response Time" value={`${data.llm.avgDurationMs}ms`} icon={<Clock className="h-3.5 w-3.5" />} />
          <StatCard label="Success Rate" value={`${data.llm.successRate}%`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
          <StatCard label="Total Tokens" value={formatNum(data.llm.totalPromptTokens + data.llm.totalCompletionTokens)} icon={<Bot className="h-3.5 w-3.5" />} />
        </div>

        {/* Repairs */}
        <div className="border border-argo-border rounded-xl p-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary mb-3">
            Self-Healing Repairs
          </h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-2xl font-semibold text-argo-text">{data.repairs.total}</div>
              <div className="text-[10px] text-argo-textSecondary">Total</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-argo-amber">{data.repairs.awaiting}</div>
              <div className="text-[10px] text-argo-textSecondary">Awaiting</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-argo-green">{data.repairs.deployed}</div>
              <div className="text-[10px] text-argo-textSecondary">Deployed</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-argo-red">{data.repairs.rejected}</div>
              <div className="text-[10px] text-argo-textSecondary">Rejected</div>
            </div>
          </div>
        </div>

        {/* Top Operations */}
        {data.topOperations.length > 0 && (
          <div className="border border-argo-border rounded-xl p-4">
            <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary mb-3">
              Top Operations
            </h3>
            <div className="space-y-2">
              {data.topOperations.map((op, i) => (
                <div key={op.operationId} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-argo-textSecondary w-5 text-right">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-argo-text truncate">{op.operationName}</div>
                    <div className="h-1.5 mt-1 rounded-full bg-argo-border overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-argo-accent"
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(100, (op.totalSubmissions / Math.max(1, data.topOperations[0]?.totalSubmissions ?? 1)) * 100)}%`,
                        }}
                        transition={{ duration: 0.6, delay: i * 0.1 }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-mono text-argo-textSecondary">
                    {op.totalSubmissions}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  tint: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-argo-border rounded-xl p-3"
    >
      <div className={cn('mb-2', tint)}>{icon}</div>
      <div className="text-2xl font-semibold text-argo-text tracking-tight">{value}</div>
      <div className="text-[10px] text-argo-textSecondary mt-0.5">{label}</div>
      <div className="text-[10px] text-argo-textSecondary">{sub}</div>
    </motion.div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="border border-argo-border rounded-xl p-3 flex items-center gap-3">
      <div className="text-argo-accent">{icon}</div>
      <div>
        <div className="text-sm font-semibold text-argo-text">{value}</div>
        <div className="text-[10px] text-argo-textSecondary">{label}</div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  data,
  color,
}: {
  title: string;
  data: Array<{ date: string; count: number }>;
  color: string;
}) {
  const maxVal = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data]);

  return (
    <div className="border border-argo-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">
          {title}
        </h3>
        <div className="flex items-center gap-1 text-argo-text">
          <TrendingUp className="h-3.5 w-3.5" />
          <span className="text-xs font-mono">
            {data.reduce((a, d) => a + d.count, 0)}
          </span>
        </div>
      </div>
      <div className="flex items-end gap-[2px] h-16">
        {data.length === 0 ? (
          <div className="w-full text-center text-[10px] text-argo-textSecondary py-4">
            No data yet
          </div>
        ) : (
          data.map((d, i) => (
            <motion.div
              key={d.date}
              className={cn('flex-1 rounded-t-sm', color)}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(4, (d.count / maxVal) * 100)}%` }}
              transition={{ duration: 0.4, delay: i * 0.02 }}
              title={`${d.date}: ${d.count}`}
            />
          ))
        )}
      </div>
      {data.length > 0 && (
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-argo-textSecondary font-mono">
            {data[0]?.date.slice(5)}
          </span>
          <span className="text-[9px] text-argo-textSecondary font-mono">
            {data[data.length - 1]?.date.slice(5)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
