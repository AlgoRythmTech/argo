// LiveFormPreview — renders a fully interactive, styled form preview that
// looks like a real production form. Embedded directly in the page (no iframe).
// After submission, shows an animated pipeline visualization with AI screening
// results, score ring, and email preview.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ChevronRight,
  FileUp,
  Loader2,
  Mail,
  Send,
  Shield,
  Sparkles,
  Star,
  User,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FormField {
  id: string;
  label: string;
  type:
    | 'text'
    | 'email'
    | 'phone'
    | 'textarea'
    | 'select'
    | 'file'
    | 'url'
    | 'number'
    | 'date';
  placeholder?: string;
  required?: boolean;
  options?: string[]; // for select fields
}

export interface SubmissionResult {
  status: 'screening' | 'approved' | 'rejected';
  score?: number;
  message?: string;
  emailPreview?: { subject: string; body: string; to: string };
}

export interface LiveFormPreviewProps {
  operationName: string;
  fields: FormField[];
  brandColor?: string;
  onSubmit?: (data: Record<string, string>) => void;
  submitted?: boolean;
  submissionResult?: SubmissionResult;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_BRAND = '#00e5cc';

const PIPELINE_STEPS = [
  'Submit',
  'AI Screening',
  'Score',
  'Email Sent',
  'Approval Requested',
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Validate a single field value. Returns an error string or null. */
function validateField(field: FormField, value: string): string | null {
  if (field.required && !value.trim()) return `${field.label} is required`;
  if (!value.trim()) return null;

  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return 'Please enter a valid email address';
  if (field.type === 'phone' && !/^[+\d\s()-]{7,}$/.test(value))
    return 'Please enter a valid phone number';
  if (field.type === 'url' && !/^https?:\/\/.+\..+/.test(value))
    return 'Please enter a valid URL';
  if (field.type === 'number' && isNaN(Number(value)))
    return 'Please enter a valid number';

  return null;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Animated circular progress ring used for the AI score display. */
function ScoreRing({
  score,
  size = 120,
  brandColor,
}: {
  score: number;
  size?: number;
  brandColor: string;
}) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={brandColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.4, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-2xl font-bold text-white"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 0.4 }}
        >
          {score}
        </motion.span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-400">
          / 100
        </span>
      </div>
    </div>
  );
}

/** Pipeline step indicator — horizontal chain of steps that light up. */
function PipelineSteps({
  activeStep,
  score,
  brandColor,
}: {
  activeStep: number;
  score?: number;
  brandColor: string;
}) {
  return (
    <div className="flex items-center justify-center gap-1 py-6">
      {PIPELINE_STEPS.map((label, i) => {
        const isActive = i <= activeStep;
        const displayLabel =
          label === 'Score' && score != null ? `Score: ${score}/100` : label;

        return (
          <div key={label} className="flex items-center gap-1">
            <motion.div
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'text-white'
                  : 'bg-zinc-800 text-zinc-500',
              )}
              style={isActive ? { backgroundColor: `${brandColor}22`, color: brandColor } : undefined}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.6 + 0.2, duration: 0.35 }}
            >
              {isActive ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: i * 0.6 + 0.35, type: 'spring' }}
                >
                  <CheckCircle2 size={13} />
                </motion.div>
              ) : (
                <div className="h-3.5 w-3.5 rounded-full border border-zinc-600" />
              )}
              {displayLabel}
            </motion.div>
            {i < PIPELINE_STEPS.length - 1 && (
              <ChevronRight
                size={14}
                className={cn(
                  'transition-colors',
                  isActive ? 'text-zinc-400' : 'text-zinc-700',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Email preview card shown after submission. */
function EmailPreviewCard({
  emailPreview,
}: {
  emailPreview: { subject: string; body: string; to: string };
}) {
  return (
    <motion.div
      className="mx-auto mt-4 max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800/60"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 3.4, duration: 0.5 }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-800 px-4 py-2.5">
        <Mail size={14} className="text-zinc-400" />
        <span className="text-xs font-medium text-zinc-300">
          Email Preview
        </span>
      </div>
      <div className="space-y-2.5 p-4 text-sm">
        <div className="flex gap-2 text-zinc-400">
          <span className="w-12 shrink-0 text-right text-xs font-medium uppercase tracking-wide">
            To
          </span>
          <span className="text-zinc-200">{emailPreview.to}</span>
        </div>
        <div className="flex gap-2 text-zinc-400">
          <span className="w-12 shrink-0 text-right text-xs font-medium uppercase tracking-wide">
            Subj
          </span>
          <span className="font-medium text-white">{emailPreview.subject}</span>
        </div>
        <div className="mt-3 rounded border border-zinc-700 bg-zinc-900/50 p-3 text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap">
          {emailPreview.body}
        </div>
      </div>
    </motion.div>
  );
}

/** Green sparkles that float up — used for the "approved" celebration. */
function Sparkle({ delay, x }: { delay: number; x: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute"
      style={{ left: `${x}%`, bottom: 0 }}
      initial={{ opacity: 0, y: 0, scale: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        y: [0, -60, -120, -160],
        scale: [0, 1, 0.8, 0],
        rotate: [0, 45, 90, 135],
      }}
      transition={{ duration: 2, delay, ease: 'easeOut' }}
    >
      <Sparkles size={16} className="text-emerald-400" />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function LiveFormPreview({
  operationName,
  fields,
  brandColor = DEFAULT_BRAND,
  onSubmit,
  submitted = false,
  submissionResult,
}: LiveFormPreviewProps) {
  /* ----- form state ----- */
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(-1);
  const [processingDots, setProcessingDots] = useState('');

  /* animate dots while processing */
  useEffect(() => {
    if (!submitted || showResult) return;
    const id = setInterval(
      () => setProcessingDots((d) => (d.length >= 3 ? '' : d + '.')),
      500,
    );
    return () => clearInterval(id);
  }, [submitted, showResult]);

  /* pipeline step progression */
  useEffect(() => {
    if (!submitted) return;
    setPipelineStep(-1);

    const timers: ReturnType<typeof setTimeout>[] = [];
    PIPELINE_STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setPipelineStep(i), (i + 1) * 600));
    });
    timers.push(setTimeout(() => setShowResult(true), PIPELINE_STEPS.length * 600 + 400));

    return () => timers.forEach(clearTimeout);
  }, [submitted]);

  /* ----- handlers ----- */
  const handleChange = useCallback(
    (id: string, value: string) => {
      setValues((v) => ({ ...v, [id]: value }));
      if (touched[id]) {
        const field = fields.find((f) => f.id === id);
        if (field) {
          const err = validateField(field, value);
          setErrors((e) => {
            const next = { ...e };
            if (err) next[id] = err;
            else delete next[id];
            return next;
          });
        }
      }
    },
    [fields, touched],
  );

  const handleBlur = useCallback(
    (id: string) => {
      setTouched((t) => ({ ...t, [id]: true }));
      const field = fields.find((f) => f.id === id);
      if (field) {
        const err = validateField(field, values[id] ?? '');
        setErrors((e) => {
          const next = { ...e };
          if (err) next[id] = err;
          else delete next[id];
          return next;
        });
      }
    },
    [fields, values],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // validate all fields
      const newErrors: Record<string, string> = {};
      const allTouched: Record<string, boolean> = {};
      for (const field of fields) {
        allTouched[field.id] = true;
        const err = validateField(field, values[field.id] ?? '');
        if (err) newErrors[field.id] = err;
      }
      setTouched(allTouched);
      setErrors(newErrors);

      if (Object.keys(newErrors).length > 0) return;

      setIsSubmitting(true);
      onSubmit?.(values);
    },
    [fields, values, onSubmit],
  );

  /* reset submitting spinner once external `submitted` prop flips */
  useEffect(() => {
    if (submitted) setIsSubmitting(false);
  }, [submitted]);

  const hasErrors = Object.keys(errors).length > 0;

  /* matched skills (mock data derived from fields) */
  const matchedSkills = useMemo(() => {
    const skills: string[] = [];
    if (fields.some((f) => f.type === 'email')) skills.push('Email Communication');
    if (fields.some((f) => f.type === 'url')) skills.push('Web Presence');
    if (fields.some((f) => f.type === 'file')) skills.push('Document Handling');
    if (fields.some((f) => f.type === 'phone')) skills.push('Direct Contact');
    if (fields.some((f) => f.type === 'textarea')) skills.push('Written Expression');
    if (fields.some((f) => f.type === 'select')) skills.push('Categorical Fit');
    if (skills.length === 0) skills.push('Core Requirements');
    return skills;
  }, [fields]);

  /* ----- render helpers ----- */
  const inputClasses = cn(
    'w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-zinc-900',
    'outline-none transition-all duration-200',
    'placeholder:text-zinc-400',
    'border-zinc-200 focus:border-transparent focus:ring-2',
  );

  const renderField = (field: FormField) => {
    const value = values[field.id] ?? '';
    const error = touched[field.id] ? errors[field.id] : undefined;
    const ringColor = error ? 'focus:ring-red-400' : 'focus:ring-[var(--brand)]';

    const commonProps = {
      id: field.id,
      value,
      placeholder: field.placeholder ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        handleChange(field.id, e.target.value),
      onBlur: () => handleBlur(field.id),
      disabled: submitted || isSubmitting,
      'aria-invalid': !!error,
    };

    let input: React.ReactNode;
    switch (field.type) {
      case 'textarea':
        input = (
          <textarea
            {...commonProps}
            rows={4}
            className={cn(inputClasses, ringColor, 'resize-none')}
          />
        );
        break;
      case 'select':
        input = (
          <select
            {...commonProps}
            className={cn(inputClasses, ringColor, 'appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat', !value && 'text-zinc-400')}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")",
            }}
          >
            <option value="">{field.placeholder || 'Select...'}</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
        break;
      case 'file':
        input = (
          <label
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-100',
              submitted && 'pointer-events-none opacity-50',
            )}
          >
            <FileUp size={16} />
            <span>{values[field.id] || 'Choose a file...'}</span>
            <input
              type="file"
              className="hidden"
              disabled={submitted || isSubmitting}
              onChange={(e) => {
                const name = e.target.files?.[0]?.name ?? '';
                handleChange(field.id, name);
              }}
            />
          </label>
        );
        break;
      default:
        input = (
          <input
            {...commonProps}
            type={field.type === 'phone' ? 'tel' : field.type}
            className={cn(inputClasses, ringColor)}
          />
        );
    }

    return (
      <motion.div
        key={field.id}
        className="space-y-1.5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <label
          htmlFor={field.id}
          className="flex items-center gap-1 text-sm font-medium text-zinc-700"
        >
          {field.label}
          {field.required && <span className="text-red-400">*</span>}
        </label>
        {input}
        <AnimatePresence>
          {error && (
            <motion.p
              className="text-xs text-red-500"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  /* ----- result panel ----- */
  const renderResult = () => {
    if (!submissionResult) return null;
    const { status, score, message, emailPreview } = submissionResult;

    return (
      <motion.div
        className="space-y-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {status === 'screening' && (
          <div className="space-y-5">
            {/* AI Analysis Header */}
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <Shield size={15} style={{ color: brandColor }} />
              AI Screening Analysis
            </div>

            {/* Score + skills row */}
            <div className="flex items-center gap-8">
              {score != null && <ScoreRing score={score} brandColor={brandColor} />}
              <div className="flex-1 space-y-3">
                <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Matched Skills
                </div>
                <div className="flex flex-wrap gap-2">
                  {matchedSkills.map((skill, i) => (
                    <motion.span
                      key={skill}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{ backgroundColor: `${brandColor}18`, color: brandColor }}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 1 + i * 0.15 }}
                    >
                      <Star size={10} />
                      {skill}
                    </motion.span>
                  ))}
                </div>
              </div>
            </div>

            {/* Forwarding message */}
            <motion.div
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-300"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 2.2 }}
            >
              <User size={14} style={{ color: brandColor }} />
              {message || 'Forwarding to hiring manager...'}
            </motion.div>
          </div>
        )}

        {status === 'approved' && (
          <div className="relative overflow-hidden py-4 text-center">
            {/* Sparkles */}
            {Array.from({ length: 12 }).map((_, i) => (
              <Sparkle
                key={i}
                delay={i * 0.12}
                x={8 + Math.random() * 84}
              />
            ))}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            >
              <CheckCircle2 size={48} className="mx-auto text-emerald-400" />
            </motion.div>
            <motion.p
              className="mt-3 text-lg font-semibold text-white"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              Your application has been received!
            </motion.p>
            {message && (
              <motion.p
                className="mt-1.5 text-sm text-zinc-400"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                {message}
              </motion.p>
            )}
          </div>
        )}

        {status === 'rejected' && (
          <div className="space-y-3 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 180, damping: 14 }}
            >
              <XCircle size={40} className="mx-auto text-amber-400" />
            </motion.div>
            <motion.p
              className="text-base font-medium text-zinc-200"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              Thank you for your interest
            </motion.p>
            <motion.p
              className="mx-auto max-w-sm text-sm leading-relaxed text-zinc-400"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {message ||
                'After careful review, we are unable to move forward at this time. We encourage you to apply again in the future.'}
            </motion.p>
          </div>
        )}

        {/* Email preview */}
        {emailPreview && <EmailPreviewCard emailPreview={emailPreview} />}
      </motion.div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div
      className="w-full space-y-4"
      style={{ '--brand': brandColor } as React.CSSProperties}
    >
      {/* ---- Pipeline steps (visible after submission) ---- */}
      <AnimatePresence>
        {submitted && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <PipelineSteps
              activeStep={pipelineStep}
              score={submissionResult?.score}
              brandColor={brandColor}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- The form card ---- */}
      <motion.div
        className={cn(
          'mx-auto w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl shadow-black/20 ring-1 ring-zinc-200/60',
          submitted && 'pointer-events-none',
        )}
        layout
        transition={{ layout: { duration: 0.4, ease: 'easeInOut' } }}
      >
        {/* Header */}
        <div
          className="px-6 py-5"
          style={{
            background: `linear-gradient(135deg, ${brandColor}08, ${brandColor}15)`,
            borderBottom: `1px solid ${brandColor}22`,
          }}
        >
          <h2 className="text-lg font-semibold text-zinc-900">
            {operationName}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Fill out the form below to get started
          </p>
        </div>

        {/* Body */}
        <AnimatePresence mode="wait">
          {!submitted ? (
            <motion.form
              key="form"
              className="space-y-5 px-6 py-6"
              onSubmit={handleSubmit}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
            >
              {fields.map(renderField)}

              {/* Submit button */}
              <motion.button
                type="submit"
                disabled={isSubmitting || hasErrors}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-md transition-all duration-200',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'hover:shadow-lg active:scale-[0.98]',
                )}
                style={{
                  backgroundColor: brandColor,
                  boxShadow: `0 4px 14px ${brandColor}40`,
                }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Submit
                  </>
                )}
              </motion.button>
            </motion.form>
          ) : (
            <motion.div
              key="result"
              className="px-6 py-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              {!showResult ? (
                /* Processing stage */
                <div className="flex flex-col items-center gap-3 py-8">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      repeat: Infinity,
                      duration: 1.2,
                      ease: 'linear',
                    }}
                  >
                    <Loader2 size={32} style={{ color: brandColor }} />
                  </motion.div>
                  <p className="text-sm font-medium text-zinc-700">
                    Processing your submission{processingDots}
                  </p>
                  <p className="text-xs text-zinc-400">
                    Running through AI screening pipeline
                  </p>
                </div>
              ) : (
                /* Result panel — wraps in dark bg since results use dark theme */
                <div className="-mx-6 -mb-6 rounded-b-2xl bg-zinc-900 px-6 py-6">
                  {renderResult()}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="flex items-center justify-center border-t border-zinc-100 bg-zinc-50/60 px-6 py-3">
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Zap size={11} style={{ color: brandColor }} />
            Powered by <span className="font-semibold" style={{ color: brandColor }}>Argo</span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}
