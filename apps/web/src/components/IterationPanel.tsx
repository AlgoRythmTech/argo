/**
 * IterationPanel — the feature that makes Argo different from every other
 * vibe coding tool. Users describe what to change, Argo makes surgical
 * edits, runs regression tests, and shows a diff before deploying.
 *
 * No other tool does this. Replit/Lovable regenerate chunks and pray.
 * Argo guarantees: your working features stay working.
 */

import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCode2,
  Loader2,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { iterate, type IterateResult } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface IterationPanelProps {
  operationId: string;
  operationName: string;
  onIterationComplete?: () => void;
}

type IterationPhase =
  | { step: 'idle' }
  | { step: 'running'; message: string }
  | { step: 'result'; result: IterateResult }
  | { step: 'error'; error: string };

export function IterationPanel({ operationId, operationName, onIterationComplete }: IterationPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [strategy, setStrategy] = useState<'auto' | 'surgical' | 'rebuild'>('auto');
  const [phase, setPhase] = useState<IterationPhase>({ step: 'idle' });
  const [forcing, setForcing] = useState(false);

  const runIteration = useCallback(async () => {
    if (!instruction.trim()) return;
    setPhase({ step: 'running', message: 'Analyzing your request…' });

    try {
      const result = await iterate.run({
        operationId,
        instruction: instruction.trim(),
        strategy,
      });
      setPhase({ step: 'result', result });
      if (result.ok) {
        onIterationComplete?.();
      }
    } catch (err) {
      setPhase({ step: 'error', error: String((err as Error)?.message ?? err).slice(0, 300) });
    }
  }, [instruction, strategy, operationId, onIterationComplete]);

  const forceIteration = useCallback(async () => {
    setForcing(true);
    try {
      await iterate.force(operationId);
      setPhase({ step: 'idle' });
      setInstruction('');
      onIterationComplete?.();
    } catch (err) {
      setPhase({ step: 'error', error: String((err as Error)?.message ?? err).slice(0, 300) });
    } finally {
      setForcing(false);
    }
  }, [operationId, onIterationComplete]);

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      {/* Header */}
      <header className="border-b border-argo-border px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-argo-accent" />
          <h2 className="text-sm font-semibold text-argo-text">Iterate on {operationName}</h2>
        </div>
        <p className="text-xs text-argo-textSecondary">
          Describe what to change. Argo makes surgical edits and checks for regressions before deploying.
        </p>
      </header>

      {/* Input area */}
      <div className="p-4 border-b border-argo-border">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="What would you like to change? e.g. 'Add a phone number field to the form' or 'Change the rejection email to be more empathetic'"
          rows={3}
          disabled={phase.step === 'running'}
          className="w-full bg-argo-surface border border-argo-border rounded-xl px-4 py-3 text-sm text-argo-text placeholder:text-argo-textSecondary focus:outline-none focus:border-argo-accent resize-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-argo-textSecondary uppercase">Strategy:</span>
            {(['auto', 'surgical', 'rebuild'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStrategy(s)}
                disabled={phase.step === 'running'}
                className={cn(
                  'text-[10px] font-mono px-2 py-1 rounded-md transition-colors',
                  strategy === s
                    ? 'bg-argo-accent/15 text-argo-accent border border-argo-accent/30'
                    : 'text-argo-textSecondary hover:text-argo-text border border-transparent',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void runIteration()}
            disabled={!instruction.trim() || phase.step === 'running'}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              instruction.trim() && phase.step !== 'running'
                ? 'bg-argo-accent text-argo-bg hover:bg-argo-accent/90'
                : 'bg-argo-border text-argo-textSecondary cursor-not-allowed',
            )}
          >
            {phase.step === 'running' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {phase.step === 'running' ? 'Working…' : 'Iterate'}
          </button>
        </div>
      </div>

      {/* Status / results */}
      <div className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {phase.step === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <ShieldCheck className="h-10 w-10 text-argo-accent/30 mx-auto mb-3" />
              <h3 className="text-argo-text text-base mb-2">Safe iteration</h3>
              <p className="text-argo-textSecondary text-sm max-w-xs mx-auto mb-6">
                Unlike other AI coding tools, Argo tests your app before AND after every change.
                If anything breaks, we block the deploy and show you the diff.
              </p>
              <div className="space-y-2 max-w-sm mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setInstruction(s)}
                    className="block w-full text-left text-xs text-argo-textSecondary hover:text-argo-text border border-argo-border rounded-lg px-3 py-2 hover:bg-argo-surface transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {phase.step === 'running' && (
            <motion.div
              key="running"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-16"
            >
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 border-2 border-argo-accent/20 rounded-full" />
                <div className="absolute inset-0 border-2 border-argo-accent border-t-transparent rounded-full animate-spin" />
                <Zap className="absolute inset-0 m-auto h-6 w-6 text-argo-accent" />
              </div>
              <h3 className="text-argo-text text-base mb-2">Iterating…</h3>
              <div className="space-y-1 text-xs text-argo-textSecondary max-w-xs mx-auto">
                <Step label="Loading existing bundle" done />
                <Step label="Running baseline tests" active />
                <Step label="Making targeted changes" />
                <Step label="Running regression tests" />
                <Step label="Comparing results" />
              </div>
            </motion.div>
          )}

          {phase.step === 'result' && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {phase.result.ok ? (
                <SuccessResult result={phase.result} onReset={() => { setPhase({ step: 'idle' }); setInstruction(''); }} />
              ) : phase.result.regression ? (
                <RegressionResult
                  result={phase.result}
                  onForce={() => void forceIteration()}
                  forcing={forcing}
                  onCancel={() => { setPhase({ step: 'idle' }); setInstruction(''); }}
                />
              ) : (
                <FailureResult result={phase.result} onRetry={() => void runIteration()} />
              )}
            </motion.div>
          )}

          {phase.step === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12"
            >
              <AlertTriangle className="h-10 w-10 text-argo-red mx-auto mb-3" />
              <h3 className="text-argo-text text-base mb-2">Iteration failed</h3>
              <p className="text-argo-red text-xs font-mono max-w-sm mx-auto mb-4">{phase.error}</p>
              <button
                type="button"
                onClick={() => setPhase({ step: 'idle' })}
                className="text-xs text-argo-accent hover:text-argo-accent/80"
              >
                Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SuccessResult({ result, onReset }: { result: IterateResult; onReset: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-argo-green/15 flex items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-argo-green" />
        </div>
        <div>
          <h3 className="text-argo-text font-semibold">Deployed successfully</h3>
          <p className="text-xs text-argo-textSecondary">
            v{result.bundleVersion} — {result.cycles} build cycle{result.cycles === 1 ? '' : 's'}, zero regressions
          </p>
        </div>
      </div>

      <DiffSummary diff={result.diff} />

      <button
        type="button"
        onClick={onReset}
        className="mt-4 flex items-center gap-2 text-xs text-argo-accent hover:text-argo-accent/80"
      >
        <RefreshCw className="h-3 w-3" /> Make another change
      </button>
    </div>
  );
}

function RegressionResult({
  result,
  onForce,
  forcing,
  onCancel,
}: {
  result: IterateResult;
  onForce: () => void;
  forcing: boolean;
  onCancel: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-argo-amber/15 flex items-center justify-center">
          <ShieldAlert className="h-5 w-5 text-argo-amber" />
        </div>
        <div>
          <h3 className="text-argo-text font-semibold">Regression detected</h3>
          <p className="text-xs text-argo-textSecondary">
            {result.regressions.length} route{result.regressions.length === 1 ? '' : 's'} that were passing now fail
          </p>
        </div>
      </div>

      <div className="bg-argo-amber/5 border border-argo-amber/20 rounded-xl p-4 mb-4">
        <h4 className="text-xs font-mono text-argo-amber mb-2 uppercase tracking-widest">Regressions</h4>
        <ul className="space-y-1">
          {result.regressions.map((r) => (
            <li key={r} className="text-sm text-argo-text flex items-center gap-2">
              <X className="h-3 w-3 text-argo-red flex-shrink-0" />
              <span className="font-mono">{r}</span>
            </li>
          ))}
        </ul>
      </div>

      <DiffSummary diff={result.diff} />

      <p className="text-xs text-argo-textSecondary mt-4 mb-3">
        {result.message}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-xs text-argo-textSecondary hover:text-argo-text rounded-md"
        >
          Cancel &amp; refine
        </button>
        <button
          type="button"
          onClick={onForce}
          disabled={forcing}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-argo-amber text-argo-bg rounded-md hover:bg-argo-amber/90 disabled:opacity-50"
        >
          {forcing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Deploy anyway
        </button>
      </div>
    </div>
  );
}

function FailureResult({ result, onRetry }: { result: IterateResult; onRetry: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-argo-red/15 flex items-center justify-center">
          <X className="h-5 w-5 text-argo-red" />
        </div>
        <div>
          <h3 className="text-argo-text font-semibold">Build failed</h3>
          <p className="text-xs text-argo-textSecondary">
            {result.cycles} cycle{result.cycles === 1 ? '' : 's'} exhausted
          </p>
        </div>
      </div>

      {result.message && (
        <p className="text-xs text-argo-red font-mono bg-argo-red/5 border border-argo-red/20 rounded-lg p-3 mb-4">
          {result.message}
        </p>
      )}

      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-2 text-xs text-argo-accent hover:text-argo-accent/80"
      >
        <RefreshCw className="h-3 w-3" /> Retry with different instruction
      </button>
    </div>
  );
}

function DiffSummary({ diff }: { diff: IterateResult['diff'] }) {
  if (!diff) return null;
  const changedFiles = diff.changes.filter((c) => c.change !== 'unchanged');
  return (
    <div className="border border-argo-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-argo-border bg-argo-surface/50">
        <span className="text-[10px] font-mono text-argo-green">+{diff.added} added</span>
        <span className="text-[10px] font-mono text-argo-amber">~{diff.modified} modified</span>
        <span className="text-[10px] font-mono text-argo-red">-{diff.removed} removed</span>
        <span className="text-[10px] font-mono text-argo-textSecondary">{diff.unchanged} unchanged</span>
      </div>
      {changedFiles.length > 0 && (
        <ul className="divide-y divide-argo-border max-h-48 overflow-y-auto">
          {changedFiles.map((f) => (
            <li key={f.path} className="px-4 py-1.5 flex items-center gap-2 text-xs">
              <FileCode2 className="h-3 w-3 text-argo-textSecondary flex-shrink-0" />
              <span className="font-mono text-argo-text flex-1 truncate">{f.path}</span>
              <span
                className={cn(
                  'text-[10px] font-mono',
                  f.change === 'added' ? 'text-argo-green' : f.change === 'removed' ? 'text-argo-red' : 'text-argo-amber',
                )}
              >
                {f.change}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Step({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <Check className="h-3 w-3 text-argo-green" />
      ) : active ? (
        <Loader2 className="h-3 w-3 text-argo-accent animate-spin" />
      ) : (
        <ArrowRight className="h-3 w-3 text-argo-textSecondary/40" />
      )}
      <span className={cn(done ? 'text-argo-green' : active ? 'text-argo-accent' : 'text-argo-textSecondary/40')}>
        {label}
      </span>
    </div>
  );
}

const SUGGESTIONS = [
  'Add a phone number field to the form',
  'Make the rejection email more empathetic',
  'Add a "company" field and show it in the digest',
  'Change the approval expiry from 72 hours to 48 hours',
  'Add Slack notification when a submission is received',
];
