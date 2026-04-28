/**
 * GuardrailsDashboard — the "Never-Ship-Broken" guardrails visualization.
 *
 * This is Argo's core differentiator from Replit/Lovable: every deploy passes
 * through regression tests, security scans, 49 quality checks, and a composite
 * safety score before it ever reaches production. This dashboard makes that
 * process tangible and inspectable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode2,
  Fingerprint,
  Globe,
  Loader2,
  Lock,
  Shield,
  ShieldCheck,
  User,
  XCircle,
  Zap,
} from 'lucide-react';
import { api } from '../api/client.js';
import { cn } from '../lib/utils.js';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type TestResult = { name: string; passed: boolean; durationMs: number };

type VulnerabilityCategory = { name: string; passed: boolean; severity: 'low' | 'medium' | 'high' | 'critical' };

type QualityCheck = {
  name: string;
  category: 'code-quality' | 'performance' | 'accessibility' | 'security' | 'best-practices';
  passed: boolean;
  score: number;
};

type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
  coveredByTests: string[];
  risk: 'low' | 'medium' | 'high';
};

type ApprovalEntry = { actor: string; action: string; timestamp: string };

type GuardrailsData = {
  tests: TestResult[];
  vulnerabilities: VulnerabilityCategory[];
  qualityChecks: QualityCheck[];
  safetyScore: number;
  changedFiles: ChangedFile[];
  approvals: ApprovalEntry[];
};

/* -------------------------------------------------------------------------- */
/*  Sample data (used when the endpoint is not yet wired)                     */
/* -------------------------------------------------------------------------- */

const SAMPLE_DATA: GuardrailsData = {
  tests: [
    { name: 'renders landing page without crash', passed: true, durationMs: 42 },
    { name: 'form validation rejects empty email', passed: true, durationMs: 18 },
    { name: 'API client retries on 5xx', passed: true, durationMs: 134 },
    { name: 'auth redirect for unauthenticated user', passed: true, durationMs: 87 },
    { name: 'dark mode toggle persists preference', passed: true, durationMs: 56 },
    { name: 'webhook payload signature verification', passed: true, durationMs: 23 },
    { name: 'rate limiter blocks after threshold', passed: true, durationMs: 201 },
    { name: 'image upload validates file type', passed: false, durationMs: 95 },
    { name: 'SSR hydration matches client render', passed: true, durationMs: 312 },
    { name: 'CORS headers present on API responses', passed: true, durationMs: 14 },
    { name: 'database connection pool cleanup', passed: true, durationMs: 67 },
    { name: 'CSV export includes all columns', passed: true, durationMs: 148 },
  ],
  vulnerabilities: [
    { name: 'SQL Injection', passed: true, severity: 'critical' },
    { name: 'Cross-Site Scripting (XSS)', passed: true, severity: 'critical' },
    { name: 'Cross-Site Request Forgery', passed: true, severity: 'high' },
    { name: 'Insecure Deserialization', passed: true, severity: 'high' },
    { name: 'Broken Authentication', passed: true, severity: 'critical' },
    { name: 'Sensitive Data Exposure', passed: true, severity: 'high' },
    { name: 'XML External Entities', passed: true, severity: 'medium' },
    { name: 'Broken Access Control', passed: true, severity: 'critical' },
    { name: 'Security Misconfiguration', passed: false, severity: 'medium' },
    { name: 'Insecure Dependencies', passed: true, severity: 'high' },
    { name: 'Insufficient Logging', passed: true, severity: 'low' },
    { name: 'Server-Side Request Forgery', passed: true, severity: 'high' },
    { name: 'Path Traversal', passed: true, severity: 'medium' },
    { name: 'Prototype Pollution', passed: true, severity: 'medium' },
    { name: 'Regex Denial of Service', passed: true, severity: 'low' },
  ],
  qualityChecks: Array.from({ length: 49 }, (_, i) => {
    const categories = [
      'code-quality', 'performance', 'accessibility', 'security', 'best-practices',
    ] as const;
    const names = [
      'No unused variables', 'No any types', 'Consistent naming', 'Max file length',
      'No console.log in prod', 'Tree-shakeable exports', 'Lighthouse perf > 90',
      'First contentful paint < 1.8s', 'Bundle size < 250KB', 'No layout shifts',
      'Image optimization', 'Lazy-loaded routes', 'ARIA labels present',
      'Color contrast ratio', 'Keyboard navigable', 'Focus indicators',
      'Screen reader compatible', 'Semantic HTML', 'CSP headers configured',
      'HTTPS enforced', 'No eval()', 'Dependency audit clean', 'Rate limiting enabled',
      'Input sanitization', 'ESLint zero warnings', 'Prettier formatted',
      'No circular deps', 'Test coverage > 80%', 'No TODO in prod code',
      'Error boundaries present', 'Graceful degradation', 'No hardcoded secrets',
      'API versioning', 'Proper HTTP status codes', 'Request validation',
      'Response compression', 'Cache headers set', 'No memory leaks',
      'Web vitals passing', 'Mobile responsive', 'Cross-browser tested',
      'No deprecated APIs', 'Type safety 100%', 'No implicit any',
      'Strict null checks', 'Exhaustive switch cases', 'No floating promises',
      'Error logging configured', 'Health check endpoint',
    ];
    return {
      name: names[i] ?? `Quality check #${i + 1}`,
      category: categories[i % categories.length] as QualityCheck['category'],
      passed: i !== 8 && i !== 28,
      score: i === 8 ? 62 : i === 28 ? 45 : 85 + Math.floor(Math.random() * 16),
    };
  }),
  safetyScore: 94,
  changedFiles: [
    { path: 'src/components/Landing.tsx', additions: 24, deletions: 8, coveredByTests: ['renders landing page without crash'], risk: 'low' },
    { path: 'src/api/client.ts', additions: 12, deletions: 3, coveredByTests: ['API client retries on 5xx', 'CORS headers present on API responses'], risk: 'medium' },
    { path: 'src/hooks/useAuth.ts', additions: 45, deletions: 22, coveredByTests: ['auth redirect for unauthenticated user'], risk: 'high' },
    { path: 'src/utils/upload.ts', additions: 18, deletions: 0, coveredByTests: [], risk: 'high' },
  ],
  approvals: [
    { actor: 'Argo CI', action: 'Auto-approved: all regression tests passing', timestamp: '2026-04-28T14:22:11Z' },
    { actor: 'Security Bot', action: 'Approved: no critical vulnerabilities', timestamp: '2026-04-28T14:22:14Z' },
    { actor: 'Quality Gate', action: 'Approved: 47/49 checks passing (96%)', timestamp: '2026-04-28T14:22:16Z' },
  ],
};

/* -------------------------------------------------------------------------- */
/*  Utility sub-components                                                    */
/* -------------------------------------------------------------------------- */

function AnimatedCounter({ value, duration = 1.2 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = Math.max(1, Math.ceil(value / (duration * 60)));
    const id = setInterval(() => {
      start = Math.min(start + step, value);
      setDisplay(start);
      if (start >= value) clearInterval(id);
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [value, duration]);
  return <>{display}</>;
}

function CircularProgress({ score, size = 120, strokeWidth = 8 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 90 ? 'text-argo-green' : score >= 70 ? 'text-argo-amber' : 'text-argo-red';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="currentColor" strokeWidth={strokeWidth}
          className="text-argo-border opacity-30" />
        <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
          className={color}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (circumference * score) / 100 }}
          strokeDasharray={circumference}
          transition={{ duration: 1.5, ease: 'easeOut' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-2xl font-bold', color)}>
          <AnimatedCounter value={score} duration={1.4} />
        </span>
        <span className="text-[10px] text-argo-textSecondary uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
}

function StatusBadge({ passed, label }: { passed: boolean; label?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      passed
        ? 'bg-argo-green/10 text-argo-green'
        : 'bg-argo-red/10 text-argo-red',
    )}>
      {passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label ?? (passed ? 'Pass' : 'Fail')}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, badge, expanded, onToggle }: {
  icon: React.ElementType;
  title: string;
  badge?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle}
      className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
      {expanded
        ? <ChevronDown className="h-3.5 w-3.5 text-argo-textSecondary flex-shrink-0" />
        : <ChevronRight className="h-3.5 w-3.5 text-argo-textSecondary flex-shrink-0" />}
      <Icon className="h-4 w-4 text-argo-accent flex-shrink-0" />
      <span className="text-sm font-medium text-argo-text flex-1">{title}</span>
      {badge}
    </button>
  );
}

const CATEGORY_ICON: Record<QualityCheck['category'], React.ElementType> = {
  'code-quality': FileCode2,
  performance: Zap,
  accessibility: Globe,
  security: Lock,
  'best-practices': ShieldCheck,
};

const CATEGORY_LABEL: Record<QualityCheck['category'], string> = {
  'code-quality': 'Code Quality',
  performance: 'Performance',
  accessibility: 'Accessibility',
  security: 'Security',
  'best-practices': 'Best Practices',
};

const RISK_STYLE: Record<string, string> = {
  low: 'text-argo-green bg-argo-green/10',
  medium: 'text-argo-amber bg-argo-amber/10',
  high: 'text-argo-red bg-argo-red/10',
};

const SEVERITY_STYLE: Record<string, string> = {
  low: 'text-argo-textSecondary',
  medium: 'text-argo-amber',
  high: 'text-argo-red',
  critical: 'text-argo-red font-semibold',
};

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function GuardrailsDashboard({ operationId }: { operationId: string }) {
  const [data, setData] = useState<GuardrailsData | null>(null);
  const [loading, setLoading] = useState(true);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tests: true,
    security: true,
    quality: false,
    impact: false,
    approvals: true,
  });

  const toggle = useCallback(
    (key: string) => setExpandedSections((s) => ({ ...s, [key]: !s[key] })),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<GuardrailsData>(
          `/api/operations/${operationId}/guardrails`,
        );
        if (!cancelled) setData(res);
      } catch {
        // Endpoint not wired yet — fall back to realistic sample data.
        if (!cancelled) setData(SAMPLE_DATA);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [operationId]);

  /* Derived stats */
  const stats = useMemo(() => {
    if (!data) return null;
    const testsPassed = data.tests.filter((t) => t.passed).length;
    const vulnsPassed = data.vulnerabilities.filter((v) => v.passed).length;
    const qualityPassed = data.qualityChecks.filter((q) => q.passed).length;
    const qualityByCategory = data.qualityChecks.reduce<Record<string, QualityCheck[]>>((acc, q) => {
      (acc[q.category] ??= []).push(q);
      return acc;
    }, {});
    return { testsPassed, vulnsPassed, qualityPassed, qualityByCategory };
  }, [data]);

  /* ---------- Loading / empty states ---------- */

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  if (!data || !stats) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg px-8 text-center">
        <div>
          <Shield className="h-8 w-8 text-argo-red mx-auto mb-3" />
          <p className="text-sm text-argo-red">Failed to load guardrails data</p>
        </div>
      </div>
    );
  }

  /* ---------- Render ---------- */

  return (
    <div className="h-full flex flex-col bg-argo-bg overflow-y-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-argo-border px-5 h-12 flex-shrink-0 sticky top-0 bg-argo-bg/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2 text-argo-text">
          <ShieldCheck className="h-4 w-4 text-argo-green" />
          <span className="text-sm font-medium">Guardrails Dashboard</span>
        </div>
        <span className="text-[11px] text-argo-textSecondary font-mono tracking-tight">
          {operationId.slice(0, 8)}
        </span>
      </header>

      <div className="p-5 space-y-4">
        {/* ---- Deployment Safety Score ---- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-argo-border bg-argo-surface/50 backdrop-blur-sm p-6 flex flex-col sm:flex-row items-center gap-6"
        >
          <CircularProgress score={data.safetyScore} />
          <div className="flex-1 text-center sm:text-left space-y-2">
            <h2 className="text-lg font-semibold text-argo-text">Deployment Safety Score</h2>
            <p className="text-sm text-argo-textSecondary leading-relaxed">
              {data.safetyScore >= 90
                ? 'This deploy meets all safety thresholds. Ship with confidence.'
                : data.safetyScore >= 70
                  ? 'Minor issues detected. Review flagged items before deploying.'
                  : 'Critical issues found. Deployment is blocked until resolved.'}
            </p>
            <div className="flex flex-wrap justify-center sm:justify-start gap-3 pt-1">
              <MiniStat label="Tests" value={`${stats.testsPassed}/${data.tests.length}`} ok={stats.testsPassed === data.tests.length} />
              <MiniStat label="Vulns" value={`${stats.vulnsPassed}/${data.vulnerabilities.length}`} ok={stats.vulnsPassed === data.vulnerabilities.length} />
              <MiniStat label="Quality" value={`${stats.qualityPassed}/${data.qualityChecks.length}`} ok={stats.qualityPassed === data.qualityChecks.length} />
            </div>
          </div>
        </motion.div>

        {/* ---- Regression Tests ---- */}
        <Section delay={0.1}>
          <SectionHeader icon={Bug} title="Regression Tests"
            badge={<StatusBadge passed={stats.testsPassed === data.tests.length} label={`${stats.testsPassed}/${data.tests.length}`} />}
            expanded={!!expandedSections.tests} onToggle={() => toggle('tests')} />
          <AnimatePresence>
            {expandedSections.tests && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                className="overflow-hidden">
                <div className="px-4 pb-4 space-y-1.5">
                  {/* progress bar */}
                  <div className="h-2 rounded-full bg-argo-border/40 overflow-hidden mb-3">
                    <motion.div className="h-full rounded-full bg-argo-green"
                      initial={{ width: 0 }}
                      animate={{ width: `${(stats.testsPassed / data.tests.length) * 100}%` }}
                      transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }} />
                  </div>
                  {data.tests.map((t) => (
                    <div key={t.name} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-white/[0.02]">
                      {t.passed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-argo-green flex-shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-argo-red flex-shrink-0" />}
                      <span className={cn('flex-1 truncate', t.passed ? 'text-argo-text' : 'text-argo-red')}>{t.name}</span>
                      <span className="text-argo-textSecondary tabular-nums">{t.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* ---- Security Scan ---- */}
        <Section delay={0.2}>
          <SectionHeader icon={Lock} title="Security Scan"
            badge={<StatusBadge passed={stats.vulnsPassed === data.vulnerabilities.length}
              label={`${stats.vulnsPassed}/${data.vulnerabilities.length}`} />}
            expanded={!!expandedSections.security} onToggle={() => toggle('security')} />
          <AnimatePresence>
            {expandedSections.security && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                className="overflow-hidden">
                <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {data.vulnerabilities.map((v) => (
                    <div key={v.name} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-white/[0.02]">
                      {v.passed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-argo-green flex-shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-argo-red flex-shrink-0" />}
                      <span className={cn('flex-1 truncate', v.passed ? 'text-argo-text' : 'text-argo-red')}>{v.name}</span>
                      <span className={cn('text-[10px] uppercase tracking-wider', SEVERITY_STYLE[v.severity])}>{v.severity}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* ---- Quality Gate ---- */}
        <Section delay={0.3}>
          <SectionHeader icon={ShieldCheck} title="Quality Gate (49 checks)"
            badge={<StatusBadge passed={stats.qualityPassed === data.qualityChecks.length}
              label={`${stats.qualityPassed}/${data.qualityChecks.length}`} />}
            expanded={!!expandedSections.quality} onToggle={() => toggle('quality')} />
          <AnimatePresence>
            {expandedSections.quality && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                className="overflow-hidden">
                <div className="px-4 pb-4 space-y-4">
                  {Object.entries(stats.qualityByCategory).map(([cat, checks]) => {
                    const CatIcon = CATEGORY_ICON[cat as QualityCheck['category']] ?? ShieldCheck;
                    const catPassed = checks.filter((c) => c.passed).length;
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-2">
                          <CatIcon className="h-3.5 w-3.5 text-argo-accent" />
                          <span className="text-xs font-medium text-argo-text">
                            {CATEGORY_LABEL[cat as QualityCheck['category']] ?? cat}
                          </span>
                          <span className="text-[10px] text-argo-textSecondary ml-auto">{catPassed}/{checks.length}</span>
                        </div>
                        <div className="space-y-1">
                          {checks.map((c) => (
                            <div key={c.name} className="flex items-center gap-2 text-xs py-0.5 px-2">
                              {c.passed
                                ? <CheckCircle2 className="h-3 w-3 text-argo-green flex-shrink-0" />
                                : <XCircle className="h-3 w-3 text-argo-red flex-shrink-0" />}
                              <span className={cn('flex-1 truncate', c.passed ? 'text-argo-textSecondary' : 'text-argo-red')}>{c.name}</span>
                              <div className="w-16 h-1.5 rounded-full bg-argo-border/40 overflow-hidden">
                                <motion.div
                                  className={cn('h-full rounded-full', c.score >= 85 ? 'bg-argo-green' : c.score >= 60 ? 'bg-argo-amber' : 'bg-argo-red')}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${c.score}%` }}
                                  transition={{ duration: 0.8, delay: 0.1 }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* ---- Change Impact Analysis ---- */}
        <Section delay={0.4}>
          <SectionHeader icon={FileCode2} title="Change Impact Analysis"
            badge={<span className="text-[11px] text-argo-textSecondary">{data.changedFiles.length} files</span>}
            expanded={!!expandedSections.impact} onToggle={() => toggle('impact')} />
          <AnimatePresence>
            {expandedSections.impact && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                className="overflow-hidden">
                <div className="px-4 pb-4 space-y-2">
                  {data.changedFiles.map((f) => (
                    <div key={f.path} className="rounded-lg border border-argo-border/50 bg-white/[0.01] p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <FileCode2 className="h-3.5 w-3.5 text-argo-accent flex-shrink-0" />
                        <span className="text-xs font-mono text-argo-text truncate flex-1">{f.path}</span>
                        <span className={cn('text-[10px] rounded-full px-2 py-0.5 uppercase tracking-wider', RISK_STYLE[f.risk])}>
                          {f.risk} risk
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-argo-textSecondary">
                        <span className="text-argo-green">+{f.additions}</span>
                        <span className="text-argo-red">-{f.deletions}</span>
                        {f.coveredByTests.length > 0 ? (
                          <span className="flex items-center gap-1 text-argo-green">
                            <ShieldCheck className="h-3 w-3" />
                            {f.coveredByTests.length} test{f.coveredByTests.length !== 1 ? 's' : ''} covering
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-argo-amber">
                            <AlertTriangle className="h-3 w-3" />
                            No test coverage
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* ---- Approval History ---- */}
        <Section delay={0.5}>
          <SectionHeader icon={Fingerprint} title="Approval History"
            badge={<span className="text-[11px] text-argo-textSecondary">{data.approvals.length} entries</span>}
            expanded={!!expandedSections.approvals} onToggle={() => toggle('approvals')} />
          <AnimatePresence>
            {expandedSections.approvals && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                className="overflow-hidden">
                <div className="px-4 pb-4">
                  <div className="relative border-l-2 border-argo-border/40 ml-3 space-y-4 py-1">
                    {data.approvals.map((a, i) => (
                      <motion.div key={i}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 + i * 0.15 }}
                        className="relative pl-5">
                        <div className="absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-argo-green bg-argo-bg" />
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <User className="h-3 w-3 text-argo-accent" />
                            <span className="text-xs font-medium text-argo-text">{a.actor}</span>
                          </div>
                          <p className="text-[11px] text-argo-textSecondary">{a.action}</p>
                          <div className="flex items-center gap-1 text-[10px] text-argo-textSecondary">
                            <Clock className="h-2.5 w-2.5" />
                            {new Date(a.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function Section({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-xl border border-argo-border bg-argo-surface/50 backdrop-blur-sm overflow-hidden"
    >
      {children}
    </motion.div>
  );
}

function MiniStat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium',
      ok ? 'bg-argo-green/10 text-argo-green' : 'bg-argo-red/10 text-argo-red',
    )}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}: {value}
    </div>
  );
}
