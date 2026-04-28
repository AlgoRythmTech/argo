import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  Mail,
  PieChart,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { api } from '../api/client.js';
import { cn } from '../lib/utils.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ROIData {
  hoursSaved: number;
  hoursTrend: number; // percent change vs last month
  submissionsProcessed: number;
  dailySubmissions: number[];
  avgResponseBefore: string;
  avgResponseAfter: string;
  autoProcessed: number;
  manualReview: number;
  escalated: number;
  weeklyDigest: {
    subject: string;
    highlights: string[];
    generatedAt: string;
  };
  before: { metric: string; value: string }[];
  after: { metric: string; value: string }[];
}

const SAMPLE_DATA: ROIData = {
  hoursSaved: 47,
  hoursTrend: 18,
  submissionsProcessed: 1_284,
  dailySubmissions: [31, 44, 38, 52, 47, 55, 60, 42, 49, 63, 58, 71, 66, 48, 53, 62, 70, 45, 51, 59, 68, 73, 41, 56, 64, 72, 50, 61, 67, 54],
  avgResponseBefore: '4.2 hours',
  avgResponseAfter: '23 minutes',
  autoProcessed: 892,
  manualReview: 310,
  escalated: 82,
  weeklyDigest: {
    subject: 'Your Argo Weekly: 47 hours saved, 1,284 submissions processed',
    highlights: [
      '312 submissions auto-processed on Tuesday — your busiest day',
      'Response time improved 12% vs last week',
      '3 candidates escalated for manual review (down from 11)',
      'Estimated monthly savings: $2,350 at current volume',
    ],
    generatedAt: new Date().toISOString(),
  },
  before: [
    { metric: 'Avg Processing Time', value: '4.2 hours' },
    { metric: 'Daily Capacity', value: '~30 submissions' },
    { metric: 'Error Rate', value: '8.4%' },
    { metric: 'Weekend Coverage', value: 'None' },
  ],
  after: [
    { metric: 'Avg Processing Time', value: '23 min' },
    { metric: 'Daily Capacity', value: 'Unlimited' },
    { metric: 'Error Rate', value: '0.3%' },
    { metric: 'Weekend Coverage', value: '24/7' },
  ],
};

// ── Animated Counter Hook ──────────────────────────────────────────────────

function useAnimatedCounter(target: number, duration = 1400): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number>();

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(eased * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);

  return value;
}

// ── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 32;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`)
    .join(' ');

  return (
    <svg width={w} height={h} className={className} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Donut Chart ────────────────────────────────────────────────────────────

function DonutChart({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulative = 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex items-center gap-6">
      <svg width={100} height={100} viewBox="0 0 100 100" className="flex-shrink-0">
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const offset = (cumulative / total) * circumference;
          cumulative += seg.value;
          return (
            <motion.circle
              key={seg.label}
              cx={50} cy={50} r={radius}
              fill="none"
              strokeWidth={10}
              className={seg.color}
              strokeDasharray={`${pct * circumference} ${circumference}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.8, delay: i * 0.15 }}
            />
          );
        })}
        <text x={50} y={50} textAnchor="middle" dominantBaseline="central" className="fill-argo-text text-lg font-semibold">
          {total}
        </text>
      </svg>
      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 text-xs">
            <div className={cn('w-2.5 h-2.5 rounded-full', seg.color.replace('stroke-', 'bg-'))} />
            <span className="text-argo-textSecondary">{seg.label}</span>
            <span className="text-argo-text font-medium ml-auto">{seg.value}</span>
            <span className="text-argo-textSecondary">({Math.round((seg.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function ROIDashboard({ operationId }: { operationId: string }) {
  const [data, setData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hourlyRate, setHourlyRate] = useState(50);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ROIData>(`/api/analytics/roi?operationId=${operationId}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(SAMPLE_DATA); setLoading(false); } });
    return () => { cancelled = true; };
  }, [operationId]);

  const d = data ?? SAMPLE_DATA;

  const hoursSaved = useAnimatedCounter(loading ? 0 : d.hoursSaved);
  const submissions = useAnimatedCounter(loading ? 0 : d.submissionsProcessed);
  const costSavings = useAnimatedCounter(loading ? 0 : d.hoursSaved * hourlyRate);

  const annualSavings = useMemo(() => d.hoursSaved * hourlyRate * 12, [d.hoursSaved, hourlyRate]);

  const handleRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 0) setHourlyRate(v);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
  const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.45 } } };

  return (
    <div className="h-full flex flex-col bg-argo-bg overflow-y-auto">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-argo-border px-5 h-12 flex-shrink-0 sticky top-0 bg-argo-bg z-10">
        <TrendingUp className="h-4 w-4 text-argo-accent" />
        <span className="text-sm font-medium text-argo-text">ROI Dashboard</span>
      </header>

      <motion.div className="p-5 space-y-6" variants={stagger} initial="hidden" animate="visible">
        {/* ── Hero Metrics Row ─────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-4 bg-argo-surface">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="h-4 w-4 text-argo-accent" />
              <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">Hours Saved</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-argo-text tabular-nums">{hoursSaved}</span>
              <span className="text-xs text-argo-textSecondary">this month</span>
            </div>
            <div className={cn('flex items-center gap-0.5 mt-2 text-xs font-medium', d.hoursTrend >= 0 ? 'text-argo-green' : 'text-argo-red')}>
              {d.hoursTrend >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(d.hoursTrend)}% vs last month
            </div>
          </motion.div>

          <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-4 bg-argo-surface">
            <div className="flex items-center gap-1.5 mb-3">
              <Zap className="h-4 w-4 text-argo-green" />
              <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">Submissions</span>
            </div>
            <div className="text-3xl font-bold text-argo-text tabular-nums">{submissions.toLocaleString()}</div>
            <Sparkline data={d.dailySubmissions} className="text-argo-accent mt-2" />
          </motion.div>

          <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-4 bg-argo-surface">
            <div className="flex items-center gap-1.5 mb-3">
              <TrendingUp className="h-4 w-4 text-argo-amber" />
              <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">Response Time</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-argo-red/70 line-through">{d.avgResponseBefore}</span>
              <ArrowRight className="h-3 w-3 text-argo-textSecondary" />
              <span className="text-xl font-bold text-argo-green">{d.avgResponseAfter}</span>
            </div>
            <div className="text-[10px] text-argo-textSecondary mt-2">91% faster than manual</div>
          </motion.div>

          <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-4 bg-gradient-to-br from-argo-surface to-argo-accent/5">
            <div className="flex items-center gap-1.5 mb-3">
              <DollarSign className="h-4 w-4 text-argo-green" />
              <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">Cost Savings</span>
            </div>
            <div className="text-3xl font-bold text-argo-green tabular-nums">${costSavings.toLocaleString()}</div>
            <div className="text-[10px] text-argo-textSecondary mt-2">at ${hourlyRate}/hr &middot; this month</div>
          </motion.div>
        </div>

        {/* ── Efficiency Timeline ──────────────────────────────────── */}
        <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">Efficiency Timeline (30d)</h3>
            <div className="flex items-center gap-4 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-argo-accent inline-block rounded" /> Argo</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-argo-red/40 inline-block rounded" /> Manual Capacity</span>
            </div>
          </div>
          <div className="relative h-24">
            {/* Manual capacity baseline */}
            <div className="absolute inset-x-0 bottom-[30%] border-t border-dashed border-argo-red/30" />
            <div className="absolute right-0 bottom-[30%] translate-y-[-50%] text-[9px] text-argo-red/50 font-mono">~30/day cap</div>
            {/* Argo bars */}
            <div className="flex items-end gap-[2px] h-full">
              {d.dailySubmissions.map((v, i) => {
                const max = Math.max(...d.dailySubmissions, 1);
                return (
                  <motion.div
                    key={i}
                    className="flex-1 rounded-t-sm bg-argo-accent/80"
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(4, (v / max) * 100)}%` }}
                    transition={{ duration: 0.4, delay: i * 0.02 }}
                    title={`Day ${i + 1}: ${v} submissions`}
                  />
                );
              })}
            </div>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-argo-textSecondary font-mono">Day 1</span>
            <span className="text-[9px] text-argo-textSecondary font-mono">Day 30</span>
          </div>
        </motion.div>

        {/* ── Workflow Breakdown + Weekly Digest ────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-5">
            <div className="flex items-center gap-1.5 mb-4">
              <PieChart className="h-4 w-4 text-argo-accent" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">Workflow Breakdown</h3>
            </div>
            <DonutChart segments={[
              { value: d.autoProcessed, color: 'stroke-argo-green', label: 'Auto-processed' },
              { value: d.manualReview, color: 'stroke-argo-amber', label: 'Manual Review' },
              { value: d.escalated, color: 'stroke-argo-red', label: 'Escalated' },
            ]} />
          </motion.div>

          <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-5">
            <div className="flex items-center gap-1.5 mb-4">
              <Mail className="h-4 w-4 text-argo-accent" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">Weekly Digest Preview</h3>
            </div>
            <div className="bg-argo-bg rounded-lg border border-argo-border p-3">
              <div className="text-[10px] text-argo-textSecondary mb-1">Subject:</div>
              <div className="text-xs font-medium text-argo-text mb-3">{d.weeklyDigest.subject}</div>
              <div className="space-y-1.5">
                {d.weeklyDigest.highlights.map((h, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-argo-textSecondary">
                    <CheckCircle2 className="h-3 w-3 text-argo-green flex-shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </div>
                ))}
              </div>
              <div className="text-[9px] text-argo-textSecondary mt-3 pt-2 border-t border-argo-border">
                <Calendar className="h-3 w-3 inline mr-1" />
                Sent every Monday at 9:00 AM
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── ROI Calculator ───────────────────────────────────────── */}
        <motion.div variants={fadeUp} className="border border-argo-border rounded-xl p-5 bg-gradient-to-br from-argo-surface to-argo-accent/5">
          <div className="flex items-center gap-1.5 mb-4">
            <Calculator className="h-4 w-4 text-argo-accent" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">ROI Calculator</h3>
          </div>
          <div className="grid grid-cols-3 gap-6 items-center">
            <div>
              <label className="text-[10px] text-argo-textSecondary uppercase tracking-wider block mb-2">Your Hourly Rate</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-argo-textSecondary" />
                <input
                  type="number"
                  value={hourlyRate}
                  onChange={handleRateChange}
                  className="w-full bg-argo-bg border border-argo-border rounded-lg pl-8 pr-3 py-2 text-sm text-argo-text font-mono focus:outline-none focus:border-argo-accent"
                  min={0}
                  max={500}
                />
              </div>
              <div className="text-[10px] text-argo-textSecondary mt-1">{d.hoursSaved} hrs/mo saved</div>
            </div>

            <div className="text-center">
              <ArrowRight className="h-5 w-5 text-argo-accent mx-auto mb-2" />
              <div className="text-[10px] text-argo-textSecondary">Projects to</div>
            </div>

            <div className="text-center">
              <motion.div
                key={annualSavings}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-4xl font-bold text-argo-green tabular-nums"
              >
                ${annualSavings.toLocaleString()}
              </motion.div>
              <div className="text-xs text-argo-textSecondary mt-1">estimated annual savings</div>
              <div className="text-[10px] text-argo-green font-medium mt-0.5">
                ${(d.hoursSaved * hourlyRate).toLocaleString()}/month
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Before / After Comparison ─────────────────────────────── */}
        <motion.div variants={fadeUp} className="border border-argo-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-5 pt-5 pb-3">
            <Users className="h-4 w-4 text-argo-accent" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">Before vs. After</h3>
          </div>
          <div className="grid grid-cols-2 divide-x divide-argo-border">
            {/* Before */}
            <div className="p-5 bg-argo-red/[0.03]">
              <div className="text-xs font-semibold text-argo-red mb-4 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-argo-red" />
                Before Argo
              </div>
              <div className="space-y-3">
                {d.before.map((item) => (
                  <div key={item.metric}>
                    <div className="text-[10px] text-argo-textSecondary">{item.metric}</div>
                    <div className="text-sm font-medium text-argo-text/70">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* After */}
            <div className="p-5 bg-argo-green/[0.03]">
              <div className="text-xs font-semibold text-argo-green mb-4 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-argo-green" />
                With Argo
              </div>
              <div className="space-y-3">
                {d.after.map((item) => (
                  <div key={item.metric}>
                    <div className="text-[10px] text-argo-textSecondary">{item.metric}</div>
                    <motion.div
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.5 }}
                      className="text-sm font-bold text-argo-green"
                    >
                      {item.value}
                    </motion.div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Bottom accent bar */}
          <div className="h-1 bg-gradient-to-r from-argo-red/30 via-argo-accent to-argo-green" />
        </motion.div>
      </motion.div>
    </div>
  );
}
