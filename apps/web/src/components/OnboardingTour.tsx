// Onboarding tour — 90-second first-run carousel that walks the operator
// through the four moves they'll make in a typical session: scope → build
// → preview → operate-from-email. Dismisses to localStorage so it doesn't
// re-fire after the operator clicks "Got it".

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Inbox,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

const STORAGE_KEY = 'argo:onboarding:dismissed:v1';

interface Step {
  icon: typeof Sparkles;
  eyebrow: string;
  title: string;
  body: string;
  bullet: string[];
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    eyebrow: 'Step 1',
    title: 'Describe your workflow in one sentence.',
    body: 'Argo asks 4–6 click-through questions to scope the brief. No typing past the first sentence.',
    bullet: [
      'Trigger, audience, integrations, voice — pick from cards.',
      'Recommended option is starred per question.',
      'Takes 30 seconds even on a tablet.',
    ],
  },
  {
    icon: Wand2,
    eyebrow: 'Step 2',
    title: 'Argo builds the production stack.',
    body: 'GPT-5.5 writes typed Fastify routes with Zod validation, escapeForEmail outbound, and observability. The 33-check quality gate auto-fixes any failure before deploy.',
    bullet: [
      'One specialist persona per archetype (12 to choose from).',
      'Reference snippets cribbed from real production code.',
      'Up to 3 auto-fix cycles to clear the gate.',
    ],
  },
  {
    icon: Eye,
    eyebrow: 'Step 3',
    title: 'See it run inside the workspace.',
    body: 'Preview tab streams the live Blaxel-hosted form in a desktop / tablet / mobile frame. Code tab shows everything Argo wrote, syntax-highlighted. Diff tab shows what changed between deploys.',
    bullet: [
      'Refresh / restart / rebuild from the toolbar.',
      'Replay tab — every agent invocation is auditable.',
      'Inbox tab — search & filter notifications.',
    ],
  },
  {
    icon: Inbox,
    eyebrow: 'Step 4',
    title: 'Operate it from email.',
    body: 'You don\'t open Argo daily. Approve emails arrive when a decision is needed; the Monday digest summarises the week as prose. Your business runs while you sleep.',
    bullet: [
      'Approve / Edit / Decline — three buttons, never more.',
      'Trust ratchet: first 10 sends per template are gated.',
      'When something breaks, Argo proposes a repair via email.',
    ],
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (!dismissed) setOpen(true);
  }, []);

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }
    setOpen(false);
  }
  function next() {
    if (stepIndex >= STEPS.length - 1) {
      dismiss();
      return;
    }
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }

  if (!open) return null;
  const step = STEPS[stepIndex]!;
  const Icon = step.icon;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-sm p-6"
        >
          <motion.div
            key={stepIndex}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-xl rounded-2xl border border-argo-border bg-argo-surface shadow-2xl shadow-black/40 overflow-hidden"
          >
            <div className="relative p-8">
              <button
                type="button"
                onClick={dismiss}
                aria-label="Skip tour"
                className="absolute top-4 right-4 text-argo-textSecondary hover:text-argo-text"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-argo-accent/15 text-argo-accent mb-4">
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-xs uppercase tracking-widest text-argo-accent font-mono mb-1">
                {step.eyebrow}
              </div>
              <h2
                className="argo-hero text-2xl text-argo-text mb-2"
                style={{ letterSpacing: '-0.05em', lineHeight: 1.1 }}
              >
                {step.title}
              </h2>
              <p className="text-argo-textSecondary argo-body text-sm mb-5">{step.body}</p>

              <ul className="space-y-1.5 mb-6">
                {step.bullet.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-argo-text argo-body">
                    <CheckCircle2 className="h-3.5 w-3.5 text-argo-accent flex-shrink-0 mt-1" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {STEPS.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 w-8 rounded-full transition-colors',
                        i === stepIndex ? 'bg-argo-accent' : 'bg-argo-border',
                      )}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={dismiss}
                    className="text-xs text-argo-textSecondary hover:text-argo-text"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex items-center gap-1.5 rounded-full bg-argo-accent text-argo-bg px-4 py-1.5 text-sm font-medium hover:bg-argo-accent/90 transition-colors"
                  >
                    {stepIndex === STEPS.length - 1 ? 'Get started' : 'Next'}{' '}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
