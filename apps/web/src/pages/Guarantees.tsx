// Argo Guarantees — the 7 non-negotiable promises.
// Dark canvas, electric-cyan accents, glass-morphism cards, scroll-linked reveals.

import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useInView,
  useScroll,
  useTransform,
} from 'framer-motion';
import {
  ArrowRight,
  Check,
  DollarSign,
  Download,
  Eye,
  History,
  Shield,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useArgo } from '../state/store.js';
import { LiquidButton } from '../components/ui/liquid-glass-button.js';
import { cn } from '../lib/utils.js';

// ──────────────────────────────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────────────────────────────

const GUARANTEES = [
  {
    id: 1,
    icon: Shield,
    title: 'We never charge you for our mistakes',
    points: [
      'Platform crashes, AI loops, environment errors = zero cost to you',
      'Auto-refund on every failed invocation caused by our infrastructure',
      'Loop detection: if the AI tries the same fix 3x, we stop and refund ALL loop costs',
    ],
    competitors:
      'Replit, Lovable, Bolt, Emergent all charge credits during their own platform failures. Users report spending $200+ debugging vendor bugs.',
    gradient: 'from-cyan-400/30 via-cyan-500/10 to-transparent',
    border: 'border-cyan-400/20',
    glow: 'shadow-cyan-500/10',
  },
  {
    id: 2,
    icon: Eye,
    title: 'No code changes without your approval',
    points: [
      'Every change is shown as a visual diff BEFORE it\u2019s applied',
      'Schema changes, auth changes, and routing changes require explicit "Apply" click',
      'Audit mode: AI can propose but never auto-apply risky changes',
    ],
    competitors:
      'Bolt agents delete entire codebases. Replit agents modify files without asking. Lovable AI rewrites stable functions when you ask for minor edits.',
    gradient: 'from-violet-400/30 via-violet-500/10 to-transparent',
    border: 'border-violet-400/20',
    glow: 'shadow-violet-500/10',
  },
  {
    id: 3,
    icon: History,
    title: 'Your code never disappears',
    points: [
      'Full version history \u2014 every bundle version saved forever',
      'One-click rollback to ANY prior state',
      'Nothing is ever permanently deleted',
    ],
    competitors:
      'Bolt users report apps vanishing near deployment. Replit had a publicized case of AI deleting a production database.',
    gradient: 'from-emerald-400/30 via-emerald-500/10 to-transparent',
    border: 'border-emerald-400/20',
    glow: 'shadow-emerald-500/10',
  },
  {
    id: 4,
    icon: ShieldCheck,
    title: '49 checks before every deploy',
    points: [
      '49 quality checks + 15 security scans + auto-generated regression tests',
      'If ANY check fails, the deploy is blocked \u2014 no exceptions',
      'Iterate without regression: baseline tests run before every change',
    ],
    competitors:
      'No competitor runs quality gates. No competitor runs security scans. No competitor runs regression tests.',
    gradient: 'from-amber-400/30 via-amber-500/10 to-transparent',
    border: 'border-amber-400/20',
    glow: 'shadow-amber-500/10',
  },
  {
    id: 5,
    icon: Download,
    title: 'You own your code \u2014 zero lock-in',
    points: [
      'One-click download as ZIP',
      'One-click push to GitHub',
      'Standard Node.js/React \u2014 runs anywhere',
    ],
    competitors:
      'Lovable is React-only with limited export. Bolt and Emergent generate opaque, hard-to-maintain code.',
    gradient: 'from-rose-400/30 via-rose-500/10 to-transparent',
    border: 'border-rose-400/20',
    glow: 'shadow-rose-500/10',
  },
  {
    id: 6,
    icon: DollarSign,
    title: 'Transparent pricing \u2014 see every cent',
    points: [
      'Per-model token breakdown: see exactly which model cost what',
      'Per-operation cost tracking',
      'Projected monthly cost updated daily',
      'No opaque "credits" \u2014 real dollars, real costs',
    ],
    competitors:
      'Bolt\u2019s token policies feel "scammy." Emergent users get "price shock." Replit\u2019s effort-based billing is unpredictable.',
    gradient: 'from-teal-400/30 via-teal-500/10 to-transparent',
    border: 'border-teal-400/20',
    glow: 'shadow-teal-500/10',
  },
  {
    id: 7,
    icon: Users,
    title: 'Human support for serious problems',
    points: [
      'Platform bugs \u2192 real engineers, not more AI',
      'Data incidents \u2192 human investigation',
      'Architecture reviews available on premium plans',
      'You never pay credits to troubleshoot our bugs',
    ],
    competitors:
      'All four competitors offer AI-only support. Users report spending hundreds of dollars in credits trying to debug platform-caused issues.',
    gradient: 'from-fuchsia-400/30 via-fuchsia-500/10 to-transparent',
    border: 'border-fuchsia-400/20',
    glow: 'shadow-fuchsia-500/10',
  },
] as const;

const COMPARISON_FEATURES = [
  'Never charges for platform failures',
  'Visual diff before every change',
  'Full version history + rollback',
  '49 quality checks + security scans',
  'Zero lock-in \u2014 export anytime',
  'Transparent per-token pricing',
  'Human support for platform bugs',
] as const;

type CompetitorKey = 'argo' | 'replit' | 'lovable' | 'bolt' | 'emergent';
const COMPETITORS: { key: CompetitorKey; label: string }[] = [
  { key: 'argo', label: 'Argo' },
  { key: 'replit', label: 'Replit' },
  { key: 'lovable', label: 'Lovable' },
  { key: 'bolt', label: 'Bolt' },
  { key: 'emergent', label: 'Emergent' },
];

const COMPARISON_DATA: Record<CompetitorKey, boolean[]> = {
  argo: [true, true, true, true, true, true, true],
  replit: [false, false, false, false, false, false, false],
  lovable: [false, false, false, false, false, false, false],
  bolt: [false, false, false, false, false, false, false],
  emergent: [false, false, false, false, false, false, false],
};

// ──────────────────────────────────────────────────────────────────────
// Animated counter hook
// ──────────────────────────────────────────────────────────────────────

function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      className="tabular-nums"
    >
      {inView ? (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <CountUp target={value} />
          {suffix}
        </motion.span>
      ) : (
        <>0{suffix}</>
      )}
    </motion.span>
  );
}

function CountUp({ target }: { target: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 1400;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <span ref={ref}>{count}</span>;
}

// ──────────────────────────────────────────────────────────────────────
// Guarantee card
// ──────────────────────────────────────────────────────────────────────

function GuaranteeCard({
  guarantee,
  index,
}: {
  guarantee: (typeof GUARANTEES)[number];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const Icon = guarantee.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 60, scale: 0.97 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{
        duration: 0.7,
        delay: index * 0.08,
        ease: [0.21, 1.04, 0.58, 1],
      }}
      className="group relative"
    >
      {/* Outer glow */}
      <div
        className={cn(
          'absolute -inset-px rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm',
          guarantee.gradient,
        )}
      />

      {/* Card */}
      <div
        className={cn(
          'relative rounded-2xl border backdrop-blur-xl bg-white/[0.03] p-8 md:p-10 transition-all duration-500',
          'hover:bg-white/[0.06] hover:shadow-2xl',
          guarantee.border,
          guarantee.glow,
        )}
      >
        {/* Number badge */}
        <div className="absolute -top-4 -left-2 md:-left-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-argo-accent text-argo-bg text-sm font-bold shadow-lg shadow-argo-accent/30">
            {guarantee.id}
          </div>
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          {/* Left column */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-argo-accent/10 border border-argo-accent/20">
                <Icon className="h-6 w-6 text-argo-accent" />
              </div>
              <h3 className="text-xl md:text-2xl font-semibold text-argo-text leading-tight">
                &ldquo;{guarantee.title}&rdquo;
              </h3>
            </div>

            <ul className="space-y-3">
              {guarantee.points.map((point, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: index * 0.08 + i * 0.1 + 0.3, duration: 0.4 }}
                  className="flex items-start gap-3 text-argo-textSecondary text-sm md:text-base leading-relaxed"
                >
                  <Check className="h-4 w-4 mt-1 shrink-0 text-argo-accent" />
                  <span>{point}</span>
                </motion.li>
              ))}
            </ul>
          </div>

          {/* Right column — competitor comparison */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: index * 0.08 + 0.5, duration: 0.5 }}
            className="md:w-[340px] shrink-0"
          >
            <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-3">
                <X className="h-4 w-4 text-red-400" />
                <span className="text-xs font-medium uppercase tracking-wider text-red-400">
                  What competitors do
                </span>
              </div>
              <p className="text-sm text-red-300/80 leading-relaxed">
                {guarantee.competitors}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Comparison table
// ──────────────────────────────────────────────────────────────────────

function ComparisonTable() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.21, 1.04, 0.58, 1] }}
      className="relative rounded-2xl border border-argo-border backdrop-blur-xl bg-white/[0.02] overflow-hidden"
    >
      {/* Header glow */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-argo-accent/50 to-transparent" />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-argo-border">
              <th className="text-left p-4 md:p-5 text-sm font-medium text-argo-textSecondary w-[40%]">
                Guarantee
              </th>
              {COMPETITORS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'p-4 md:p-5 text-sm font-medium text-center min-w-[100px]',
                    c.key === 'argo' ? 'text-argo-accent' : 'text-argo-textSecondary',
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_FEATURES.map((feature, rowIdx) => (
              <motion.tr
                key={feature}
                initial={{ opacity: 0, x: -20 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: rowIdx * 0.06 + 0.2, duration: 0.4 }}
                className="border-b border-argo-border/50 last:border-b-0 hover:bg-white/[0.02] transition-colors"
              >
                <td className="p-4 md:p-5 text-sm text-argo-text">{feature}</td>
                {COMPETITORS.map((c) => {
                  const val = COMPARISON_DATA[c.key][rowIdx];
                  return (
                    <td key={c.key} className="p-4 md:p-5 text-center">
                      {val ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={inView ? { scale: 1 } : {}}
                          transition={{
                            delay: rowIdx * 0.06 + 0.4,
                            type: 'spring',
                            stiffness: 400,
                            damping: 15,
                          }}
                          className="inline-flex"
                        >
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-argo-accent/20">
                            <Check className="h-4 w-4 text-argo-accent" />
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={inView ? { scale: 1 } : {}}
                          transition={{
                            delay: rowIdx * 0.06 + 0.4,
                            type: 'spring',
                            stiffness: 400,
                            damping: 15,
                          }}
                          className="inline-flex"
                        >
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/10">
                            <X className="h-4 w-4 text-red-400/60" />
                          </div>
                        </motion.div>
                      )}
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Argo column highlight */}
      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: '40%', width: 'calc(60% / 5)' }}>
        <div className="w-full h-full bg-argo-accent/[0.03] border-x border-argo-accent/10" />
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stats bar
// ──────────────────────────────────────────────────────────────────────

function StatsBar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });

  const stats = [
    { value: 49, suffix: '', label: 'Quality checks' },
    { value: 15, suffix: '', label: 'Security scans' },
    { value: 100, suffix: '%', label: 'Refund on loops' },
    { value: 0, suffix: '', label: 'Lock-in' },
  ];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6"
    >
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: i * 0.1 + 0.2, duration: 0.5 }}
          className="relative rounded-xl border border-argo-border backdrop-blur-xl bg-white/[0.03] p-6 text-center group hover:border-argo-accent/30 transition-colors duration-300"
        >
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-argo-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <div className="text-3xl md:text-4xl font-bold text-argo-text mb-1">
              {stat.value === 0 ? (
                <span className="text-argo-accent">ZERO</span>
              ) : (
                <AnimatedCounter value={stat.value} suffix={stat.suffix} />
              )}
            </div>
            <div className="text-sm text-argo-textSecondary">{stat.label}</div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────

export function Guarantees() {
  const { setView } = useArgo();
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroInView = useInView(heroRef, { once: true });
  const { scrollYProgress } = useScroll({ target: containerRef });
  const progressWidth = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  return (
    <div ref={containerRef} className="min-h-screen bg-argo-bg text-argo-text antialiased overflow-x-hidden">
      {/* Scroll progress bar */}
      <motion.div
        style={{ width: progressWidth }}
        className="fixed top-0 left-0 h-[2px] bg-argo-accent origin-left z-50"
      />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-argo-bg/70 border-b border-argo-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <button
            onClick={() => setView('landing')}
            className="text-argo-text font-semibold text-lg hover:text-argo-accent transition-colors"
          >
            Argo
          </button>
          <div className="flex items-center gap-4">
            <a href="#guarantees" className="text-argo-textSecondary hover:text-argo-text transition-colors text-sm hidden md:inline">
              Guarantees
            </a>
            <a href="#comparison" className="text-argo-textSecondary hover:text-argo-text transition-colors text-sm hidden md:inline">
              Comparison
            </a>
            <LiquidButton
              variant="outline"
              size="sm"
              onClick={() => setView('workspace')}
            >
              Start building
              <ArrowRight className="h-3.5 w-3.5" />
            </LiquidButton>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section ref={heroRef} className="relative min-h-[85vh] flex items-center justify-center pt-14 overflow-hidden">
        {/* Background orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/3 h-[600px] w-[800px] rounded-full bg-argo-accent/15 blur-[160px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 h-[500px] w-[700px] rounded-full bg-violet-500/10 blur-[140px]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[400px] rounded-full bg-cyan-400/5 blur-[100px]" />
        </div>

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="mb-8"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-argo-border bg-argo-surface/60 px-4 py-1.5 text-xs text-argo-textSecondary backdrop-blur-sm">
              <Shield className="h-3.5 w-3.5 text-argo-accent" />
              Enforceable commitments, not marketing copy
            </span>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl sm:text-6xl md:text-8xl font-bold text-argo-text mb-6 leading-[0.95] tracking-tight"
          >
            Seven promises.
            <br />
            <span className="bg-gradient-to-r from-argo-accent via-cyan-300 to-argo-accent bg-clip-text text-transparent">
              Zero exceptions.
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="text-lg sm:text-xl text-argo-textSecondary max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Every AI app builder makes claims. Argo makes{' '}
            <span className="text-argo-text font-medium">guarantees</span>.
          </motion.p>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <LiquidButton
              size="xl"
              className="bg-argo-accent text-argo-bg font-medium rounded-full px-8 py-3 inline-flex items-center gap-2 hover:shadow-lg hover:shadow-argo-accent/25 transition-shadow"
              onClick={() => setView('workspace')}
            >
              Start building with guarantees
              <ArrowRight className="h-4 w-4" />
            </LiquidButton>
          </motion.div>

          {/* Scroll indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={heroInView ? { opacity: 1 } : {}}
            transition={{ delay: 1.2, duration: 0.8 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="flex flex-col items-center gap-2"
            >
              <span className="text-xs text-argo-textSecondary">Scroll to read</span>
              <div className="w-px h-8 bg-gradient-to-b from-argo-accent/60 to-transparent" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="relative py-16 md:py-20">
        <div className="max-w-5xl mx-auto px-6">
          <StatsBar />
        </div>
      </section>

      {/* ── Guarantee cards ── */}
      <section id="guarantees" className="relative py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-6">
          {/* Section header */}
          <div className="text-center mb-16 md:mb-20">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6 }}
              className="text-3xl md:text-5xl font-bold text-argo-text mb-4"
            >
              The 7 guarantees
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-argo-textSecondary text-base md:text-lg max-w-xl mx-auto"
            >
              Each one exists because a real user got burned by a competitor.
              We wrote them down so we can never pretend they don&apos;t matter.
            </motion.p>
          </div>

          {/* Cards */}
          <div className="space-y-8 md:space-y-10">
            {GUARANTEES.map((g, i) => (
              <GuaranteeCard key={g.id} guarantee={g} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison table ── */}
      <section id="comparison" className="relative py-16 md:py-24">
        {/* Separator glow */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-argo-accent/30 to-transparent" />

        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12 md:mb-16">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.6 }}
              className="text-3xl md:text-5xl font-bold text-argo-text mb-4"
            >
              Argo vs. everyone else
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-argo-textSecondary text-base md:text-lg max-w-xl mx-auto"
            >
              Seven guarantees. One platform offers all of them.
              The other four offer none.
            </motion.p>
          </div>

          <ComparisonTable />

          {/* Summary line */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-8 text-center"
          >
            <p className="text-sm text-argo-textSecondary">
              Argo: <span className="text-argo-accent font-semibold">7/7</span>{' '}
              &middot; Replit: <span className="text-red-400 font-semibold">0/7</span>{' '}
              &middot; Lovable: <span className="text-red-400 font-semibold">0/7</span>{' '}
              &middot; Bolt: <span className="text-red-400 font-semibold">0/7</span>{' '}
              &middot; Emergent: <span className="text-red-400 font-semibold">0/7</span>
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="relative py-24 md:py-32">
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-argo-accent/30 to-transparent" />

        {/* CTA glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[700px] rounded-full bg-argo-accent/10 blur-[160px]" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7 }}
          >
            <h2 className="text-3xl md:text-5xl font-bold text-argo-text mb-4">
              Build with a platform that
              <br />
              <span className="bg-gradient-to-r from-argo-accent via-cyan-300 to-argo-accent bg-clip-text text-transparent">
                stands behind its work
              </span>
            </h2>
            <p className="text-argo-textSecondary text-base md:text-lg mb-10 max-w-lg mx-auto">
              No other AI app builder will put these seven commitments in writing.
              We do, because we built the infrastructure to enforce them.
            </p>
            <LiquidButton
              size="xxl"
              className="bg-argo-accent text-argo-bg font-medium rounded-full px-10 py-4 inline-flex items-center gap-2 hover:shadow-xl hover:shadow-argo-accent/30 transition-shadow text-base"
              onClick={() => setView('workspace')}
            >
              Start building with guarantees
              <ArrowRight className="h-5 w-5" />
            </LiquidButton>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-argo-border py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-argo-textSecondary">
            &copy; {new Date().getFullYear()} Argo. All guarantees enforceable from day one.
          </p>
          <div className="flex items-center gap-6">
            <button
              onClick={() => setView('landing')}
              className="text-xs text-argo-textSecondary hover:text-argo-text transition-colors"
            >
              Home
            </button>
            <button
              onClick={() => setView('workspace')}
              className="text-xs text-argo-textSecondary hover:text-argo-text transition-colors"
            >
              Workspace
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
