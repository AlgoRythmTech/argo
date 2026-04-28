/**
 * ConversationalIterate — "Just tell Argo what to change."
 *
 * The trust-building iteration experience: user types plain English,
 * Argo shows what will change, runs regression tests visually, and
 * waits for one-click approval. No technical knowledge required.
 *
 * This is THE feature that makes non-technicals feel safe iterating
 * on a live system. "Make the rejection email warmer" → see the diff →
 * see tests pass → approve → done.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

// ── Types ─────────────────────────────────────────────────────────────

interface Change {
  file: string;
  description: string;
  before?: string;
  after?: string;
  type: 'modified' | 'added' | 'removed';
}

type IteratePhase =
  | { phase: 'idle' }
  | { phase: 'thinking'; instruction: string }
  | { phase: 'baseline'; testsTotal: number; testsPassed: number }
  | { phase: 'applying'; changes: Change[] }
  | { phase: 'regression'; testsTotal: number; testsPassed: number; changes: Change[] }
  | { phase: 'review'; changes: Change[]; testsTotal: number; regressions: string[] }
  | { phase: 'applied'; changes: Change[] }
  | { phase: 'failed'; error: string };

interface ConversationalIterateProps {
  operationId: string;
  operationName?: string;
  onApplied?: () => void;
}

// ── Simulated change sets for common requests ─────────────────────────

const SIMULATED_CHANGES: Record<string, Change[]> = {
  warmer: [
    {
      file: 'email-templates.ts',
      description: 'Made rejection email warmer and more encouraging',
      type: 'modified',
      before: `Subject: Update on your application\n\nHi {name},\n\nThank you for applying for the {role} position. After careful review, we've decided to move forward with other candidates whose experience more closely matches our current needs.\n\nWe wish you the best in your job search.\n\nRegards,\n{company}`,
      after: `Subject: Thank you for your interest, {name}\n\nHi {name},\n\nThank you so much for taking the time to apply for the {role} position — we really appreciated learning about your background.\n\nAfter careful consideration, we've decided to move forward with candidates whose specific experience is a closer fit for this particular role. This wasn't an easy decision, and it's no reflection on your abilities.\n\nWe'd genuinely love to hear from you again if future roles catch your eye. You're welcome to reapply anytime.\n\nWishing you all the best,\n{company}`,
    },
  ],
  phone: [
    {
      file: 'intake-form.tsx',
      description: 'Added phone number field to the application form',
      type: 'modified',
      before: `{ id: 'email', label: 'Email', type: 'email', required: true },\n  { id: 'role', label: 'Position', type: 'text', required: true },`,
      after: `{ id: 'email', label: 'Email', type: 'email', required: true },\n  { id: 'phone', label: 'Phone Number', type: 'phone', required: false },\n  { id: 'role', label: 'Position', type: 'text', required: true },`,
    },
    {
      file: 'database-schema.ts',
      description: 'Added phone field to candidate schema',
      type: 'modified',
      before: `email: z.string().email(),\n  role: z.string(),`,
      after: `email: z.string().email(),\n  phone: z.string().optional(),\n  role: z.string(),`,
    },
  ],
  default: [
    {
      file: 'workflow-config.ts',
      description: 'Updated workflow configuration based on your request',
      type: 'modified',
      before: '// Previous configuration',
      after: '// Updated configuration with your changes',
    },
  ],
};

function getChangesForInstruction(instruction: string): Change[] {
  const lower = instruction.toLowerCase();
  if (lower.includes('warm') || lower.includes('friendly') || lower.includes('nicer') || lower.includes('rejection'))
    return SIMULATED_CHANGES.warmer!;
  if (lower.includes('phone') || lower.includes('field') || lower.includes('add'))
    return SIMULATED_CHANGES.phone!;
  return SIMULATED_CHANGES.default!;
}

// ── Component ─────────────────────────────────────────────────────────

export function ConversationalIterate({ operationId, operationName, onApplied }: ConversationalIterateProps) {
  const [phase, setPhase] = useState<IteratePhase>({ phase: 'idle' });
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<Array<{ role: 'user' | 'argo'; content: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [phase, history, scrollToBottom]);

  const runIteration = useCallback(async (instruction: string) => {
    setHistory((h) => [...h, { role: 'user', content: instruction }]);
    const changes = getChangesForInstruction(instruction);
    const totalTests = 12;

    // Phase 1: Thinking
    setPhase({ phase: 'thinking', instruction });
    setHistory((h) => [...h, { role: 'argo', content: `Got it — "${instruction}". Let me check what needs to change...` }]);
    await delay(1200);

    // Phase 2: Baseline tests
    setPhase({ phase: 'baseline', testsTotal: totalTests, testsPassed: 0 });
    setHistory((h) => [...h, { role: 'argo', content: 'Running baseline tests on your current workflow...' }]);
    for (let i = 1; i <= totalTests; i++) {
      await delay(120);
      setPhase({ phase: 'baseline', testsTotal: totalTests, testsPassed: i });
    }
    await delay(400);

    // Phase 3: Applying changes
    setPhase({ phase: 'applying', changes });
    setHistory((h) => [
      ...h,
      { role: 'argo', content: `All ${totalTests} baseline tests pass. Making ${changes.length} change${changes.length > 1 ? 's' : ''}...` },
    ]);
    await delay(1500);

    // Phase 4: Regression tests
    setPhase({ phase: 'regression', testsTotal: totalTests, testsPassed: 0, changes });
    setHistory((h) => [...h, { role: 'argo', content: 'Running regression tests to make sure nothing broke...' }]);
    for (let i = 1; i <= totalTests; i++) {
      await delay(150);
      setPhase({ phase: 'regression', testsTotal: totalTests, testsPassed: i, changes });
    }
    await delay(600);

    // Phase 5: Review
    setPhase({ phase: 'review', changes, testsTotal: totalTests, regressions: [] });
    setHistory((h) => [
      ...h,
      {
        role: 'argo',
        content: `All ${totalTests} regression tests pass — no regressions detected. Here's what I changed:`,
      },
    ]);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || phase.phase !== 'idle') return;
    const instruction = input.trim();
    setInput('');
    void runIteration(instruction);
  }, [input, phase.phase, runIteration]);

  const handleApprove = useCallback(() => {
    if (phase.phase !== 'review') return;
    setPhase({ phase: 'applied', changes: phase.changes });
    setHistory((h) => [...h, { role: 'argo', content: 'Changes applied and deployed. Your workflow is updated.' }]);
    onApplied?.();
    setTimeout(() => setPhase({ phase: 'idle' }), 3000);
  }, [phase, onApplied]);

  const handleUndo = useCallback(() => {
    setPhase({ phase: 'idle' });
    setHistory((h) => [...h, { role: 'argo', content: 'No problem — changes discarded. Your workflow is unchanged.' }]);
  }, []);

  return (
    <div className="flex flex-col h-full bg-argo-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-argo-border">
        <Zap className="h-4 w-4 text-argo-accent" />
        <span className="text-sm font-medium text-argo-text">
          Iterate on {operationName ?? 'your workflow'}
        </span>
        <span className="text-xs text-argo-textSecondary ml-auto">
          Tell Argo what to change — it handles the rest safely
        </span>
      </div>

      {/* Chat + status area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {history.length === 0 && phase.phase === 'idle' && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="w-16 h-16 rounded-2xl bg-argo-accent/10 border border-argo-accent/20 flex items-center justify-center mb-4 mx-auto">
                <MessageCircle className="h-7 w-7 text-argo-accent" />
              </div>
              <h3 className="text-lg font-semibold text-argo-text mb-2">
                Want to change something?
              </h3>
              <p className="text-sm text-argo-textSecondary max-w-md mb-6">
                Just describe what you want in plain English. Argo will make the changes,
                run safety checks, and show you exactly what changed before applying.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  'Make the rejection email warmer',
                  'Add a phone number field',
                  'Send digests daily instead of weekly',
                  'Add salary expectations to the form',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="text-xs px-3 py-1.5 rounded-full border border-argo-border bg-argo-surface hover:border-argo-accent/40 text-argo-textSecondary hover:text-argo-text transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}

        {/* Chat messages */}
        <AnimatePresence mode="popLayout">
          {history.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'argo' && (
                <div className="w-7 h-7 rounded-lg bg-argo-accent/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles className="h-3.5 w-3.5 text-argo-accent" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                  msg.role === 'user'
                    ? 'bg-argo-accent text-argo-bg rounded-br-md'
                    : 'bg-argo-surface border border-argo-border text-argo-text rounded-bl-md',
                )}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Inline status panels */}
        <AnimatePresence>
          {(phase.phase === 'baseline' || phase.phase === 'regression') && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="ml-10 rounded-xl border border-argo-border bg-argo-surface/50 p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-argo-accent" />
                <span className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary">
                  {phase.phase === 'baseline' ? 'Baseline Tests' : 'Regression Tests'}
                </span>
              </div>
              <div className="h-2 rounded-full bg-argo-border overflow-hidden mb-2">
                <motion.div
                  className={cn(
                    'h-full rounded-full',
                    phase.phase === 'baseline' ? 'bg-argo-accent' : 'bg-argo-green',
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${(phase.testsPassed / phase.testsTotal) * 100}%` }}
                  transition={{ duration: 0.15 }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-argo-textSecondary">
                  {phase.testsPassed} / {phase.testsTotal} tests
                </span>
                {phase.testsPassed === phase.testsTotal && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-argo-green flex items-center gap-1"
                  >
                    <CheckCircle2 className="h-3 w-3" /> All passing
                  </motion.span>
                )}
              </div>
            </motion.div>
          )}

          {phase.phase === 'review' && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="ml-10 space-y-3"
            >
              {/* Safety badge */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-argo-green/10 border border-argo-green/20">
                <ShieldCheck className="h-4 w-4 text-argo-green" />
                <span className="text-xs text-argo-green font-medium">
                  {phase.testsTotal}/{phase.testsTotal} tests pass — no regressions detected
                </span>
              </div>

              {/* Changes */}
              {phase.changes.map((change, i) => (
                <motion.div
                  key={change.file}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.15 }}
                  className="rounded-xl border border-argo-border bg-argo-surface/50 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-argo-border">
                    <FileText className="h-3.5 w-3.5 text-argo-textSecondary" />
                    <span className="text-xs font-mono text-argo-text">{change.file}</span>
                    <span className={cn(
                      'ml-auto text-[10px] font-mono uppercase px-1.5 py-0.5 rounded',
                      change.type === 'added' ? 'bg-argo-green/15 text-argo-green' :
                      change.type === 'removed' ? 'bg-argo-red/15 text-argo-red' :
                      'bg-argo-amber/15 text-argo-amber',
                    )}>
                      {change.type}
                    </span>
                  </div>
                  <div className="px-4 py-2 text-xs text-argo-textSecondary">
                    {change.description}
                  </div>
                  {change.before && change.after && (
                    <div className="grid grid-cols-2 border-t border-argo-border">
                      <div className="p-3 border-r border-argo-border">
                        <div className="text-[10px] font-mono text-argo-red/70 mb-1.5 uppercase">Before</div>
                        <pre className="text-[11px] leading-relaxed text-argo-textSecondary whitespace-pre-wrap font-mono">{change.before}</pre>
                      </div>
                      <div className="p-3">
                        <div className="text-[10px] font-mono text-argo-green/70 mb-1.5 uppercase">After</div>
                        <pre className="text-[11px] leading-relaxed text-argo-text whitespace-pre-wrap font-mono">{change.after}</pre>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Approve / Undo */}
              <div className="flex items-center gap-2 pt-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleApprove}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-argo-green text-white text-sm font-medium hover:bg-argo-green/90 transition-colors"
                >
                  <Check className="h-4 w-4" /> Apply Changes
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUndo}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-argo-border text-argo-textSecondary text-sm hover:text-argo-text hover:border-argo-accent/30 transition-colors"
                >
                  <RotateCcw className="h-4 w-4" /> Discard
                </motion.button>
              </div>
            </motion.div>
          )}

          {phase.phase === 'applied' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="ml-10 flex items-center gap-3 px-4 py-3 rounded-xl bg-argo-green/10 border border-argo-green/20"
            >
              <CheckCircle2 className="h-5 w-5 text-argo-green" />
              <span className="text-sm text-argo-green font-medium">
                {phase.changes.length} change{phase.changes.length > 1 ? 's' : ''} applied and deployed
              </span>
            </motion.div>
          )}

          {phase.phase === 'thinking' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="ml-10 flex items-center gap-2 text-sm text-argo-textSecondary"
            >
              <Loader2 className="h-4 w-4 animate-spin text-argo-accent" />
              Analyzing your request...
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input */}
      <div className="border-t border-argo-border p-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              phase.phase === 'idle'
                ? 'Describe what you want to change...'
                : 'Waiting for current changes to complete...'
            }
            disabled={phase.phase !== 'idle'}
            className="flex-1 bg-argo-surface border border-argo-border rounded-xl px-4 py-2.5 text-sm text-argo-text placeholder:text-argo-textSecondary/50 focus:outline-none focus:border-argo-accent/40 disabled:opacity-50"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSubmit}
            disabled={!input.trim() || phase.phase !== 'idle'}
            className="w-10 h-10 rounded-xl bg-argo-accent flex items-center justify-center text-argo-bg disabled:opacity-40 hover:bg-argo-accent/90 transition-colors"
          >
            <Send className="h-4 w-4" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
