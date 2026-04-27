// Live build streamer. Opens the SSE feed at POST /api/build/stream and
// renders three vertically-stacked panels:
//   - Cycle status (which auto-fix cycle, gate result)
//   - Files appearing (each dyad-write tag becomes a row that animates in)
//   - Final report (success badge + new dependencies + a "Deploy" button)
//
// The operator never sees the raw model text — that's a feature. They see
// the result. Argo's promise: production code in minutes, hardly any bugs.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  CircleDotDashed,
  CircleX,
  Compass,
  FileCode2,
  Hash,
  Loader2,
  Package,
  PlayCircle,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

export type SpecialistKind =
  | 'rest_api'
  | 'crud_app'
  | 'scraper_pipeline'
  | 'scheduled_job'
  | 'webhook_bridge'
  | 'slack_bot'
  | 'form_workflow'
  | 'generic';

interface ParsedAction {
  kind: 'write' | 'rename' | 'delete' | 'add-dependency' | 'command' | 'chat-summary';
  path?: string;
  description?: string | null;
  contents?: string;
  from?: string;
  to?: string;
  packages?: string[];
  command?: string;
  summary?: string;
}

interface QualityIssue {
  check: string;
  severity: 'error' | 'warn';
  file: string;
  line: number | null;
  message: string;
}

interface CycleState {
  cycle: number;
  passed: boolean | null;
  errorCount: number;
  warnCount: number;
  issues: QualityIssue[];
}

interface ArchitectPlanFile {
  path: string;
  size: 'small' | 'medium' | 'large';
  rationale: string;
}

interface ArchitectPlan {
  title: string;
  summary: string;
  files: ArchitectPlanFile[];
  fileCount: number;
  dependencyCount: number;
  mermaid: string;
}

interface ReviewerFinding {
  severity: 'bad' | 'warn' | 'info';
  category: string;
  file: string | null;
  message: string;
}

interface ReviewerReport {
  cycle: number;
  passed: boolean;
  summary: string;
  findings: ReviewerFinding[];
}

interface TestingFailureLite {
  kind: string;
  message?: string;
  route?: string;
  status?: number;
  bodySnippet?: string;
  importPath?: string;
  sourceFile?: string;
  reason?: string;
  path?: string;
  tail?: string;
  name?: string;
  criterion?: string;
  assertion?: string;
  detail?: string;
}

interface TestingReportLite {
  cycle: number;
  passed: boolean;
  booted: boolean;
  durationMs: number;
  routesExercised: string[];
  failures: TestingFailureLite[];
}

interface ToolEventLite {
  ts: number;
  phase: 'called' | 'completed';
  name: string;
  ok?: boolean;
  label?: string;
}

export interface BuildStreamProps {
  operationId: string;
  prompt: string;
  /** Called when the build completes; the parent navigates to deploy. */
  onComplete?: (success: boolean) => void;
}

export function BuildStream({ operationId, prompt, onComplete }: BuildStreamProps) {
  const [specialist, setSpecialist] = useState<SpecialistKind | null>(null);
  const [files, setFiles] = useState<Map<string, { description: string | null; bytes: number }>>(new Map());
  const [packages, setPackages] = useState<string[]>([]);
  const [cycles, setCycles] = useState<CycleState[]>([]);
  const [activeCycle, setActiveCycle] = useState<number | null>(null);
  const [done, setDone] = useState<{ success: boolean; cycles: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);
  const [tokens, setTokens] = useState<{ total: number; usd: number } | null>(null);
  const [startedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [architectPhase, setArchitectPhase] = useState<'idle' | 'started' | 'completed'>('idle');
  const [architectPlan, setArchitectPlan] = useState<ArchitectPlan | null>(null);
  const [reviewerByCycle, setReviewerByCycle] = useState<Map<number, ReviewerReport>>(new Map());
  const [testingByCycle, setTestingByCycle] = useState<Map<number, TestingReportLite>>(new Map());
  const [toolEvents, setToolEvents] = useState<ToolEventLite[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;

  // Tick a clock once a second so the elapsed timer in the header
  // moves without re-rendering on every chunk.
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [streaming]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    void (async () => {
      try {
        const res = await fetch('/api/build/stream', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operationId, prompt }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          setError(`HTTP ${res.status}`);
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';
        let currentData = '';

        const dispatch = (event: string, data: string) => {
          if (cancelled) return;
          let payload: unknown = null;
          try {
            payload = JSON.parse(data);
          } catch {
            payload = null;
          }
          if (!payload) return;
          handleEvent(event, payload);
        };

        while (!cancelled) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let newlineIdx = buffer.indexOf('\n');
          while (newlineIdx !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            newlineIdx = buffer.indexOf('\n');
            if (line.startsWith(':')) continue; // comment / heartbeat
            if (line === '') {
              if (currentEvent) dispatch(currentEvent, currentData);
              currentEvent = '';
              currentData = '';
              continue;
            }
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              currentData += (currentData ? '\n' : '') + line.slice(6);
            }
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err).slice(0, 200));
      } finally {
        if (!cancelled) setStreaming(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, prompt]);

  const handleEvent = (event: string, payload: unknown) => {
    if (event === 'start') {
      const p = payload as { specialist: SpecialistKind };
      setSpecialist(p.specialist);
    } else if (event === 'action') {
      const p = payload as { action: ParsedAction };
      const a = p.action;
      if (a.kind === 'write' && a.path) {
        setFiles((prev) => {
          const next = new Map(prev);
          next.set(a.path!, {
            description: a.description ?? null,
            bytes: (a.contents ?? '').length,
          });
          return next;
        });
      } else if (a.kind === 'delete' && a.path) {
        setFiles((prev) => {
          const next = new Map(prev);
          next.delete(a.path!);
          return next;
        });
      } else if (a.kind === 'rename' && a.from && a.to) {
        setFiles((prev) => {
          const next = new Map(prev);
          const v = next.get(a.from!);
          if (v) {
            next.delete(a.from!);
            next.set(a.to!, v);
          }
          return next;
        });
      } else if (a.kind === 'add-dependency' && a.packages) {
        setPackages((prev) => Array.from(new Set([...prev, ...a.packages!])));
      }
    } else if (event === 'cycle_start') {
      const p = payload as { cycle: number };
      setActiveCycle(p.cycle);
      setCycles((prev) => [
        ...prev.filter((c) => c.cycle !== p.cycle),
        { cycle: p.cycle, passed: null, errorCount: 0, warnCount: 0, issues: [] },
      ]);
    } else if (event === 'gate') {
      const p = payload as {
        cycle: number;
        passed: boolean;
        errorCount: number;
        warnCount: number;
        issues: QualityIssue[];
      };
      setCycles((prev) =>
        prev.map((c) =>
          c.cycle === p.cycle
            ? { ...c, passed: p.passed, errorCount: p.errorCount, warnCount: p.warnCount, issues: p.issues }
            : c,
        ),
      );
    } else if (event === 'token_tick') {
      const p = payload as { totalTokens: number; estimatedUsd: number };
      setTokens({ total: p.totalTokens, usd: p.estimatedUsd });
    } else if (event === 'architect') {
      const p = payload as Partial<ArchitectPlan> & { phase: 'started' | 'completed' };
      if (p.phase === 'started') {
        setArchitectPhase('started');
      } else if (p.phase === 'completed') {
        setArchitectPhase('completed');
        setArchitectPlan({
          title: p.title ?? '',
          summary: p.summary ?? '',
          files: (p.files ?? []) as ArchitectPlanFile[],
          fileCount: p.fileCount ?? 0,
          dependencyCount: p.dependencyCount ?? 0,
          mermaid: p.mermaid ?? '',
        });
      }
    } else if (event === 'reviewer') {
      const p = payload as ReviewerReport;
      setReviewerByCycle((prev) => {
        const next = new Map(prev);
        next.set(p.cycle, p);
        return next;
      });
    } else if (event === 'testing') {
      const p = payload as TestingReportLite;
      setTestingByCycle((prev) => {
        const next = new Map(prev);
        next.set(p.cycle, p);
        return next;
      });
    } else if (event === 'tool') {
      const p = payload as { kind: 'tool_called' | 'tool_completed'; name: string; ok?: boolean; label?: string };
      setToolEvents((prev) => [
        ...prev.slice(-30),
        {
          ts: Date.now(),
          phase: p.kind === 'tool_called' ? 'called' : 'completed',
          name: p.name,
          ...(p.ok !== undefined ? { ok: p.ok } : {}),
          ...(p.label ? { label: p.label } : {}),
        },
      ]);
    } else if (event === 'done') {
      const p = payload as { success: boolean };
      setDone({ success: p.success, cycles: cycles.length || activeCycle || 1 });
      setStreaming(false);
      onComplete?.(p.success);
    } else if (event === 'error') {
      const p = payload as { message: string };
      setError(p.message);
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-argo-surface/30 overflow-hidden">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-argo-accent flex-shrink-0" />
          <span className="text-sm text-argo-text">
            {streaming ? 'Building' : done?.success ? 'Build complete' : 'Build failed'}
          </span>
          {specialist && (
            <span className="text-xs text-argo-textSecondary font-mono truncate">· {specialist.replace(/_/g, ' ')}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-argo-textSecondary font-mono flex-shrink-0">
          {tokens && (
            <>
              <span title="Tokens generated this build" className="inline-flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {formatTokens(tokens.total)}
              </span>
              <span title="Estimated LLM cost so far (final cost is in Replay)" className="inline-flex items-center gap-1 text-argo-accent">
                <CircleDollarSign className="h-3 w-3" />
                {formatUsd(tokens.usd)}
              </span>
            </>
          )}
          <span title="Elapsed time">{formatElapsed(now - startedAt)}</span>
          {streaming && <Loader2 className="h-4 w-4 animate-spin text-argo-textSecondary" />}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Cycle pill row */}
        <div className="flex items-center gap-2">
          {cycles.map((c) => (
            <CyclePill key={c.cycle} cycle={c} active={activeCycle === c.cycle && streaming} />
          ))}
        </div>

        {/* Auto-fix narrative — appears when cycle 2+ kicks in, explaining
            WHY a re-prompt is happening so the operator sees Argo's
            quality loop in action instead of "another spinner". */}
        <AutoFixNarrative cycles={cycles} activeCycle={activeCycle} streaming={streaming} />

        {/* Architect plan card — multi-agent mode only. Shows the plan
            BEFORE the builder starts, so the operator sees what Argo
            committed to ship. Cursor-2.0 / Replit-Agent style "plan
            mode" view. None of the other vibe coders surface this. */}
        {(architectPhase !== 'idle') && (
          <ArchitectCard phase={architectPhase} plan={architectPlan} />
        )}

        {/* Tool-call strip — every <argo-tool> the agent fires lights up
            here. Especially noisy on fullstack_app builds with sandbox_exec. */}
        {toolEvents.length > 0 && <ToolEventStrip events={toolEvents} />}

        {/* Per-cycle reviewer + testing reports rendered below the cycle row */}
        {cycles.map((c) => {
          const review = reviewerByCycle.get(c.cycle);
          const testing = testingByCycle.get(c.cycle);
          if (!review && !testing) return null;
          return (
            <div key={`reports-${c.cycle}`} className="space-y-3">
              {testing && <TestingCard cycle={c.cycle} report={testing} />}
              {review && <ReviewerCard cycle={c.cycle} report={review} />}
            </div>
          );
        })}

        {/* Files appearing */}
        {files.size > 0 && (
          <section>
            <div className="text-xs text-argo-textSecondary uppercase tracking-widest font-mono mb-2 flex items-center gap-2">
              <FileCode2 className="h-3 w-3" /> Files generated · {files.size}
            </div>
            <ul className="divide-y divide-argo-border rounded border border-argo-border overflow-hidden">
              <AnimatePresence initial={false}>
                {Array.from(files.entries()).map(([path, info]) => (
                  <motion.li
                    key={path}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-argo-surface/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-argo-green flex-shrink-0" />
                      <span className="font-mono text-argo-text truncate">{path}</span>
                      {info.description && (
                        <span className="text-xs text-argo-textSecondary truncate">— {info.description}</span>
                      )}
                    </div>
                    <span className="text-xs text-argo-textSecondary font-mono flex-shrink-0">
                      {prettyBytes(info.bytes)}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        )}

        {/* New dependencies */}
        {packages.length > 0 && (
          <section>
            <div className="text-xs text-argo-textSecondary uppercase tracking-widest font-mono mb-2 flex items-center gap-2">
              <Package className="h-3 w-3" /> Dependencies added
            </div>
            <div className="flex flex-wrap gap-1.5">
              {packages.map((p) => (
                <span
                  key={p}
                  className="text-xs font-mono bg-argo-surfaceAlt text-argo-text border border-argo-border rounded px-2 py-0.5"
                >
                  {p}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Cycle issues (errors only — warnings are noise) */}
        {cycles.map((c) =>
          c.issues.filter((i) => i.severity === 'error').length === 0 ? null : (
            <section key={`issues-${c.cycle}`}>
              <div className="text-xs text-argo-amber uppercase tracking-widest font-mono mb-2 flex items-center gap-2">
                <CircleAlert className="h-3 w-3" /> Cycle {c.cycle} · {c.errorCount} errors auto-fixing
              </div>
              <ul className="text-xs text-argo-textSecondary space-y-1">
                {c.issues
                  .filter((i) => i.severity === 'error')
                  .map((i, idx) => (
                    <li key={`${c.cycle}-${idx}`} className="font-mono">
                      <span className="text-argo-amber">{i.check}</span> · {i.file}
                      {i.line ? `:${i.line}` : ''} — {i.message}
                    </li>
                  ))}
              </ul>
            </section>
          ),
        )}

        {/* Done banner */}
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'rounded-lg border p-4 flex items-center gap-3',
              done.success
                ? 'border-argo-green/40 bg-argo-green/10'
                : 'border-argo-amber/40 bg-argo-amber/10',
            )}
          >
            {done.success ? (
              <ShieldCheck className="h-5 w-5 text-argo-green flex-shrink-0" />
            ) : (
              <CircleAlert className="h-5 w-5 text-argo-amber flex-shrink-0" />
            )}
            <div className="text-sm">
              {done.success ? (
                <>
                  <span className="text-argo-text">Production-grade. {files.size} files, {packages.length} deps,{' '}
                  {cycles.length} {cycles.length === 1 ? 'cycle' : 'cycles'}.</span>
                  <div className="text-argo-textSecondary text-xs mt-0.5">
                    Click <span className="text-argo-accent">Go Live</span> to push to a real Blaxel sandbox.
                  </div>
                </>
              ) : (
                <span className="text-argo-text">Build hit the {cycles.length}-cycle ceiling. Review the issues above.</span>
              )}
            </div>
          </motion.div>
        )}

        {error && (
          <div className="rounded-lg border border-argo-red/40 bg-argo-red/10 p-3 flex items-center gap-2 text-sm">
            <CircleX className="h-4 w-4 text-argo-red flex-shrink-0" />
            <span className="text-argo-text">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CyclePill({ cycle, active }: { cycle: CycleState; active: boolean }) {
  const Icon =
    cycle.passed === true
      ? CheckCircle2
      : cycle.passed === false
      ? CircleAlert
      : active
      ? CircleDotDashed
      : Loader2;
  const tone =
    cycle.passed === true
      ? 'border-argo-green/40 text-argo-green bg-argo-green/10'
      : cycle.passed === false
      ? 'border-argo-amber/40 text-argo-amber bg-argo-amber/10'
      : 'border-argo-accent/40 text-argo-accent bg-argo-accent/10';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono',
        tone,
      )}
    >
      <Icon className={cn('h-3 w-3', active && cycle.passed === null && 'animate-spin')} />
      Cycle {cycle.cycle}
      {cycle.passed === false && cycle.errorCount > 0 && (
        <span className="text-argo-amber">· {cycle.errorCount}</span>
      )}
    </span>
  );
}

function AutoFixNarrative({
  cycles,
  activeCycle,
  streaming,
}: {
  cycles: CycleState[];
  activeCycle: number | null;
  streaming: boolean;
}) {
  // Only show when an auto-fix iteration is in progress AND we have a
  // failed prior cycle to explain. First cycle gets no banner — the
  // operator already knows the build just started.
  if (activeCycle == null || activeCycle < 2 || !streaming) return null;
  const prior = cycles.find((c) => c.cycle === activeCycle - 1);
  if (!prior || prior.passed !== false || prior.errorCount === 0) return null;

  // Top-3 failed checks summarised by check id with a count.
  const checkCounts = new Map<string, number>();
  for (const issue of prior.issues) {
    if (issue.severity !== 'error') continue;
    checkCounts.set(issue.check, (checkCounts.get(issue.check) ?? 0) + 1);
  }
  const topChecks = Array.from(checkCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-lg border border-argo-accent/30 bg-argo-accent/5 px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <Wrench className="h-3.5 w-3.5 text-argo-accent mt-0.5 flex-shrink-0" />
        <div className="text-sm text-argo-text argo-body min-w-0">
          <span className="text-argo-accent font-medium">Cycle {activeCycle} · auto-fixing.</span>{' '}
          Cycle {prior.cycle} failed the quality gate ({prior.errorCount} error
          {prior.errorCount === 1 ? '' : 's'}). Re-prompting GPT-5.5 with the structured error
          report so it patches:
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {topChecks.map(([check, count]) => (
              <span
                key={check}
                className="text-[10px] uppercase tracking-widest font-mono bg-argo-amber/10 text-argo-amber border border-argo-amber/30 rounded px-1.5 py-0.5"
              >
                {check.replace(/_/g, ' ')}
                {count > 1 && <span className="ml-1 text-argo-textSecondary">×{count}</span>}
              </span>
            ))}
            {checkCounts.size > 3 && (
              <span className="text-[10px] text-argo-textSecondary font-mono">
                +{checkCounts.size - 3} more
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ArchitectCard({
  phase,
  plan,
}: {
  phase: 'idle' | 'started' | 'completed';
  plan: ArchitectPlan | null;
}) {
  if (phase === 'started' && !plan) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="rounded-lg border border-argo-accent/30 bg-argo-accent/5 px-3 py-2.5 flex items-center gap-2.5"
      >
        <Loader2 className="h-3.5 w-3.5 text-argo-accent animate-spin flex-shrink-0" />
        <div className="text-sm text-argo-text argo-body">
          <span className="text-argo-accent font-medium">Architect agent · planning.</span>{' '}
          Reading the brief, deciding the file structure, drafting the architecture diagram. The
          builder won't start until the plan is locked.
        </div>
      </motion.div>
    );
  }
  if (!plan) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-lg border border-argo-accent/30 bg-argo-accent/5 overflow-hidden"
    >
      <div className="px-3.5 py-2.5 border-b border-argo-accent/20 flex items-start gap-2.5">
        <Compass className="h-3.5 w-3.5 text-argo-accent mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-argo-text">
            <span className="text-argo-accent font-medium">Architect plan</span>{' '}
            <span className="text-argo-textSecondary">
              · {plan.fileCount} files · {plan.dependencyCount} deps
            </span>
          </div>
          <div className="text-base text-argo-text mt-1" style={{ letterSpacing: '-0.02em' }}>
            {plan.title}
          </div>
          <p className="text-xs text-argo-textSecondary argo-body mt-1 leading-relaxed">
            {plan.summary}
          </p>
        </div>
      </div>
      {plan.files.length > 0 && (
        <details className="px-3.5 py-2 border-b border-argo-accent/10">
          <summary className="text-[11px] uppercase tracking-widest text-argo-textSecondary font-mono cursor-pointer hover:text-argo-text">
            File plan ({plan.files.length})
          </summary>
          <ul className="mt-2 space-y-1 max-h-64 overflow-y-auto">
            {plan.files.map((f) => (
              <li key={f.path} className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0',
                    f.size === 'large'
                      ? 'bg-argo-accent'
                      : f.size === 'medium'
                      ? 'bg-argo-accent/60'
                      : 'bg-argo-accent/30',
                  )}
                />
                <div className="min-w-0">
                  <span className="font-mono text-argo-text">{f.path}</span>
                  <span className="text-argo-textSecondary text-[11px] ml-2">— {f.rationale}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {plan.mermaid && (
        <details open className="px-3.5 py-2">
          <summary className="text-[11px] uppercase tracking-widest text-argo-textSecondary font-mono cursor-pointer hover:text-argo-text">
            Architecture diagram
          </summary>
          <MermaidDiagram source={plan.mermaid} />
        </details>
      )}
    </motion.div>
  );
}

function MermaidDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        // Initialise once with the Argo theme — re-init is idempotent.
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          fontFamily: 'Inter, system-ui, sans-serif',
          themeVariables: {
            background: '#0a0a0b',
            primaryColor: '#0a0a0b',
            primaryTextColor: '#f2f0eb',
            primaryBorderColor: 'rgba(0,229,204,0.4)',
            lineColor: 'rgba(0,229,204,0.5)',
            secondaryColor: '#121214',
            tertiaryColor: '#0a0a0b',
            mainBkg: '#121214',
            edgeLabelBackground: '#0a0a0b',
            clusterBkg: '#121214',
            clusterBorder: 'rgba(255,255,255,0.1)',
          },
        });
        const id = 'argo-mermaid-' + Math.random().toString(36).slice(2, 9);
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        if (ref.current) {
          ref.current.innerHTML = svg;
          // Make the SVG scale to its container.
          const svgEl = ref.current.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('height');
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(String((err as Error)?.message ?? err).slice(0, 200));
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  if (error) {
    return (
      <div className="mt-2">
        <div className="text-[11px] text-argo-amber font-mono mb-2">Mermaid render failed: {error}</div>
        <pre className="text-[10px] font-mono text-argo-textSecondary bg-argo-bg/40 border border-argo-border/40 rounded p-2 overflow-x-auto">
          {source}
        </pre>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="mt-3 rounded-md bg-argo-bg/40 border border-argo-border/40 p-3 overflow-x-auto"
    />
  );
}

function ReviewerCard({ cycle, report }: { cycle: number; report: ReviewerReport }) {
  const bad = report.findings.filter((f) => f.severity === 'bad');
  const warn = report.findings.filter((f) => f.severity === 'warn');
  const tone = report.passed
    ? 'border-argo-green/30 bg-argo-green/5'
    : 'border-argo-amber/40 bg-argo-amber/5';
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('rounded-lg border px-3.5 py-2.5', tone)}
    >
      <div className="flex items-start gap-2.5">
        <ScrollText
          className={cn(
            'h-3.5 w-3.5 mt-0.5 flex-shrink-0',
            report.passed ? 'text-argo-green' : 'text-argo-amber',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-argo-text">
            <span
              className={cn('font-medium', report.passed ? 'text-argo-green' : 'text-argo-amber')}
            >
              Reviewer · cycle {cycle} · {report.passed ? 'approved' : 'sending back for fixes'}.
            </span>
          </div>
          <p className="text-xs text-argo-textSecondary argo-body mt-1 leading-relaxed">
            {report.summary}
          </p>
          {(bad.length > 0 || warn.length > 0) && (
            <ul className="mt-2 space-y-1">
              {bad.map((f, i) => (
                <li
                  key={`bad-${i}`}
                  className="flex items-start gap-2 text-xs font-mono text-argo-amber"
                >
                  <CircleAlert className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    <span className="text-argo-amber">[{f.category}]</span>{' '}
                    {f.file && <span className="text-argo-text">{f.file} — </span>}
                    <span className="text-argo-textSecondary">{f.message}</span>
                  </span>
                </li>
              ))}
              {warn.map((f, i) => (
                <li
                  key={`warn-${i}`}
                  className="flex items-start gap-2 text-xs font-mono text-argo-textSecondary"
                >
                  <CircleDotDashed className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    <span>[{f.category}]</span>{' '}
                    {f.file && <span className="text-argo-text">{f.file} — </span>}
                    <span>{f.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function TestingCard({ cycle, report }: { cycle: number; report: TestingReportLite }) {
  const tone = report.passed
    ? 'border-argo-green/30 bg-argo-green/5'
    : 'border-argo-red/40 bg-argo-red/5';
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('rounded-lg border px-3.5 py-2.5', tone)}
    >
      <div className="flex items-start gap-2.5">
        <PlayCircle
          className={cn(
            'h-3.5 w-3.5 mt-0.5 flex-shrink-0',
            report.passed ? 'text-argo-green' : 'text-argo-red',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-argo-text">
            <span
              className={cn('font-medium', report.passed ? 'text-argo-green' : 'text-argo-red')}
            >
              Runtime tests · cycle {cycle} · {report.passed ? 'all green' : 'failing'}.
            </span>
            <span className="text-argo-textSecondary ml-2">
              {report.booted ? 'booted' : 'never booted'} · {(report.durationMs / 1000).toFixed(1)}s
              · {report.routesExercised.length} routes exercised
            </span>
          </div>
          {report.routesExercised.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {report.routesExercised.slice(0, 8).map((r, i) => (
                <span
                  key={`r-${i}`}
                  className="text-[10px] font-mono text-argo-textSecondary border border-argo-border/40 rounded px-1.5 py-0.5"
                >
                  {r}
                </span>
              ))}
            </div>
          )}
          {report.failures.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {report.failures.map((f, i) => (
                <li
                  key={`f-${i}`}
                  className="text-[11px] font-mono text-argo-red leading-relaxed"
                >
                  <span className="uppercase tracking-widest text-[10px]">{f.kind.replace(/_/g, ' ')}</span>
                  {f.criterion && (
                    <span className="text-argo-textSecondary ml-2 normal-case">
                      "{f.criterion}"
                    </span>
                  )}
                  {f.detail && (
                    <span className="block text-argo-textSecondary mt-0.5 ml-1">{f.detail}</span>
                  )}
                  {f.message && (
                    <span className="block text-argo-textSecondary mt-0.5 ml-1">{f.message}</span>
                  )}
                  {f.route && (
                    <span className="block text-argo-textSecondary mt-0.5 ml-1">
                      {f.route} → {f.status}
                    </span>
                  )}
                  {f.tail && (
                    <pre className="block text-[10px] text-argo-textSecondary mt-0.5 ml-1 max-h-24 overflow-y-auto whitespace-pre-wrap">
                      {f.tail}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ToolEventStrip({ events }: { events: ToolEventLite[] }) {
  // Pair called/completed events by name+order so the strip shows
  // "fetch_21st_component · ok" rather than two separate chips.
  const merged: Array<{ name: string; phase: 'called' | 'completed'; ok?: boolean; label?: string }> = [];
  for (const e of events) {
    if (e.phase === 'completed' && merged.length > 0) {
      const last = merged[merged.length - 1]!;
      if (last.name === e.name && last.phase === 'called') {
        last.phase = 'completed';
        if (e.ok !== undefined) last.ok = e.ok;
        if (e.label) last.label = e.label;
        continue;
      }
    }
    merged.push({
      name: e.name,
      phase: e.phase,
      ...(e.ok !== undefined ? { ok: e.ok } : {}),
      ...(e.label ? { label: e.label } : {}),
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono inline-flex items-center gap-1">
        <Terminal className="h-3 w-3" /> Tool calls
      </span>
      {merged.slice(-12).map((e, i) => {
        const tone =
          e.phase === 'called'
            ? 'border-argo-accent/30 bg-argo-accent/5 text-argo-accent'
            : e.ok === false
            ? 'border-argo-amber/30 bg-argo-amber/5 text-argo-amber'
            : 'border-argo-green/30 bg-argo-green/5 text-argo-green';
        const Icon = e.phase === 'called' ? Loader2 : e.ok === false ? CircleAlert : CheckCircle2;
        return (
          <span
            key={i}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono',
              tone,
            )}
            title={e.label ?? e.name}
          >
            <Icon className={cn('h-3 w-3', e.phase === 'called' && 'animate-spin')} />
            {e.name}
            {e.label && <span className="opacity-60">· {e.label.slice(0, 30)}</span>}
          </span>
        );
      })}
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(2)}M tok`;
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n)}`;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
