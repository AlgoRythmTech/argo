// ScopingPanel — the click-card questionnaire that turns one sentence
// into a precise ProjectBrief. Replaces Argo's previous three-question
// dialogue. UX inspired by Perplexity follow-ups: each question is a
// card with button-style options that animate in.

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Loader2, Sparkles, Star } from 'lucide-react';
import { cn } from '../lib/utils.js';
import {
  scoping,
  type QuestionAnswer,
  type ScopingQuestion,
  type ScopingQuestionnaire,
} from '../api/scoping.js';

type Phase =
  | { kind: 'intro' }
  | { kind: 'generating' }
  | { kind: 'answering'; questionnaire: ScopingQuestionnaire }
  | { kind: 'finalizing' }
  | { kind: 'done'; buildPrompt: string }
  | { kind: 'error'; message: string };

export interface ScopingPanelProps {
  operationId: string;
  /** Initial sentence captured by the prompt box (optional). */
  initialSentence?: string;
  /** Called with the compiled build prompt — parent kicks off /api/build/stream. */
  onBriefReady: (buildPrompt: string) => void;
}

export function ScopingPanel({ operationId, initialSentence, onBriefReady }: ScopingPanelProps) {
  const [sentence, setSentence] = useState(initialSentence ?? '');
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [answers, setAnswers] = useState<Map<string, QuestionAnswer>>(new Map());

  useEffect(() => {
    if (initialSentence && initialSentence.trim().length >= 10 && phase.kind === 'intro') {
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSentence]);

  async function start() {
    if (sentence.trim().length < 10) return;
    setPhase({ kind: 'generating' });
    try {
      const q = await scoping.start(operationId, sentence.trim());
      setAnswers(new Map());
      setPhase({ kind: 'answering', questionnaire: q });
    } catch (err) {
      setPhase({ kind: 'error', message: String(err).slice(0, 240) });
    }
  }

  async function finalize() {
    if (phase.kind !== 'answering') return;
    setPhase({ kind: 'finalizing' });
    try {
      const result = await scoping.finalize(operationId, {
        questionnaireId: phase.questionnaire.id,
        answers: Array.from(answers.values()),
      });
      setPhase({ kind: 'done', buildPrompt: result.buildPrompt });
      onBriefReady(result.buildPrompt);
    } catch (err) {
      setPhase({ kind: 'error', message: String(err).slice(0, 240) });
    }
  }

  function setAnswer(q: ScopingQuestion, next: QuestionAnswer) {
    setAnswers((prev) => {
      const out = new Map(prev);
      out.set(q.id, next);
      return out;
    });
  }

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      <AnimatePresence mode="wait">
        {phase.kind === 'intro' && (
          <IntroState
            key="intro"
            sentence={sentence}
            onChange={setSentence}
            onStart={() => void start()}
          />
        )}
        {phase.kind === 'generating' && <GeneratingState key="generating" sentence={sentence} />}
        {phase.kind === 'answering' && (
          <AnsweringState
            key="answering"
            questionnaire={phase.questionnaire}
            answers={answers}
            onAnswer={setAnswer}
            onFinalize={() => void finalize()}
          />
        )}
        {phase.kind === 'finalizing' && <FinalizingState key="finalizing" />}
        {phase.kind === 'done' && <DoneState key="done" buildPrompt={phase.buildPrompt} />}
        {phase.kind === 'error' && (
          <ErrorState key="error" message={phase.message} onRetry={() => setPhase({ kind: 'intro' })} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Phases ─────────────────────────────────────────────────────────────

function IntroState({
  sentence,
  onChange,
  onStart,
}: {
  sentence: string;
  onChange: (s: string) => void;
  onStart: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="m-auto w-full max-w-2xl px-8 py-12"
    >
      <div className="flex items-center gap-2 mb-3 text-argo-accent">
        <Sparkles className="h-4 w-4" />
        <span className="text-xs uppercase tracking-widest">Scope first, build second</span>
      </div>
      <h2 className="text-3xl text-argo-text argo-hero mb-2">
        Describe what you want Argo to operate.
      </h2>
      <p className="text-argo-textSecondary mb-8 argo-body">
        One sentence is enough. Argo will follow up with 4–6 click-through questions to nail the
        scope, then build the entire production stack.
      </p>
      <textarea
        value={sentence}
        onChange={(e) => onChange(e.target.value)}
        placeholder='e.g. "Candidates apply to my recruiting site through a form. I want to read each one, reject most, and forward the strong ones to the hiring client."'
        className="w-full min-h-[160px] rounded-xl border border-argo-border bg-argo-surface px-4 py-3 text-base text-argo-text placeholder:text-argo-textSecondary focus:border-argo-accent focus:outline-none"
      />
      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={onStart}
          disabled={sentence.trim().length < 10}
          className="inline-flex items-center gap-2 rounded-full bg-argo-accent text-argo-bg px-5 py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-argo-accent/90 transition-colors"
        >
          Scope it <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}

function GeneratingState({ sentence }: { sentence: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="m-auto w-full max-w-2xl px-8 py-12 text-center"
    >
      <Loader2 className="h-8 w-8 text-argo-accent animate-spin mx-auto mb-6" />
      <div className="text-argo-text argo-hero text-xl mb-2">Designing the questionnaire…</div>
      <div className="text-argo-textSecondary text-sm argo-body">
        Reading your sentence: <span className="italic">"{sentence.slice(0, 140)}"</span>
      </div>
    </motion.div>
  );
}

function AnsweringState({
  questionnaire,
  answers,
  onAnswer,
  onFinalize,
}: {
  questionnaire: ScopingQuestionnaire;
  answers: Map<string, QuestionAnswer>;
  onAnswer: (q: ScopingQuestion, a: QuestionAnswer) => void;
  onFinalize: () => void;
}) {
  const requiredAnswered = useMemo(
    () =>
      questionnaire.questions
        .filter((q) => q.required)
        .every((q) => isAnswered(q, answers.get(q.id))),
    [questionnaire, answers],
  );
  const total = questionnaire.questions.length;
  const answeredCount = questionnaire.questions.filter((q) =>
    isAnswered(q, answers.get(q.id)),
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex-1 overflow-y-auto"
    >
      <div className="max-w-3xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 text-argo-accent">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs uppercase tracking-widest">Scoping · {questionnaire.specialist.replace(/_/g, ' ')}</span>
          </div>
          <span className="text-xs text-argo-textSecondary font-mono">
            {answeredCount} / {total}
          </span>
        </div>
        <h2 className="text-2xl text-argo-text argo-hero mb-2">{questionnaire.detectedSummary}</h2>
        <p className="text-argo-textSecondary text-sm argo-body mb-8">
          Argo will use these answers to build a production-grade backend with no follow-up
          questions. Take 30 seconds — every click sharpens the output.
        </p>

        <ol className="space-y-6">
          {questionnaire.questions.map((q, idx) => (
            <motion.li
              key={q.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-xl border border-argo-border bg-argo-surface p-5"
            >
              <div className="flex items-start gap-3 mb-3">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-argo-accent/15 text-argo-accent text-xs font-mono">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <div className="text-argo-text font-medium leading-snug">{q.prompt}</div>
                  {q.helper && (
                    <div className="text-argo-textSecondary text-sm mt-0.5 argo-body">
                      {q.helper}
                    </div>
                  )}
                </div>
              </div>
              <QuestionAnswerControl
                question={q}
                answer={answers.get(q.id)}
                onChange={(a) => onAnswer(q, a)}
              />
            </motion.li>
          ))}
        </ol>

        <div className="sticky bottom-0 mt-8 -mx-8 px-8 py-4 bg-gradient-to-t from-argo-bg via-argo-bg to-transparent flex items-center justify-between">
          <span className="text-xs text-argo-textSecondary">
            {requiredAnswered
              ? 'Looks great. Click Build to generate the stack.'
              : `Answer the required questions to continue.`}
          </span>
          <button
            type="button"
            onClick={onFinalize}
            disabled={!requiredAnswered}
            className="inline-flex items-center gap-2 rounded-full bg-argo-accent text-argo-bg px-5 py-2.5 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-argo-accent/90 transition-colors"
          >
            Build the stack <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function FinalizingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="m-auto text-center"
    >
      <Loader2 className="h-8 w-8 text-argo-accent animate-spin mx-auto mb-6" />
      <div className="text-argo-text argo-hero text-xl">Compiling the build brief…</div>
    </motion.div>
  );
}

function DoneState({ buildPrompt }: { buildPrompt: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="m-auto max-w-2xl text-center px-8"
    >
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-argo-green/15 mb-4">
        <Check className="h-6 w-6 text-argo-green" />
      </div>
      <div className="text-argo-text argo-hero text-2xl mb-2">Brief compiled.</div>
      <div className="text-argo-textSecondary text-sm argo-body">
        Argo handed the brief to the build agent. Watch the files appear in the panel above —
        the auto-fix loop will run quality checks and re-prompt GPT-5.5 if any fail.
      </div>
      <details className="mt-6 text-left">
        <summary className="text-xs text-argo-textSecondary cursor-pointer hover:text-argo-text">
          Show the brief that was sent to GPT-5.5
        </summary>
        <pre className="mt-3 text-[11px] text-argo-textSecondary bg-argo-surface border border-argo-border rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
          {buildPrompt}
        </pre>
      </details>
    </motion.div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="m-auto max-w-md text-center px-8"
    >
      <div className="text-argo-amber text-sm mb-3">Scoping failed.</div>
      <div className="text-argo-textSecondary text-xs font-mono mb-6">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-argo-accent text-argo-bg px-5 py-2 font-medium"
      >
        Try again
      </button>
    </motion.div>
  );
}

// ── The per-question control switcher ──────────────────────────────────

function QuestionAnswerControl({
  question,
  answer,
  onChange,
}: {
  question: ScopingQuestion;
  answer: QuestionAnswer | undefined;
  onChange: (a: QuestionAnswer) => void;
}) {
  if (
    question.kind === 'single_choice' ||
    question.kind === 'pick_one_of_recommended' ||
    question.kind === 'multi_choice'
  ) {
    const isMulti = question.kind === 'multi_choice';
    const selected = new Set(answer?.selectedOptionIds ?? []);
    const toggle = (id: string) => {
      const next = new Set(isMulti ? selected : []);
      if (selected.has(id) && isMulti) next.delete(id);
      else next.add(id);
      onChange({ questionId: question.id, selectedOptionIds: Array.from(next) });
    };
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {question.options.map((opt) => {
          const isSelected = selected.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={cn(
                'group relative text-left rounded-lg border px-4 py-3 transition-all',
                isSelected
                  ? 'border-argo-accent bg-argo-accent/10'
                  : 'border-argo-border bg-argo-bg hover:border-argo-accent/40 hover:bg-argo-surface',
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    'flex-shrink-0 mt-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full border',
                    isSelected
                      ? 'border-argo-accent bg-argo-accent text-argo-bg'
                      : 'border-argo-border',
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                <div className="flex-1">
                  <div className="text-sm text-argo-text font-medium flex items-center gap-1.5">
                    {opt.label}
                    {opt.recommended && (
                      <span
                        title="Argo's recommendation"
                        className="inline-flex items-center gap-0.5 text-[10px] text-argo-accent border border-argo-accent/30 bg-argo-accent/10 rounded px-1 py-0.5"
                      >
                        <Star className="h-2.5 w-2.5" /> recommended
                      </span>
                    )}
                  </div>
                  {opt.hint && (
                    <div className="text-xs text-argo-textSecondary mt-0.5 argo-body">{opt.hint}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.kind === 'long_text') {
    return (
      <textarea
        value={answer?.textValue ?? ''}
        onChange={(e) => onChange({ questionId: question.id, selectedOptionIds: [], textValue: e.target.value })}
        placeholder={question.placeholder ?? 'Write here…'}
        rows={3}
        className="w-full rounded-lg border border-argo-border bg-argo-bg px-3 py-2 text-sm text-argo-text placeholder:text-argo-textSecondary focus:border-argo-accent focus:outline-none"
      />
    );
  }

  // short_text or numeric
  return (
    <input
      type={question.kind === 'numeric' ? 'number' : 'text'}
      value={answer?.textValue ?? ''}
      onChange={(e) => onChange({ questionId: question.id, selectedOptionIds: [], textValue: e.target.value })}
      placeholder={question.placeholder ?? ''}
      className="w-full rounded-lg border border-argo-border bg-argo-bg px-3 py-2 text-sm text-argo-text placeholder:text-argo-textSecondary focus:border-argo-accent focus:outline-none"
    />
  );
}

function isAnswered(q: ScopingQuestion, a: QuestionAnswer | undefined): boolean {
  if (!a) return false;
  if (
    q.kind === 'single_choice' ||
    q.kind === 'pick_one_of_recommended' ||
    q.kind === 'multi_choice'
  ) {
    return a.selectedOptionIds.length > 0;
  }
  return Boolean(a.textValue && a.textValue.trim().length > 0);
}
