/**
 * ChangeReview — the "no silent changes" diff gate.
 *
 * Before ANY code change is applied, this component shows a clear diff with
 * approve/reject buttons. This directly addresses "agent lies about changes" —
 * the #1 complaint across Replit, Bolt, and Lovable.
 *
 * Every proposed file change is shown with risk level, category badge, and a
 * side-by-side diff. Schema and auth changes get special warnings. Regression
 * test failures block approval unless the user explicitly overrides.
 */

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileMinus2,
  FilePlus2,
  MessageSquare,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

// ── Types ──────────────────────────────────────────────────────────────

interface Change {
  file: string;
  type: 'added' | 'modified' | 'removed';
  description: string;
  before?: string;
  after?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  category: 'code' | 'schema' | 'auth' | 'routing' | 'config' | 'dependency';
}

interface TestResults {
  baselineTotal: number;
  baselinePassed: number;
  regressionTotal: number;
  regressionPassed: number;
  regressionsFailed: string[];
}

interface ChangeReviewProps {
  operationId: string;
  changes: Change[];
  testResults?: TestResults;
  onApprove: () => void;
  onReject: () => void;
  onRequestChanges?: (feedback: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────

const RISK_COLORS: Record<Change['riskLevel'], string> = {
  low: 'bg-argo-green/15 text-argo-green border-argo-green/30',
  medium: 'bg-argo-amber/15 text-argo-amber border-argo-amber/30',
  high: 'bg-argo-red/15 text-argo-red border-argo-red/30',
  critical: 'bg-argo-red/20 text-argo-red border-argo-red/40 animate-pulse',
};

const RISK_ORDER: Record<Change['riskLevel'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const TYPE_ICONS: Record<Change['type'], typeof FilePlus2> = {
  added: FilePlus2,
  modified: FileCode2,
  removed: FileMinus2,
};

const TYPE_COLORS: Record<Change['type'], string> = {
  added: 'text-argo-green bg-argo-green/10',
  modified: 'text-argo-amber bg-argo-amber/10',
  removed: 'text-argo-red bg-argo-red/10',
};

const CATEGORY_LABELS: Record<Change['category'], string> = {
  code: 'Code',
  schema: 'Schema',
  auth: 'Auth',
  routing: 'Routing',
  config: 'Config',
  dependency: 'Dependency',
};

// ── Component ──────────────────────────────────────────────────────────

export function ChangeReview({
  operationId,
  changes,
  testResults,
  onApprove,
  onReject,
  onRequestChanges,
}: ChangeReviewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [forceOverride, setForceOverride] = useState(false);

  // Derived state
  const overallRisk = useMemo(() => {
    let highest: Change['riskLevel'] = 'low';
    for (const c of changes) {
      if (RISK_ORDER[c.riskLevel] > RISK_ORDER[highest]) highest = c.riskLevel;
    }
    return highest;
  }, [changes]);

  const hasSensitiveChanges = useMemo(
    () => changes.some((c) => c.category === 'schema' || c.category === 'auth'),
    [changes],
  );

  const sensitiveCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const c of changes) {
      if (c.category === 'schema') cats.add('schema');
      if (c.category === 'auth') cats.add('auth');
    }
    return Array.from(cats);
  }, [changes]);

  const allTestsPass = testResults
    ? testResults.regressionsFailed.length === 0
    : true;

  const canApprove = allTestsPass || forceOverride;

  const toggleFile = useCallback((file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedFiles(new Set(changes.map((c) => c.file)));
  }, [changes]);

  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  const handleRequestChanges = useCallback(() => {
    if (feedback.trim() && onRequestChanges) {
      onRequestChanges(feedback.trim());
      setFeedback('');
      setFeedbackOpen(false);
    }
  }, [feedback, onRequestChanges]);

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="border-b border-argo-border px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-argo-accent" />
            <h2 className="text-sm font-semibold text-argo-text">
              {changes.length} change{changes.length === 1 ? '' : 's'} proposed
            </h2>
            <span
              className={cn(
                'text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border',
                RISK_COLORS[overallRisk],
              )}
            >
              {overallRisk} risk
            </span>
          </div>

          {/* Safety badge */}
          {testResults ? (
            allTestsPass ? (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-argo-green bg-argo-green/10 px-2.5 py-1 rounded-full">
                <ShieldCheck className="h-3 w-3" />
                All {testResults.regressionTotal} tests pass
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-argo-red bg-argo-red/10 px-2.5 py-1 rounded-full">
                <ShieldAlert className="h-3 w-3" />
                {testResults.regressionsFailed.length} regression{testResults.regressionsFailed.length === 1 ? '' : 's'} detected
              </div>
            )
          ) : null}
        </div>

        <p className="text-xs text-argo-textSecondary">
          Review every change before it touches your production app. Operation{' '}
          <span className="font-mono text-argo-text">{operationId.slice(0, 8)}</span>
        </p>

        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-[10px] text-argo-accent hover:text-argo-accent/80 font-mono"
          >
            Expand all
          </button>
          <span className="text-argo-border">|</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[10px] text-argo-accent hover:text-argo-accent/80 font-mono"
          >
            Collapse all
          </button>
        </div>
      </header>

      {/* ── Warnings ───────────────────────────────────────────────── */}
      <div className="px-5 pt-3 space-y-2">
        {hasSensitiveChanges && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 bg-argo-amber/10 border border-argo-amber/25 rounded-lg px-3 py-2.5"
          >
            <AlertTriangle className="h-4 w-4 text-argo-amber flex-shrink-0 mt-0.5" />
            <p className="text-xs text-argo-amber">
              This change modifies{' '}
              <strong>{sensitiveCategories.join(' and ')}</strong>. Please review
              carefully before approving.
            </p>
          </motion.div>
        )}

        {testResults && !allTestsPass && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 bg-argo-red/10 border border-argo-red/25 rounded-lg px-3 py-2.5"
          >
            <ShieldAlert className="h-4 w-4 text-argo-red flex-shrink-0 mt-0.5" />
            <div className="text-xs text-argo-red">
              <p className="mb-1">
                {testResults.regressionsFailed.length} regression test
                {testResults.regressionsFailed.length === 1 ? '' : 's'} failed.
                Approving will deploy code that breaks existing functionality.
              </p>
              <ul className="space-y-0.5 font-mono text-[10px]">
                {testResults.regressionsFailed.map((t) => (
                  <li key={t} className="flex items-center gap-1">
                    <X className="h-2.5 w-2.5" /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </div>

      {/* ── File list ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        <AnimatePresence initial={false}>
          {changes.map((change) => {
            const isExpanded = expandedFiles.has(change.file);
            const TypeIcon = TYPE_ICONS[change.type];

            return (
              <motion.div
                key={change.file}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="border border-argo-border rounded-xl overflow-hidden bg-argo-surface/30"
              >
                {/* File header row */}
                <button
                  type="button"
                  onClick={() => toggleFile(change.file)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-argo-surface/50 transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-argo-textSecondary flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-argo-textSecondary flex-shrink-0" />
                  )}

                  {/* Type badge */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded',
                      TYPE_COLORS[change.type],
                    )}
                  >
                    <TypeIcon className="h-3 w-3" />
                    {change.type}
                  </span>

                  {/* File path */}
                  <span className="flex-1 text-xs font-mono text-argo-text truncate">
                    {change.file}
                  </span>

                  {/* Category badge */}
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                      change.category === 'schema' || change.category === 'auth'
                        ? 'bg-argo-amber/10 text-argo-amber border-argo-amber/30'
                        : 'bg-argo-surface text-argo-textSecondary border-argo-border',
                    )}
                  >
                    {CATEGORY_LABELS[change.category]}
                    {(change.category === 'schema' || change.category === 'auth') && ' !'}
                  </span>

                  {/* Risk badge */}
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded-full border',
                      RISK_COLORS[change.riskLevel],
                    )}
                  >
                    {change.riskLevel}
                  </span>
                </button>

                {/* Expanded content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {/* Description */}
                      <div className="px-4 py-2 border-t border-argo-border bg-argo-surface/20">
                        <p className="text-xs text-argo-textSecondary">{change.description}</p>
                      </div>

                      {/* Diff view */}
                      {(change.before || change.after) && (
                        <div className="border-t border-argo-border">
                          <DiffView before={change.before} after={change.after} />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <div className="border-t border-argo-border px-5 py-3 bg-argo-surface/30">
        {/* Force override checkbox when tests fail */}
        {testResults && !allTestsPass && (
          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={forceOverride}
              onChange={(e) => setForceOverride(e.target.checked)}
              className="rounded border-argo-border bg-argo-surface text-argo-accent focus:ring-argo-accent h-3.5 w-3.5"
            />
            <span className="text-[10px] text-argo-red font-mono">
              I understand regressions will be deployed. Override safety check.
            </span>
          </label>
        )}

        {/* Feedback input (expandable) */}
        <AnimatePresence>
          {feedbackOpen && onRequestChanges && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-3"
            >
              <div className="flex items-start gap-2">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Describe what changes you'd like..."
                  rows={2}
                  className="flex-1 bg-argo-surface border border-argo-border rounded-lg px-3 py-2 text-xs text-argo-text placeholder:text-argo-textSecondary focus:outline-none focus:border-argo-accent resize-none"
                />
                <button
                  type="button"
                  onClick={handleRequestChanges}
                  disabled={!feedback.trim()}
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
                    feedback.trim()
                      ? 'bg-argo-accent text-argo-bg hover:bg-argo-accent/90'
                      : 'bg-argo-border text-argo-textSecondary cursor-not-allowed',
                  )}
                >
                  <MessageSquare className="h-3 w-3" />
                  Send
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReject}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-argo-textSecondary border border-argo-border rounded-lg hover:text-argo-text hover:border-argo-text/30 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </button>

            {onRequestChanges && (
              <button
                type="button"
                onClick={() => setFeedbackOpen((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border rounded-lg transition-colors',
                  feedbackOpen
                    ? 'text-argo-accent border-argo-accent/30 bg-argo-accent/5'
                    : 'text-argo-textSecondary border-argo-border hover:text-argo-text hover:border-argo-text/30',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Request Changes
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onApprove}
            disabled={!canApprove}
            className={cn(
              'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors',
              canApprove
                ? 'bg-argo-green text-argo-bg hover:bg-argo-green/90'
                : 'bg-argo-border text-argo-textSecondary cursor-not-allowed',
            )}
          >
            <Check className="h-4 w-4" />
            Approve &amp; Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DiffView ───────────────────────────────────────────────────────────

function DiffView({ before, after }: { before?: string; after?: string }) {
  const beforeLines = (before ?? '').split('\n');
  const afterLines = (after ?? '').split('\n');
  const maxLines = Math.max(beforeLines.length, afterLines.length);

  return (
    <div className="grid grid-cols-2 divide-x divide-argo-border text-[11px] font-mono leading-5 max-h-64 overflow-y-auto">
      {/* Before column */}
      <div className="min-w-0">
        <div className="px-3 py-1 text-[10px] text-argo-textSecondary bg-argo-red/5 border-b border-argo-border uppercase tracking-widest">
          Before
        </div>
        <div className="px-1">
          {beforeLines.map((line, i) => {
            const removed = i < beforeLines.length && (i >= afterLines.length || afterLines[i] !== line);
            return (
              <div
                key={`b-${i}`}
                className={cn(
                  'flex items-start',
                  removed && 'bg-argo-red/10',
                )}
              >
                <span className="w-8 flex-shrink-0 text-right pr-2 text-argo-textSecondary/50 select-none">
                  {i + 1}
                </span>
                <span className={cn('flex-1 whitespace-pre-wrap break-all', removed && 'text-argo-red')}>
                  {line || ' '}
                </span>
              </div>
            );
          })}
          {/* Pad if before is shorter */}
          {beforeLines.length < maxLines &&
            Array.from({ length: maxLines - beforeLines.length }).map((_, i) => (
              <div key={`bp-${i}`} className="flex items-start">
                <span className="w-8 flex-shrink-0" />
                <span className="flex-1">&nbsp;</span>
              </div>
            ))}
        </div>
      </div>

      {/* After column */}
      <div className="min-w-0">
        <div className="px-3 py-1 text-[10px] text-argo-textSecondary bg-argo-green/5 border-b border-argo-border uppercase tracking-widest">
          After
        </div>
        <div className="px-1">
          {afterLines.map((line, i) => {
            const added = i < afterLines.length && (i >= beforeLines.length || beforeLines[i] !== line);
            return (
              <div
                key={`a-${i}`}
                className={cn(
                  'flex items-start',
                  added && 'bg-argo-green/10',
                )}
              >
                <span className="w-8 flex-shrink-0 text-right pr-2 text-argo-textSecondary/50 select-none">
                  {i + 1}
                </span>
                <span className={cn('flex-1 whitespace-pre-wrap break-all', added && 'text-argo-green')}>
                  {line || ' '}
                </span>
              </div>
            );
          })}
          {afterLines.length < maxLines &&
            Array.from({ length: maxLines - afterLines.length }).map((_, i) => (
              <div key={`ap-${i}`} className="flex items-start">
                <span className="w-8 flex-shrink-0" />
                <span className="flex-1">&nbsp;</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
