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
  CircleDotDashed,
  CircleX,
  FileCode2,
  Loader2,
  Package,
  ShieldCheck,
  Sparkles,
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
  const filesRef = useRef(files);
  filesRef.current = files;

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
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-argo-accent" />
          <span className="text-sm text-argo-text">
            {streaming ? 'Building' : done?.success ? 'Build complete' : 'Build failed'}
          </span>
          {specialist && (
            <span className="text-xs text-argo-textSecondary font-mono">· {specialist.replace(/_/g, ' ')}</span>
          )}
        </div>
        {streaming && <Loader2 className="h-4 w-4 animate-spin text-argo-textSecondary" />}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Cycle pill row */}
        <div className="flex items-center gap-2">
          {cycles.map((c) => (
            <CyclePill key={c.cycle} cycle={c} active={activeCycle === c.cycle && streaming} />
          ))}
        </div>

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

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
