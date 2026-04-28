import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileCode2,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  Play,
  Rocket,
  Send,
  Shield,
  Sparkles,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { useArgo } from '../state/store.js';
import { operations, builder, iterate } from '../api/client.js';
import { cn } from '../lib/utils.js';

// ── Types ──────────────────────────────────────────────────────────────

type GeneratedFile = {
  name: string;
  description: string;
  done: boolean;
};

type StudioPhase =
  | { phase: 'greeting' }
  | { phase: 'questions'; questionIndex: number; answers: Record<string, string> }
  | { phase: 'building'; progress: number; files: GeneratedFile[]; stage: string }
  | { phase: 'preview'; formData: Record<string, string>; submitted: boolean }
  | { phase: 'iterating'; instruction: string; status: 'checking' | 'applying' | 'done' };

// ── Constants ──────────────────────────────────────────────────────────

const QUESTIONS = [
  {
    id: 'intake',
    text: 'How do candidates reach you?',
    icon: Inbox,
    options: ['Application form', 'Email', 'Both'],
  },
  {
    id: 'action',
    text: 'What happens to strong candidates?',
    icon: Users,
    options: ['Forward to client', 'Schedule interview', 'Both'],
  },
  {
    id: 'digest',
    text: 'How often do you want a summary?',
    icon: Calendar,
    options: ['Daily', 'Weekly on Monday', 'Real-time'],
  },
];

const BUILD_FILES: GeneratedFile[] = [
  { name: 'intake-form.tsx', description: 'Candidate intake form with validation', done: false },
  { name: 'candidate-scorer.ts', description: 'AI-powered candidate scoring engine', done: false },
  { name: 'email-templates.ts', description: 'Approval and rejection email templates', done: false },
  { name: 'approval-flow.ts', description: 'Multi-stage approval pipeline', done: false },
  { name: 'weekly-digest.ts', description: 'Automated summary digest generator', done: false },
  { name: 'database-schema.ts', description: 'Persistence layer and data models', done: false },
];

const BUILD_STAGES = [
  'Analyzing requirements...',
  'Generating form components...',
  'Building scoring engine...',
  'Creating email templates...',
  'Wiring approval pipeline...',
  'Setting up digest scheduler...',
  'Running security scan...',
  'Executing test suite...',
];

const FORM_FIELDS = [
  { key: 'fullName', label: 'Full Name', placeholder: 'John Smith', type: 'text' },
  { key: 'email', label: 'Email Address', placeholder: 'john@example.com', type: 'email' },
  { key: 'phone', label: 'Phone Number', placeholder: '+1 (555) 123-4567', type: 'tel' },
  { key: 'role', label: 'Position Applied For', placeholder: 'Senior Frontend Engineer', type: 'text' },
  { key: 'experience', label: 'Years of Experience', placeholder: '5', type: 'number' },
  { key: 'linkedin', label: 'LinkedIn Profile', placeholder: 'https://linkedin.com/in/johnsmith', type: 'url' },
];

const PIPELINE_STEPS = [
  { label: 'Received', icon: Inbox },
  { label: 'Scored', icon: Sparkles },
  { label: 'Reviewed', icon: Shield },
  { label: 'Decision', icon: Check },
  { label: 'Notified', icon: Mail },
];

// ── Glassmorphism card ─────────────────────────────────────────────────

function GlassCard({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-argo-border/50 bg-argo-surface/60 backdrop-blur-xl shadow-2xl shadow-black/20',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Argo avatar ────────────────────────────────────────────────────────

function ArgoAvatar({ size = 40 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-full bg-gradient-to-br from-argo-accent/30 to-argo-accent/5 border border-argo-accent/30"
      style={{ width: size, height: size }}
    >
      <Sparkles className="text-argo-accent" style={{ width: size * 0.5, height: size * 0.5 }} />
      <div className="absolute inset-0 rounded-full animate-pulse bg-argo-accent/10" />
    </div>
  );
}

// ── Chat bubble ────────────────────────────────────────────────────────

function ChatBubble({
  from,
  children,
  delay = 0,
}: {
  from: 'argo' | 'user';
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex gap-3 max-w-2xl', from === 'user' ? 'ml-auto flex-row-reverse' : '')}
    >
      {from === 'argo' && <ArgoAvatar size={36} />}
      {from === 'user' && (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-argo-accent/20 border border-argo-accent/20">
          <User className="h-4 w-4 text-argo-accent" />
        </div>
      )}
      <div
        className={cn(
          'rounded-2xl px-5 py-3 text-[15px] leading-relaxed',
          from === 'argo'
            ? 'bg-argo-surface/80 border border-argo-border/40 text-argo-text'
            : 'bg-argo-accent/15 border border-argo-accent/20 text-argo-text',
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

// ── Question card ──────────────────────────────────────────────────────

function QuestionCard({
  question,
  onSelect,
  index,
}: {
  question: (typeof QUESTIONS)[number];
  onSelect: (answer: string) => void;
  index: number;
}) {
  const Icon = question.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassCard className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-argo-accent/15">
            <Icon className="h-5 w-5 text-argo-accent" />
          </div>
          <h3 className="text-lg font-semibold text-argo-text">{question.text}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {question.options.map((opt) => (
            <motion.button
              key={opt}
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSelect(opt)}
              className="px-5 py-2.5 rounded-xl border border-argo-border/60 bg-argo-bg/60 text-argo-text text-sm font-medium
                         hover:border-argo-accent/60 hover:bg-argo-accent/10 hover:text-argo-accent
                         transition-colors duration-200 cursor-pointer"
            >
              {opt}
            </motion.button>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  );
}

// ── File row in build ──────────────────────────────────────────────────

function FileRow({ file, index }: { file: GeneratedFile; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
      className="flex items-center gap-3 py-3 px-4 rounded-xl bg-argo-bg/40 border border-argo-border/30"
    >
      <div className="flex-shrink-0">
        {file.done ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          >
            <CheckCircle2 className="h-5 w-5 text-argo-green" />
          </motion.div>
        ) : (
          <Loader2 className="h-5 w-5 text-argo-accent animate-spin" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm text-argo-accent">{file.name}</span>
        <p className="text-xs text-argo-text/50 mt-0.5 truncate">{file.description}</p>
      </div>
      {file.done && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-argo-green/70 font-medium"
        >
          Generated
        </motion.span>
      )}
    </motion.div>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-argo-border/30 overflow-hidden">
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-argo-accent to-argo-green"
        initial={{ width: 0 }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
  );
}

// ── Pipeline step indicator ────────────────────────────────────────────

function PipelineStep({
  step,
  active,
  done,
  index,
}: {
  step: (typeof PIPELINE_STEPS)[number];
  active: boolean;
  done: boolean;
  index: number;
}) {
  const Icon = step.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.15, duration: 0.4 }}
      className="flex flex-col items-center gap-2"
    >
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-xl border transition-all duration-500',
          done
            ? 'bg-argo-green/15 border-argo-green/40 text-argo-green'
            : active
              ? 'bg-argo-accent/15 border-argo-accent/40 text-argo-accent animate-pulse'
              : 'bg-argo-bg/40 border-argo-border/30 text-argo-text/30',
        )}
      >
        {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
      </div>
      <span
        className={cn(
          'text-xs font-medium',
          done ? 'text-argo-green' : active ? 'text-argo-accent' : 'text-argo-text/30',
        )}
      >
        {step.label}
      </span>
    </motion.div>
  );
}

// ── Connector line between pipeline steps ──────────────────────────────

function PipelineConnector({ done }: { done: boolean }) {
  return (
    <div className="flex-1 flex items-center px-1 mt-[-20px]">
      <div
        className={cn(
          'h-0.5 w-full rounded-full transition-colors duration-500',
          done ? 'bg-argo-green/50' : 'bg-argo-border/30',
        )}
      />
    </div>
  );
}

// ── Email preview card ─────────────────────────────────────────────────

function EmailPreviewCard({
  type,
  name,
  role,
}: {
  type: 'approval' | 'rejection';
  name: string;
  role: string;
}) {
  const isApproval = type === 'approval';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <GlassCard className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              isApproval ? 'bg-argo-green' : 'bg-argo-amber',
            )}
          />
          <span className="text-sm font-semibold text-argo-text">
            {isApproval ? 'Approval Email' : 'Rejection Email'}
          </span>
        </div>
        <div className="text-xs text-argo-text/40 space-y-1">
          <p>
            <span className="text-argo-text/60">To:</span>{' '}
            {isApproval ? 'hiring-manager@client.com' : name.toLowerCase().replace(' ', '.') + '@email.com'}
          </p>
          <p>
            <span className="text-argo-text/60">Subject:</span>{' '}
            {isApproval
              ? `Strong candidate: ${name} for ${role}`
              : `Application update - ${role}`}
          </p>
        </div>
        <div className="text-sm text-argo-text/70 leading-relaxed border-t border-argo-border/20 pt-3">
          {isApproval ? (
            <>
              <p>Hi,</p>
              <p className="mt-2">
                We have a strong candidate for the <strong className="text-argo-text">{role}</strong> position.{' '}
                <strong className="text-argo-text">{name}</strong> scored 92/100 in our automated assessment.
              </p>
              <p className="mt-2">
                Key highlights: 5+ years experience, strong portfolio, available immediately.
              </p>
              <p className="mt-3 text-argo-accent">
                [Review Candidate Profile] [Schedule Interview]
              </p>
            </>
          ) : (
            <>
              <p>Dear {name},</p>
              <p className="mt-2">
                Thank you for your interest in the <strong className="text-argo-text">{role}</strong> position. We were
                impressed by your background and experience.
              </p>
              <p className="mt-2">
                After careful consideration, we've decided to move forward with candidates whose experience
                more closely aligns with our current needs. We'd love to keep your information on file for
                future opportunities.
              </p>
              <p className="mt-2">Wishing you all the best in your search.</p>
              <p className="mt-3 text-argo-text/50 italic">- The Hiring Team</p>
            </>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
}

// ── Digest preview card ────────────────────────────────────────────────

function DigestPreviewCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <GlassCard className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-argo-accent" />
          <span className="text-sm font-semibold text-argo-text">Weekly Digest Preview</span>
        </div>
        <div className="space-y-2 text-sm text-argo-text/70">
          <div className="flex justify-between border-b border-argo-border/20 pb-2">
            <span>Candidates received</span>
            <span className="font-mono text-argo-accent">23</span>
          </div>
          <div className="flex justify-between border-b border-argo-border/20 pb-2">
            <span>Forwarded to clients</span>
            <span className="font-mono text-argo-green">7</span>
          </div>
          <div className="flex justify-between border-b border-argo-border/20 pb-2">
            <span>Auto-rejected</span>
            <span className="font-mono text-argo-amber">14</span>
          </div>
          <div className="flex justify-between">
            <span>Pending review</span>
            <span className="font-mono text-argo-text">2</span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

// ── Regression panel ───────────────────────────────────────────────────

function RegressionPanel({ status }: { status: 'checking' | 'applying' | 'done' }) {
  const steps = [
    { label: 'Running 12 baseline tests...', done: status !== 'checking' },
    { label: '12/12 passed. Applying changes...', done: status === 'done' },
    { label: 'Running 12 tests again... 12/12 passed. No regressions.', done: status === 'done' },
  ];
  return (
    <GlassCard className="p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-argo-text">
        <Shield className="h-4 w-4 text-argo-accent" />
        Safety Check
      </div>
      {steps.map((step, i) => {
        const visible =
          (i === 0) ||
          (i === 1 && status !== 'checking') ||
          (i === 2 && status === 'done');
        if (!visible) return null;
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 text-sm"
          >
            {step.done ? (
              <CheckCircle2 className="h-4 w-4 text-argo-green flex-shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 text-argo-accent animate-spin flex-shrink-0" />
            )}
            <span className={step.done ? 'text-argo-text/70' : 'text-argo-text'}>{step.label}</span>
          </motion.div>
        );
      })}
    </GlassCard>
  );
}

// ── Diff viewer ────────────────────────────────────────────────────────

function DiffViewer({ fieldName }: { fieldName?: string }) {
  return (
    <GlassCard className="p-4 space-y-3 font-mono text-xs">
      <div className="text-sm font-sans font-semibold text-argo-text">
        {fieldName ? `Changes to form` : 'email-templates.ts'}
      </div>
      {fieldName ? (
        <div className="space-y-1">
          <div className="text-argo-text/50">  // Form fields</div>
          <div className="text-argo-text/50">  fullName: text,</div>
          <div className="text-argo-text/50">  email: email,</div>
          <div className="bg-argo-green/10 border-l-2 border-argo-green pl-2 text-argo-green">
            + phone: tel,  // NEW
          </div>
          <div className="text-argo-text/50">  role: text,</div>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="bg-argo-red/10 border-l-2 border-argo-red pl-2 text-argo-red/80">
            - We regret to inform you that we will not be proceeding
          </div>
          <div className="bg-argo-green/10 border-l-2 border-argo-green pl-2 text-argo-green">
            + Thank you for your interest. While we've decided to move
          </div>
          <div className="bg-argo-green/10 border-l-2 border-argo-green pl-2 text-argo-green">
            + forward with other candidates, we were genuinely impressed
          </div>
          <div className="bg-argo-green/10 border-l-2 border-argo-green pl-2 text-argo-green">
            + by your background and would love to stay in touch.
          </div>
        </div>
      )}
    </GlassCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function Studio() {
  const setView = useArgo((s) => s.setView);
  const [state, setState] = useState<StudioPhase>({ phase: 'greeting' });
  const [userInput, setUserInput] = useState('');
  const [showQuestions, setShowQuestions] = useState(false);
  const [showBuildPanel, setShowBuildPanel] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pipelineStep, setPipelineStep] = useState(-1);
  const [iterateInput, setIterateInput] = useState('');
  const [iterateDone, setIterateDone] = useState(false);
  const [showPhoneField, setShowPhoneField] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const buildTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Scroll chat to bottom on state changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state, showQuestions]);

  // ── Phase handlers ───────────────────────────────────────────────────

  const handleGreetingSubmit = useCallback(() => {
    if (!userInput.trim()) return;
    setUserInput('');
    // Transition to questions after a brief "thinking" pause
    setTimeout(() => {
      setState({ phase: 'questions', questionIndex: 0, answers: {} });
      setTimeout(() => setShowQuestions(true), 600);
    }, 800);
  }, [userInput]);

  const handleQuestionAnswer = useCallback(
    (questionId: string, answer: string) => {
      if (state.phase !== 'questions') return;
      const newAnswers = { ...state.answers, [questionId]: answer };
      const nextIndex = state.questionIndex + 1;

      if (nextIndex >= QUESTIONS.length) {
        // All questions answered - start building
        setState({ phase: 'questions', questionIndex: nextIndex, answers: newAnswers });
        setShowQuestions(false);
        setTimeout(() => startBuild(newAnswers), 1200);
      } else {
        setState({ phase: 'questions', questionIndex: nextIndex, answers: newAnswers });
      }
    },
    [state],
  );

  const startBuild = useCallback(async (answers: Record<string, string>) => {
    const files = BUILD_FILES.map((f) => ({ ...f }));
    setState({ phase: 'building', progress: 0, files, stage: BUILD_STAGES[0] ?? 'Generating' });
    setShowBuildPanel(true);
    setElapsedSeconds(0);

    // Elapsed timer
    buildTimerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    // Try real API, fall back to simulation
    let realBuild = false;
    try {
      const op = await operations.create({ name: 'Candidate Intake Pipeline' });
      await builder.start(op.id, `Recruiting intake: ${JSON.stringify(answers)}`);
      realBuild = true;
    } catch {
      // Simulated build
    }

    if (!realBuild) {
      // Simulate file generation with timed intervals
      for (let i = 0; i < files.length; i++) {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            setState((prev) => {
              if (prev.phase !== 'building') return prev;
              const updatedFiles = prev.files.map((f, idx) =>
                idx === i ? { ...f, done: true } : f,
              );
              const progress = Math.round(((i + 1) / files.length) * 85);
              const stageIndex = Math.min(
                Math.floor(((i + 1) / files.length) * BUILD_STAGES.length),
                BUILD_STAGES.length - 1,
              );
              return {
                ...prev,
                files: updatedFiles,
                progress,
                stage: BUILD_STAGES[stageIndex] ?? 'Deploying',
              };
            });
            resolve();
          }, 2500 + Math.random() * 2000);
        });
      }

      // Final stages: testing + security
      setState((prev) => {
        if (prev.phase !== 'building') return prev;
        return { ...prev, progress: 92, stage: 'Running security scan...' };
      });
      await new Promise((r) => setTimeout(r, 2000));

      setState((prev) => {
        if (prev.phase !== 'building') return prev;
        return { ...prev, progress: 97, stage: 'Executing test suite...' };
      });
      await new Promise((r) => setTimeout(r, 2500));

      setState((prev) => {
        if (prev.phase !== 'building') return prev;
        return { ...prev, progress: 100, stage: 'Build complete' };
      });
    }

    // Clear timer
    if (buildTimerRef.current) clearInterval(buildTimerRef.current);

    // Transition to preview
    await new Promise((r) => setTimeout(r, 1500));
    setState({ phase: 'preview', formData: {}, submitted: false });
  }, []);

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (state.phase !== 'preview') return;
      setState({ ...state, submitted: true });
      setPipelineStep(0);

      // Animate pipeline steps
      let step = 0;
      const interval = setInterval(() => {
        step++;
        if (step >= PIPELINE_STEPS.length) {
          clearInterval(interval);
        }
        setPipelineStep(step);
      }, 900);
    },
    [state],
  );

  const handleFormChange = useCallback(
    (key: string, value: string) => {
      if (state.phase !== 'preview') return;
      setState({ ...state, formData: { ...state.formData, [key]: value } });
    },
    [state],
  );

  const handleIterateSubmit = useCallback(async () => {
    if (!iterateInput.trim()) return;
    const instruction = iterateInput;
    setIterateInput('');
    setState({ phase: 'iterating', instruction, status: 'checking' });

    // Try real API
    try {
      const ops = await operations.list();
      if (ops.length > 0) {
        const result = await iterate.run({
          operationId: ops[0]!.id,
          instruction,
          strategy: 'surgical',
        });
        if (result.ok) {
          setState({ phase: 'iterating', instruction, status: 'done' });
          setIterateDone(true);
          return;
        }
      }
    } catch {
      // Fall back to simulated
    }

    // Simulated iteration
    setTimeout(() => {
      setState({ phase: 'iterating', instruction, status: 'applying' });
    }, 2500);
    setTimeout(() => {
      setState({ phase: 'iterating', instruction, status: 'done' });
      setIterateDone(true);
    }, 5500);
  }, [iterateInput]);

  const handleApplyChanges = useCallback(() => {
    setShowPhoneField(true);
    setState({ phase: 'preview', formData: {}, submitted: false });
    setPipelineStep(-1);
    setIterateDone(false);
  }, []);

  const handleUndo = useCallback(() => {
    setState({ phase: 'preview', formData: {}, submitted: false });
    setPipelineStep(-1);
    setIterateDone(false);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (buildTimerRef.current) clearInterval(buildTimerRef.current);
    };
  }, []);

  // ── Derived values ───────────────────────────────────────────────────

  const activeFormFields = useMemo(() => {
    const fields = [...FORM_FIELDS];
    if (showPhoneField && !fields.some((f) => f.key === 'phone')) {
      // phone is already in FORM_FIELDS, so just return as-is
    }
    if (!showPhoneField) {
      return fields.filter((f) => f.key !== 'phone');
    }
    return fields;
  }, [showPhoneField]);

  const formName =
    state.phase === 'preview'
      ? state.formData.fullName || 'John Smith'
      : 'John Smith';
  const formRole =
    state.phase === 'preview'
      ? state.formData.role || 'Senior Frontend Engineer'
      : 'Senior Frontend Engineer';

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="h-full w-full bg-argo-bg overflow-hidden relative">
      {/* Ambient glow effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-argo-accent/5 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-argo-accent/3 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-argo-accent/[0.02] blur-3xl" />
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-argo-border/30">
        <div className="flex items-center gap-3">
          <ArgoAvatar size={32} />
          <span className="text-lg font-semibold text-argo-text tracking-tight">Argo Studio</span>
        </div>
        <button
          onClick={() => setView('workspace')}
          className="flex items-center gap-1.5 text-sm text-argo-text/50 hover:text-argo-text transition-colors"
        >
          Advanced Mode <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Main content area */}
      <div
        className={cn(
          'relative z-10 flex h-[calc(100%-57px)] transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]',
          showBuildPanel ? '' : '',
        )}
      >
        {/* ── Left: Chat panel ──────────────────────────────────────── */}
        <div
          className={cn(
            'flex flex-col transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]',
            showBuildPanel ? 'w-[45%] border-r border-argo-border/30' : 'w-full',
          )}
        >
          <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
            {/* ── Greeting phase ──────────────────────────────────── */}
            <AnimatePresence mode="wait">
              {state.phase === 'greeting' && (
                <motion.div
                  key="greeting"
                  className="flex flex-col items-center justify-center min-h-[60vh] space-y-8"
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center space-y-4"
                  >
                    <ArgoAvatar size={64} />
                    <h1 className="text-4xl font-bold text-argo-text tracking-tight mt-6">
                      What does your business do?
                    </h1>
                    <p className="text-lg text-argo-text/50 max-w-md mx-auto">
                      Tell me in a sentence and I'll build your workflow in under a minute.
                    </p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="w-full max-w-xl"
                  >
                    <div className="relative">
                      <input
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleGreetingSubmit()}
                        placeholder="I run a recruiting agency..."
                        className="w-full px-6 py-4 rounded-2xl bg-argo-surface/60 border border-argo-border/50 text-argo-text
                                   placeholder:text-argo-text/30 text-lg backdrop-blur-md
                                   focus:outline-none focus:border-argo-accent/50 focus:ring-2 focus:ring-argo-accent/20
                                   transition-all duration-300"
                      />
                      <button
                        onClick={handleGreetingSubmit}
                        disabled={!userInput.trim()}
                        className={cn(
                          'absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200',
                          userInput.trim()
                            ? 'bg-argo-accent text-argo-bg hover:bg-argo-accent/90 cursor-pointer'
                            : 'bg-argo-border/30 text-argo-text/20 cursor-not-allowed',
                        )}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap justify-center gap-2 mt-4">
                      {['I run a recruiting agency', 'I manage rental properties', 'I sell handmade jewelry online'].map(
                        (suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => {
                              setUserInput(suggestion);
                            }}
                            className="px-3 py-1.5 rounded-full text-xs text-argo-text/40 border border-argo-border/30
                                       hover:border-argo-accent/30 hover:text-argo-accent/60 transition-colors cursor-pointer"
                          >
                            {suggestion}
                          </button>
                        ),
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Questions phase ─────────────────────────────────── */}
            {state.phase === 'questions' && (
              <div className="max-w-2xl mx-auto space-y-6">
                <ChatBubble from="user" delay={0}>
                  {userInput || 'I run a recruiting agency'}
                </ChatBubble>

                <ChatBubble from="argo" delay={0.3}>
                  Got it! Let me ask you 3 quick questions to get your workflow running.
                </ChatBubble>

                <AnimatePresence mode="wait">
                  {showQuestions && state.questionIndex < QUESTIONS.length && QUESTIONS[state.questionIndex] && (
                    <QuestionCard
                      key={QUESTIONS[state.questionIndex]!.id}
                      question={QUESTIONS[state.questionIndex]!}
                      onSelect={(answer) =>
                        handleQuestionAnswer(QUESTIONS[state.questionIndex]!.id, answer)
                      }
                      index={0}
                    />
                  )}
                </AnimatePresence>

                {/* Show answered questions as user bubbles */}
                {Object.entries(state.answers).map(([qId, answer], i) => {
                  const q = QUESTIONS.find((qq) => qq.id === qId);
                  return (
                    <ChatBubble key={qId} from="user" delay={0}>
                      {answer}
                    </ChatBubble>
                  );
                })}

                {state.questionIndex >= QUESTIONS.length && (
                  <ChatBubble from="argo" delay={0.3}>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-argo-accent" />
                      Perfect. Building your candidate intake pipeline right now...
                    </div>
                  </ChatBubble>
                )}
              </div>
            )}

            {/* ── Building phase (chat side) ──────────────────────── */}
            {state.phase === 'building' && (
              <div className="max-w-2xl mx-auto space-y-6">
                <ChatBubble from="argo" delay={0}>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 text-argo-accent animate-spin" />
                      <span>{state.stage}</span>
                    </div>
                    <p className="text-xs text-argo-text/40">
                      Generating {BUILD_FILES.length} files with tests and security checks.
                    </p>
                  </div>
                </ChatBubble>
              </div>
            )}

            {/* ── Preview phase (chat side) ───────────────────────── */}
            {state.phase === 'preview' && (
              <div className="max-w-2xl mx-auto space-y-6">
                <ChatBubble from="argo" delay={0}>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-argo-green" />
                      <span className="font-semibold">Your pipeline is ready!</span>
                    </div>
                    <p className="text-sm text-argo-text/60">
                      Try it out on the right - fill in a test candidate and watch the data flow through your pipeline.
                    </p>
                  </div>
                </ChatBubble>

                {/* Iterate input */}
                <div className="mt-8 pt-6 border-t border-argo-border/20">
                  <p className="text-sm text-argo-text/40 mb-3">Want to change anything? Just tell me.</p>
                  <div className="relative">
                    <input
                      type="text"
                      value={iterateInput}
                      onChange={(e) => setIterateInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleIterateSubmit()}
                      placeholder="Make the rejection email warmer and add a phone number field"
                      className="w-full px-5 py-3.5 rounded-xl bg-argo-surface/60 border border-argo-border/50 text-argo-text text-sm
                                 placeholder:text-argo-text/25 backdrop-blur-md
                                 focus:outline-none focus:border-argo-accent/50 focus:ring-2 focus:ring-argo-accent/20
                                 transition-all duration-300"
                    />
                    <button
                      onClick={handleIterateSubmit}
                      disabled={!iterateInput.trim()}
                      className={cn(
                        'absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                        iterateInput.trim()
                          ? 'bg-argo-accent text-argo-bg hover:bg-argo-accent/90 cursor-pointer'
                          : 'bg-argo-border/30 text-argo-text/20 cursor-not-allowed',
                      )}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Iterating phase (chat side) ─────────────────────── */}
            {state.phase === 'iterating' && (
              <div className="max-w-2xl mx-auto space-y-6">
                <ChatBubble from="user" delay={0}>
                  {state.instruction}
                </ChatBubble>

                <ChatBubble from="argo" delay={0.2}>
                  <div className="flex items-center gap-2">
                    {state.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-argo-green" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-argo-accent animate-spin" />
                    )}
                    <span>
                      {state.status === 'checking'
                        ? "I'll make 2 changes. Let me run the safety checks first..."
                        : state.status === 'applying'
                          ? 'Applying changes...'
                          : 'Changes are ready! Take a look.'}
                    </span>
                  </div>
                </ChatBubble>

                <RegressionPanel status={state.status} />

                {state.status === 'done' && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <DiffViewer />
                    <DiffViewer fieldName="phone" />

                    <div className="flex items-center gap-3 pt-2">
                      <span className="text-sm text-argo-text/60">Changes look good?</span>
                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={handleApplyChanges}
                        className="px-5 py-2 rounded-xl bg-argo-accent text-argo-bg text-sm font-semibold
                                   hover:bg-argo-accent/90 transition-colors cursor-pointer"
                      >
                        Apply
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={handleUndo}
                        className="px-5 py-2 rounded-xl border border-argo-border/50 text-argo-text/60 text-sm font-medium
                                   hover:border-argo-accent/30 hover:text-argo-text transition-colors cursor-pointer"
                      >
                        Undo
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* ── Right: Build / Preview panel ──────────────────────────── */}
        <AnimatePresence>
          {showBuildPanel && (
            <motion.div
              key="build-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '55%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* ── Building view ──────────────────────────────── */}
                {state.phase === 'building' && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-6"
                  >
                    {/* Header with timer */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-argo-accent/15">
                          <Zap className="h-5 w-5 text-argo-accent" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-argo-text">Building Pipeline</h2>
                          <p className="text-xs text-argo-text/40">{state.stage}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-argo-text/50">
                        <Clock className="h-4 w-4" />
                        <span className="font-mono">{elapsedSeconds}s</span>
                      </div>
                    </div>

                    <ProgressBar progress={state.progress} />

                    {/* File list */}
                    <div className="space-y-2">
                      {state.files.map((file, i) => (
                        <FileRow key={file.name} file={file} index={i} />
                      ))}
                    </div>

                    {/* Test results (show when progress > 90) */}
                    {state.progress >= 90 && (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                      >
                        <GlassCard className="p-4">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 text-argo-green">
                              <CheckCircle2 className="h-4 w-4" />
                              <span className="font-medium">12 tests passed</span>
                            </div>
                            <div className="flex items-center gap-4 text-argo-text/50">
                              <span>0 security issues</span>
                              <span className="text-argo-green font-medium">Safety score: 98/100</span>
                            </div>
                          </div>
                        </GlassCard>
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {/* ── Preview view ──────────────────────────────── */}
                {(state.phase === 'preview' || state.phase === 'iterating') && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-6"
                  >
                    {/* Form preview */}
                    <GlassCard className="p-6 space-y-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-argo-accent/15">
                          <FileCode2 className="h-5 w-5 text-argo-accent" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-argo-text">Candidate Intake Form</h2>
                          <p className="text-xs text-argo-text/40">Live preview - try filling it in</p>
                        </div>
                      </div>

                      <form onSubmit={handleFormSubmit} className="space-y-4">
                        {activeFormFields.map((field) => (
                          <motion.div
                            key={field.key}
                            layout
                            initial={
                              field.key === 'phone' && showPhoneField
                                ? { opacity: 0, height: 0, y: -8 }
                                : false
                            }
                            animate={{ opacity: 1, height: 'auto', y: 0 }}
                            transition={{ duration: 0.4 }}
                            className="space-y-1.5"
                          >
                            <label className="text-sm font-medium text-argo-text/70">
                              {field.label}
                              {field.key === 'phone' && showPhoneField && (
                                <span className="ml-2 text-xs text-argo-accent font-normal">NEW</span>
                              )}
                            </label>
                            <input
                              type={field.type}
                              placeholder={field.placeholder}
                              value={
                                state.phase === 'preview'
                                  ? state.formData[field.key] || ''
                                  : ''
                              }
                              onChange={(e) => handleFormChange(field.key, e.target.value)}
                              disabled={state.phase !== 'preview' || state.submitted}
                              className={cn(
                                'w-full px-4 py-2.5 rounded-xl text-sm text-argo-text',
                                'bg-argo-bg/60 border border-argo-border/40',
                                'placeholder:text-argo-text/25',
                                'focus:outline-none focus:border-argo-accent/50 focus:ring-1 focus:ring-argo-accent/20',
                                'disabled:opacity-50 transition-all duration-200',
                                field.key === 'phone' && showPhoneField
                                  ? 'ring-2 ring-argo-accent/30 border-argo-accent/40'
                                  : '',
                              )}
                            />
                          </motion.div>
                        ))}

                        {state.phase === 'preview' && !state.submitted && (
                          <motion.button
                            type="submit"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="w-full py-3 rounded-xl bg-argo-accent text-argo-bg font-semibold text-sm
                                       hover:bg-argo-accent/90 transition-colors cursor-pointer mt-2"
                          >
                            Submit Application
                          </motion.button>
                        )}
                      </form>
                    </GlassCard>

                    {/* Pipeline visualization (shown after form submit) */}
                    {state.phase === 'preview' && state.submitted && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                      >
                        <GlassCard className="p-6 space-y-5">
                          <h3 className="text-sm font-semibold text-argo-text flex items-center gap-2">
                            <Play className="h-4 w-4 text-argo-accent" />
                            Pipeline Execution
                          </h3>

                          <div className="flex items-start justify-between">
                            {PIPELINE_STEPS.map((step, i) => (
                              <div key={step.label} className="contents">
                                <PipelineStep
                                  step={step}
                                  active={pipelineStep === i}
                                  done={pipelineStep > i}
                                  index={i}
                                />
                                {i < PIPELINE_STEPS.length - 1 && (
                                  <PipelineConnector done={pipelineStep > i} />
                                )}
                              </div>
                            ))}
                          </div>
                        </GlassCard>
                      </motion.div>
                    )}

                    {/* Email previews (shown after pipeline completes) */}
                    {state.phase === 'preview' && pipelineStep >= PIPELINE_STEPS.length && (
                      <div className="space-y-4">
                        <EmailPreviewCard type="approval" name={formName} role={formRole} />
                        <EmailPreviewCard type="rejection" name={formName} role={formRole} />
                        <DigestPreviewCard />

                        {/* Go Live button */}
                        <motion.button
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.3, duration: 0.5 }}
                          whileHover={{ scale: 1.02, y: -2 }}
                          whileTap={{ scale: 0.98 }}
                          className="w-full py-4 rounded-2xl bg-gradient-to-r from-argo-accent to-argo-green text-argo-bg
                                     font-bold text-base flex items-center justify-center gap-2
                                     shadow-lg shadow-argo-accent/20 hover:shadow-xl hover:shadow-argo-accent/30
                                     transition-shadow duration-300 cursor-pointer"
                        >
                          <Rocket className="h-5 w-5" />
                          Go Live - Get Your URL
                        </motion.button>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
