// RecruitingDemo — YC partner demo of Argo's recruiting intake workflow.
// Self-contained, interactive, 8-section walkthrough from candidate
// submission through regression safety. Every section animates in with
// framer-motion staggered reveals on the argo design tokens.

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Mail,
  Play,
  Rocket,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  User,
  UserCheck,
  Zap,
  Phone,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 8;

const CANDIDATE = {
  name: 'Jordan Reeves',
  email: 'jordan.reeves@gmail.com',
  role: 'Senior Frontend Engineer',
  experience: '6 years',
  coverNote:
    "I've been building React applications for 6 years, most recently at Stripe where I led the payments dashboard redesign. I'm passionate about design systems and performance optimization. Previously worked at two early-stage startups where I wore many hats — frontend, some backend, and developer tooling.",
};

const SKILLS_EXTRACTED = [
  'React',
  'TypeScript',
  'Stripe',
  'Dashboard Design',
  'Design Systems',
  'Performance',
];

const ANALYSIS_ITEMS = [
  { label: 'Skills', value: 'React, TypeScript, Stripe, Dashboard Design', icon: Sparkles },
  { label: 'Experience', value: '6 years (matches requirement: 5+)', icon: CheckCircle2 },
  { label: 'Culture fit', value: 'Previous startup + enterprise mix', icon: UserCheck },
  { label: 'Red flags', value: 'None detected', icon: ShieldCheck },
];

const BASELINE_TESTS = [
  'POST /apply returns 201',
  'GET /health returns 200',
  'Zod rejects invalid email',
  'Rate limit blocks burst',
  'Approval link is signed',
  'Digest cron fires weekly',
  'Mongo indexes present',
  'Rejection email sends',
  'Candidate dedup by email',
  'HMAC header validated',
  'XSS escaped in templates',
  'Body limit enforced',
];

// ──────────────────────────────────────────────────────────────────────
// Animation variants
// ──────────────────────────────────────────────────────────────────────

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.12 } },
};

const scaleIn = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
};

// ──────────────────────────────────────────────────────────────────────
// Utility sub-components
// ──────────────────────────────────────────────────────────────────────

function AnimatedCounter({ target, duration = 1.6 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);
  const ref = useRef<number | null>(null);
  const startTime = useRef<number>(0);

  useEffect(() => {
    startTime.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / (duration * 1000), 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        ref.current = requestAnimationFrame(tick);
      }
    };
    ref.current = requestAnimationFrame(tick);
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [target, duration]);

  return <>{value}</>;
}

function CircularProgress({ value, size = 120 }: { value: number; size?: number }) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#262629"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#00E5CC"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          strokeDasharray={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl tracking-argoHeading text-argo-text">
          <AnimatedCounter target={value} />
        </span>
        <span className="text-xs text-argo-textSecondary">/100</span>
      </div>
    </div>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          className={cn(
            'h-2 rounded-full transition-all duration-300',
            i === current
              ? 'w-8 bg-argo-accent'
              : i < current
                ? 'w-2 bg-argo-accent/50'
                : 'w-2 bg-argo-border',
          )}
          layout
        />
      ))}
    </div>
  );
}

function EmailCard({
  to,
  subject,
  children,
  className,
}: {
  to: string;
  subject: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={cn(
        'rounded-xl border border-gray-200 bg-white text-gray-900 shadow-xl overflow-hidden',
        className,
      )}
      {...scaleIn}
    >
      <div className="border-b border-gray-100 bg-gray-50 px-5 py-3">
        <div className="flex items-center gap-1.5 mb-1">
          <div className="h-3 w-3 rounded-full bg-red-400" />
          <div className="h-3 w-3 rounded-full bg-amber-400" />
          <div className="h-3 w-3 rounded-full bg-green-400" />
        </div>
        <div className="mt-2 space-y-1 text-sm">
          <p>
            <span className="text-gray-400">To:</span> {to}
          </p>
          <p>
            <span className="text-gray-400">Subject:</span> {subject}
          </p>
        </div>
      </div>
      <div className="px-5 py-4 text-sm leading-relaxed">{children}</div>
    </motion.div>
  );
}

function SectionWrapper({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      className={cn('min-h-[80vh] flex flex-col items-center justify-center px-6 py-20', className)}
      initial="initial"
      animate="animate"
      exit="exit"
      variants={stagger}
    >
      {children}
    </motion.section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section components
// ──────────────────────────────────────────────────────────────────────

function HeroSection({ onStart }: { onStart: () => void }) {
  return (
    <SectionWrapper>
      <motion.div className="text-center max-w-3xl" variants={fadeUp}>
        <motion.div
          className="inline-flex items-center gap-2 rounded-full border border-argo-accent/30 bg-argo-accent/10 px-4 py-1.5 text-sm text-argo-accent mb-8"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <Sparkles className="h-4 w-4" />
          Live Interactive Demo
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl tracking-argoBrand leading-argoHero text-argo-text mb-6"
          variants={fadeUp}
        >
          Watch Argo Handle
          <br />
          <span className="bg-gradient-to-r from-argo-accent to-cyan-400 bg-clip-text text-transparent">
            a Candidate
          </span>
        </motion.h1>

        <motion.p
          className="text-lg md:text-xl text-argo-textSecondary leading-argoBody max-w-xl mx-auto mb-12"
          variants={fadeUp}
        >
          See how Argo handles a candidate application from submission to decision in under 60
          seconds. No code. No dashboard. Just email.
        </motion.p>

        <motion.button
          className="group inline-flex items-center gap-3 rounded-xl bg-argo-accent px-8 py-4 text-lg text-argo-bg transition-all hover:shadow-[0_0_40px_rgba(0,229,204,0.3)] hover:scale-[1.02] active:scale-[0.98]"
          onClick={onStart}
          variants={fadeUp}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <Play className="h-5 w-5" />
          Start Demo
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </motion.button>
      </motion.div>
    </SectionWrapper>
  );
}

function ApplicationSection({ onSubmit }: { onSubmit: () => void }) {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setSubmitted(true);
    setTimeout(onSubmit, 1200);
  };

  return (
    <SectionWrapper>
      <motion.h2
        className="text-3xl md:text-4xl tracking-argoHeading text-argo-text mb-3 text-center"
        variants={fadeUp}
      >
        Candidate Submits Application
      </motion.h2>
      <motion.p className="text-argo-textSecondary mb-10 text-center" variants={fadeUp}>
        A real form on a real site. Jordan applies in 30 seconds.
      </motion.p>

      <motion.div
        className={cn(
          'relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden transition-all duration-700',
          submitted && 'scale-95 opacity-60',
        )}
        variants={scaleIn}
      >
        {/* Submitted overlay */}
        <AnimatePresence>
          {submitted && (
            <motion.div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 15, stiffness: 200 }}
              >
                <CheckCircle2 className="h-16 w-16 text-emerald-500 mb-4" />
              </motion.div>
              <p className="text-xl text-gray-900">Application Submitted</p>
              <p className="text-sm text-gray-500 mt-1">Argo is picking it up...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-argo-accent/20">
              <Rocket className="h-5 w-5 text-argo-accent" />
            </div>
            <div>
              <p className="text-white text-sm">TalentFirst Recruiting</p>
              <p className="text-gray-400 text-xs">Senior Frontend Engineer</p>
            </div>
          </div>
        </div>

        {/* Form fields */}
        <div className="p-6 space-y-4">
          {[
            { label: 'Full Name', value: CANDIDATE.name, icon: User },
            { label: 'Email', value: CANDIDATE.email, icon: Mail },
            { label: 'Role', value: CANDIDATE.role, icon: Zap },
            { label: 'Years of Experience', value: CANDIDATE.experience, icon: Clock },
          ].map((field) => (
            <div key={field.label}>
              <label className="text-xs text-gray-500 mb-1 block">{field.label}</label>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <field.icon className="h-4 w-4 text-gray-400 shrink-0" />
                <span className="text-sm text-gray-800">{field.value}</span>
              </div>
            </div>
          ))}

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Cover Note</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-sm text-gray-800 leading-relaxed">{CANDIDATE.coverNote}</p>
            </div>
          </div>

          <motion.button
            className={cn(
              'w-full rounded-lg py-3 text-sm transition-all flex items-center justify-center gap-2',
              submitted
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.98]',
            )}
            onClick={handleSubmit}
            disabled={submitted}
            whileTap={!submitted ? { scale: 0.97 } : undefined}
          >
            {submitted ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Submitted
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Submit Application
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </SectionWrapper>
  );
}

function AIScreeningSection({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'analyzing' | 'extracting' | 'scoring' | 'verdict'>('analyzing');
  const [visibleItems, setVisibleItems] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('extracting'), 1400),
      setTimeout(() => setVisibleItems(1), 1800),
      setTimeout(() => setVisibleItems(2), 2200),
      setTimeout(() => setVisibleItems(3), 2600),
      setTimeout(() => setVisibleItems(4), 3000),
      setTimeout(() => setPhase('scoring'), 3400),
      setTimeout(() => setPhase('verdict'), 5200),
      setTimeout(onComplete, 6800),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <SectionWrapper>
      <motion.h2
        className="text-3xl md:text-4xl tracking-argoHeading text-argo-text mb-3 text-center"
        variants={fadeUp}
      >
        AI Screens the Candidate
      </motion.h2>
      <motion.p className="text-argo-textSecondary mb-10 text-center" variants={fadeUp}>
        GPT-5.5 classifies, scores, and routes — in 3 seconds.
      </motion.p>

      <motion.div
        className="w-full max-w-2xl rounded-2xl border border-argo-border bg-argo-surface p-8"
        variants={scaleIn}
      >
        {/* Analyzing header */}
        <div className="flex items-center gap-3 mb-8">
          <motion.div
            animate={
              phase === 'analyzing'
                ? { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }
                : { scale: 1, opacity: 1 }
            }
            transition={
              phase === 'analyzing'
                ? { duration: 1.2, repeat: Infinity }
                : { duration: 0.3 }
            }
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-argo-accent/15"
          >
            <Brain className="h-6 w-6 text-argo-accent" />
          </motion.div>
          <div>
            <p className="text-argo-text">
              {phase === 'analyzing'
                ? 'Analyzing application...'
                : phase === 'extracting'
                  ? 'Extracting key signals...'
                  : phase === 'scoring'
                    ? 'Computing match score...'
                    : 'Analysis complete'}
            </p>
            <p className="text-xs text-argo-textSecondary">Argo AI Classifier v3</p>
          </div>
        </div>

        {/* Extractions */}
        <AnimatePresence>
          {phase !== 'analyzing' && (
            <motion.div className="space-y-3 mb-8" variants={stagger} initial="initial" animate="animate">
              {ANALYSIS_ITEMS.slice(0, visibleItems).map((item, i) => (
                <motion.div
                  key={item.label}
                  className="flex items-start gap-3 rounded-lg border border-argo-border bg-argo-bg px-4 py-3"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <item.icon
                    className={cn(
                      'h-5 w-5 mt-0.5 shrink-0',
                      item.label === 'Red flags' ? 'text-emerald-400' : 'text-argo-accent',
                    )}
                  />
                  <div>
                    <p className="text-xs text-argo-textSecondary">{item.label}</p>
                    <p className="text-sm text-argo-text">{item.value}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Skills chips */}
        <AnimatePresence>
          {visibleItems >= 1 && (
            <motion.div
              className="flex flex-wrap gap-2 mb-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {SKILLS_EXTRACTED.map((skill, i) => (
                <motion.span
                  key={skill}
                  className="rounded-full border border-argo-accent/30 bg-argo-accent/10 px-3 py-1 text-xs text-argo-accent"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08 }}
                >
                  {skill}
                </motion.span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Score + Verdict */}
        <AnimatePresence>
          {(phase === 'scoring' || phase === 'verdict') && (
            <motion.div
              className="flex flex-col sm:flex-row items-center gap-8 pt-4 border-t border-argo-border"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <CircularProgress value={87} />

              {phase === 'verdict' && (
                <motion.div
                  className="flex-1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-4 py-2 mb-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    <span className="text-emerald-400">Strong Match — Forward to Client</span>
                  </div>
                  <p className="text-sm text-argo-textSecondary">
                    Jordan exceeds the 5-year experience requirement, has directly relevant Stripe
                    experience, and shows strong startup-to-enterprise versatility.
                  </p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </SectionWrapper>
  );
}

function EmailsSection({ onComplete }: { onComplete: () => void }) {
  const [showRight, setShowRight] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowRight(true), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <SectionWrapper>
      <motion.h2
        className="text-3xl md:text-4xl tracking-argoHeading text-argo-text mb-3 text-center"
        variants={fadeUp}
      >
        Emails Generated Instantly
      </motion.h2>
      <motion.p className="text-argo-textSecondary mb-10 text-center" variants={fadeUp}>
        Two emails drafted and queued in under a second. No templates to maintain.
      </motion.p>

      <div className="grid md:grid-cols-2 gap-6 w-full max-w-4xl">
        {/* Approval email */}
        <EmailCard
          to="maya@talentfirst.co"
          subject="Strong candidate for Senior Frontend: Jordan Reeves (87/100)"
        >
          <p className="mb-3">Hi Maya,</p>
          <p className="mb-3">
            Jordan Reeves scored <strong>87/100</strong> for the Senior Frontend Engineer role.
          </p>
          <p className="mb-2 text-gray-600">Key highlights:</p>
          <ul className="list-disc pl-5 mb-4 space-y-1 text-gray-700">
            <li>6 years of React experience, including Stripe payments dashboard</li>
            <li>Strong TypeScript and system design skills</li>
            <li>Previous startup + enterprise experience</li>
          </ul>
          <div className="flex gap-2 mb-3">
            <span className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs text-white cursor-pointer hover:bg-emerald-600 transition-colors">
              Approve
            </span>
            <span className="rounded-md bg-blue-500 px-4 py-1.5 text-xs text-white cursor-pointer hover:bg-blue-600 transition-colors">
              Schedule Interview
            </span>
            <span className="rounded-md bg-gray-200 px-4 py-1.5 text-xs text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors">
              Decline
            </span>
          </div>
          <p className="text-gray-400 text-xs">— Argo</p>
        </EmailCard>

        {/* Confirmation email */}
        <AnimatePresence>
          {showRight && (
            <EmailCard
              to="jordan.reeves@gmail.com"
              subject="Application received — Senior Frontend Engineer"
            >
              <p className="mb-3">Hi Jordan,</p>
              <p className="mb-3">
                Thanks for applying to the Senior Frontend Engineer role. We've received your
                application and our team is reviewing it.
              </p>
              <p className="mb-3">You'll hear back within 48 hours.</p>
              <p className="text-gray-600">
                Best,
                <br />
                TalentFirst Recruiting
              </p>
            </EmailCard>
          )}
        </AnimatePresence>
      </div>

      <motion.button
        className="mt-10 inline-flex items-center gap-2 rounded-xl bg-argo-accent/10 border border-argo-accent/30 px-6 py-3 text-sm text-argo-accent hover:bg-argo-accent/20 transition-all"
        onClick={onComplete}
        variants={fadeUp}
        whileTap={{ scale: 0.97 }}
      >
        See what happens next
        <ChevronRight className="h-4 w-4" />
      </motion.button>
    </SectionWrapper>
  );
}

function ApprovalGateSection({ onComplete }: { onComplete: () => void }) {
  const [approved, setApproved] = useState(false);
  const [flowing, setFlowing] = useState(false);
  const [notified, setNotified] = useState(false);

  const handleApprove = () => {
    setApproved(true);
    setTimeout(() => setFlowing(true), 600);
    setTimeout(() => setNotified(true), 1800);
  };

  return (
    <SectionWrapper>
      <motion.h2
        className="text-3xl md:text-4xl tracking-argoHeading text-argo-text mb-3 text-center"
        variants={fadeUp}
      >
        Maya Approves from Email
      </motion.h2>
      <motion.p className="text-argo-textSecondary mb-10 text-center" variants={fadeUp}>
        One click. No login. No dashboard. The operator never leaves their inbox.
      </motion.p>

      <div className="w-full max-w-3xl space-y-6">
        {/* Maya's inbox */}
        <motion.div
          className="rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
          variants={scaleIn}
        >
          {/* Mail chrome */}
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
            <span className="ml-3 text-xs text-gray-400">Mail — maya@talentfirst.co</span>
          </div>

          <div className="p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700 text-sm">
                A
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-900">
                  Argo — TalentFirst
                </p>
                <p className="text-xs text-gray-500">
                  Strong candidate for Senior Frontend: Jordan Reeves (87/100)
                </p>
              </div>
              <span className="text-xs text-gray-400">2m ago</span>
            </div>

            <p className="text-sm text-gray-700 mb-4">
              Jordan Reeves scored 87/100. 6 years React, Stripe dashboard lead, startup +
              enterprise mix.
            </p>

            <div className="flex gap-2">
              <motion.button
                className={cn(
                  'rounded-md px-5 py-2 text-sm transition-all',
                  approved
                    ? 'bg-emerald-500 text-white'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95',
                )}
                onClick={handleApprove}
                disabled={approved}
                whileTap={!approved ? { scale: 0.95 } : undefined}
              >
                {approved ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Approved
                  </span>
                ) : (
                  'Approve'
                )}
              </motion.button>
              <button className="rounded-md bg-blue-500 text-white px-5 py-2 text-sm opacity-50 cursor-not-allowed">
                Schedule Interview
              </button>
              <button className="rounded-md bg-gray-200 text-gray-600 px-5 py-2 text-sm opacity-50 cursor-not-allowed">
                Decline
              </button>
            </div>
          </div>
        </motion.div>

        {/* Flow animation */}
        <AnimatePresence>
          {flowing && (
            <motion.div
              className="flex items-center justify-center gap-4"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.5 }}
            >
              <motion.div
                className="h-px flex-1 bg-gradient-to-r from-transparent via-argo-accent to-transparent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
              <motion.div
                className="flex items-center gap-2 rounded-full border border-argo-accent/30 bg-argo-accent/10 px-4 py-2 text-sm text-argo-accent"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 }}
              >
                <Zap className="h-4 w-4" />
                Approval flowing through...
              </motion.div>
              <motion.div
                className="h-px flex-1 bg-gradient-to-r from-transparent via-argo-accent to-transparent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Jordan notification */}
        <AnimatePresence>
          {notified && (
            <EmailCard
              to="jordan.reeves@gmail.com"
              subject="Great news — you're moving forward!"
            >
              <p className="mb-3">Hi Jordan,</p>
              <p className="mb-3">
                Great news! The hiring team at TalentFirst has reviewed your application for
                the Senior Frontend Engineer role and would like to move forward.
              </p>
              <p className="mb-3">
                You'll receive a calendar invite for your first interview within 24 hours.
              </p>
              <p className="text-gray-600">
                Best,
                <br />
                TalentFirst Recruiting
              </p>
            </EmailCard>
          )}
        </AnimatePresence>
      </div>

      {notified && (
        <motion.button
          className="mt-10 inline-flex items-center gap-2 rounded-xl bg-argo-accent/10 border border-argo-accent/30 px-6 py-3 text-sm text-argo-accent hover:bg-argo-accent/20 transition-all"
          onClick={onComplete}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          whileTap={{ scale: 0.97 }}
        >
          See the weekly digest
          <ChevronRight className="h-4 w-4" />
        </motion.button>
      )}
    </SectionWrapper>
  );
}

function DigestSection({ onComplete }: { onComplete: () => void }) {
  return (
    <SectionWrapper>
      <motion.h2
        className="text-3xl md:text-4xl tracking-argoHeading text-argo-text mb-3 text-center"
        variants={fadeUp}
      >
        Monday Digest
      </motion.h2>
      <motion.p className="text-argo-textSecondary mb-10 text-center" variants={fadeUp}>
        Every Monday at 9am. The entire week, summarized in one email.
      </motion.p>

      <EmailCard
        to="maya@talentfirst.co"
        subject="Your Weekly Pipeline Digest — TalentFirst"
        className="w-full max-w-xl"
      >
        <div className="mb-4">
          <p className="text-base text-gray-900 mb-4">This week:</p>

          {[
            { label: '47 applications received', note: '↑12% vs last week', color: 'text-emerald-600' },
            { label: '8 candidates forwarded to clients', note: null, color: 'text-gray-700' },
            { label: '3 interviews scheduled', note: null, color: 'text-gray-700' },
            {
              label: 'Average response time: 23 minutes',
              note: 'industry avg: 4.2 hours',
              color: 'text-emerald-600',
            },
            { label: 'Estimated time saved: 12 hours', note: null, color: 'text-blue-600' },
          ].map((row, i) => (
            <motion.div
              key={row.label}
              className="flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.15 }}
            >
              <span className="text-emerald-500 text-sm">•</span>
              <span className={cn('text-sm', row.color)}>{row.label}</span>
              {row.note && (
                <span className="text-xs text-gray-400">({row.note})</span>
              )}
            </motion.div>
          ))}
        </div>

        <motion.div
          className="rounded-lg bg-gradient-to-r from-cyan-50 to-emerald-50 border border-cyan-100 p-4 mt-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-cyan-600" />
            <p className="text-sm text-cyan-800">Top candidate this week</p>
          </div>
          <p className="text-sm text-gray-700">
            <strong>Jordan Reeves</strong> (87/100) — Senior Frontend Engineer
          </p>
        </motion.div>

        <p className="text-xs text-gray-400 mt-4">— Argo, on behalf of TalentFirst Recruiting</p>
      </EmailCard>

      <motion.button
        className="mt-10 inline-flex items-center gap-2 rounded-xl bg-argo-accent/10 border border-argo-accent/30 px-6 py-3 text-sm text-argo-accent hover:bg-argo-accent/20 transition-all"
        onClick={onComplete}
        variants={fadeUp}
        whileTap={{ scale: 0.97 }}
      >
        But what about regressions?
        <ChevronRight className="h-4 w-4" />
      </motion.button>
    </SectionWrapper>
  );
}

function RegressionSection({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'baseline' | 'adding' | 'retest' | 'safe'>('idle');
  const [passedCount, setPassedCount] = useState(0);
  const [retestCount, setRetestCount] = useState(0);

  useEffect(() => {
    if (phase !== 'idle') return;
    // Auto-start
    const t = setTimeout(() => setPhase('baseline'), 400);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'baseline') {
      const interval = setInterval(() => {
        setPassedCount((c) => {
          if (c >= BASELINE_TESTS.length) {
            clearInterval(interval);
            setTimeout(() => setPhase('adding'), 600);
            return c;
          }
          return c + 1;
        });
      }, 180);
      return () => clearInterval(interval);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'adding') {
      const t = setTimeout(() => setPhase('retest'), 1600);
      return () => clearTimeout(t);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'retest') {
      const interval = setInterval(() => {
        setRetestCount((c) => {
          if (c >= BASELINE_TESTS.length) {
            clearInterval(interval);
            setTimeout(() => setPhase('safe'), 600);
            return c;
          }
          return c + 1;
        });
      }, 150);
      return () => clearInterval(interval);
    }
  }, [phase]);

  return (
    <SectionWrapper>
      <motion.h2
        className="text-3xl md:text-4xl tracking-argoHeading text-argo-text mb-3 text-center"
        variants={fadeUp}
      >
        Regression Safety
      </motion.h2>
      <motion.p className="text-argo-textSecondary mb-2 text-center" variants={fadeUp}>
        Maya says: "Add a phone number field to the application form."
      </motion.p>
      <motion.p className="text-argo-textSecondary mb-10 text-center text-sm" variants={fadeUp}>
        Watch Argo protect the live system while making changes.
      </motion.p>

      <motion.div
        className="w-full max-w-2xl rounded-2xl border border-argo-border bg-argo-surface overflow-hidden"
        variants={scaleIn}
      >
        {/* Terminal header */}
        <div className="flex items-center gap-2 border-b border-argo-border bg-argo-bg px-4 py-2.5">
          <div className="h-2.5 w-2.5 rounded-full bg-argo-red" />
          <div className="h-2.5 w-2.5 rounded-full bg-argo-amber" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-2 text-xs text-argo-textSecondary font-mono">argo test-runner</span>
        </div>

        <div className="p-5 font-mono text-xs space-y-1 max-h-[420px] overflow-y-auto">
          {/* Step 1: Baseline */}
          <motion.p
            className="text-argo-accent mb-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            $ argo baseline --suite recruiting-intake
          </motion.p>
          <p className="text-argo-textSecondary mb-1">Running {BASELINE_TESTS.length} baseline tests...</p>

          {BASELINE_TESTS.slice(0, passedCount).map((test, i) => (
            <motion.div
              key={test}
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
            >
              <span className="text-emerald-400">PASS</span>
              <span className="text-argo-textSecondary">{test}</span>
            </motion.div>
          ))}

          {passedCount >= BASELINE_TESTS.length && (
            <motion.p
              className="text-emerald-400 mt-2 mb-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              All {BASELINE_TESTS.length} tests passed. Baseline locked.
            </motion.p>
          )}

          {/* Step 2: Adding field */}
          <AnimatePresence>
            {(phase === 'adding' || phase === 'retest' || phase === 'safe') && (
              <>
                <motion.p
                  className="text-argo-accent mt-3"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  $ argo iterate "Add phone number field"
                </motion.p>
                <motion.div
                  className="flex items-center gap-2 my-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <Phone className="h-3 w-3 text-argo-amber" />
                  <span className="text-argo-amber">
                    Adding field: phone_number (string, optional, E.164 validated)
                  </span>
                </motion.div>
                <motion.p
                  className="text-argo-textSecondary"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                >
                  Modified: schema.ts, apply.ts, types.ts
                </motion.p>
              </>
            )}
          </AnimatePresence>

          {/* Step 3: Retest */}
          <AnimatePresence>
            {(phase === 'retest' || phase === 'safe') && (
              <>
                <motion.p
                  className="text-argo-accent mt-3"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  $ argo retest --against-baseline
                </motion.p>
                <motion.p
                  className="text-argo-textSecondary mb-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  Re-running {BASELINE_TESTS.length} tests against modified code...
                </motion.p>

                {BASELINE_TESTS.slice(0, retestCount).map((test) => (
                  <motion.div
                    key={`re-${test}`}
                    className="flex items-center gap-2"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    <span className="text-emerald-400">PASS</span>
                    <span className="text-argo-textSecondary">{test}</span>
                  </motion.div>
                ))}

                {retestCount >= BASELINE_TESTS.length && (
                  <motion.p
                    className="text-emerald-400 mt-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    All {BASELINE_TESTS.length} tests passed. No regressions detected.
                  </motion.p>
                )}
              </>
            )}
          </AnimatePresence>

          {/* Step 4: Safe */}
          <AnimatePresence>
            {phase === 'safe' && (
              <motion.div
                className="mt-3 flex items-center gap-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="text-emerald-400">
                  No regressions. Safe to deploy.
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Badge */}
      <AnimatePresence>
        {phase === 'safe' && (
          <motion.div
            className="mt-8 flex flex-col items-center gap-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <div className="inline-flex items-center gap-3 rounded-xl border border-argo-accent/30 bg-argo-accent/10 px-6 py-3">
              <Shield className="h-5 w-5 text-argo-accent" />
              <span className="text-argo-accent text-sm">
                This is what other tools can't do.
              </span>
            </div>
            <p className="text-sm text-argo-textSecondary text-center max-w-md">
              Every iteration runs the full test suite against a locked baseline. If a change breaks
              existing functionality, Argo blocks the deploy before damage happens.
            </p>

            <motion.button
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-argo-accent/10 border border-argo-accent/30 px-6 py-3 text-sm text-argo-accent hover:bg-argo-accent/20 transition-all"
              onClick={onComplete}
              whileTap={{ scale: 0.97 }}
            >
              Final step
              <ChevronRight className="h-4 w-4" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </SectionWrapper>
  );
}

function CTASection() {
  return (
    <SectionWrapper>
      <motion.div className="text-center max-w-2xl" variants={fadeUp}>
        <motion.div
          className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-argo-accent/15 mb-8"
          variants={fadeUp}
          animate={{
            boxShadow: [
              '0 0 0 0 rgba(0,229,204,0)',
              '0 0 60px 10px rgba(0,229,204,0.15)',
              '0 0 0 0 rgba(0,229,204,0)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <Rocket className="h-8 w-8 text-argo-accent" />
        </motion.div>

        <motion.h2
          className="text-4xl md:text-5xl tracking-argoBrand leading-argoHero text-argo-text mb-6"
          variants={fadeUp}
        >
          Ready to stop losing candidates
          <br />
          <span className="bg-gradient-to-r from-argo-accent to-cyan-400 bg-clip-text text-transparent">
            to slow response times?
          </span>
        </motion.h2>

        <motion.p
          className="text-lg text-argo-textSecondary leading-argoBody mb-10 max-w-lg mx-auto"
          variants={fadeUp}
        >
          23-minute average response time vs the industry average of 4.2 hours. Argo runs your
          recruiting pipeline while you sleep.
        </motion.p>

        <motion.div className="flex flex-col sm:flex-row items-center justify-center gap-4" variants={fadeUp}>
          <motion.button
            className="group inline-flex items-center gap-3 rounded-xl bg-argo-accent px-8 py-4 text-lg text-argo-bg transition-all hover:shadow-[0_0_40px_rgba(0,229,204,0.3)] hover:scale-[1.02] active:scale-[0.98]"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <Sparkles className="h-5 w-5" />
            Start Building
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </motion.button>

          <motion.button
            className="inline-flex items-center gap-2 rounded-xl border border-argo-border px-6 py-4 text-sm text-argo-textSecondary hover:text-argo-text hover:border-argo-textSecondary transition-all"
            whileTap={{ scale: 0.97 }}
          >
            <Play className="h-4 w-4" />
            Watch again
          </motion.button>
        </motion.div>

        <motion.div
          className="mt-16 grid grid-cols-3 gap-8 border-t border-argo-border pt-10"
          variants={stagger}
        >
          {[
            { stat: '23 min', label: 'avg response time' },
            { stat: '12 hrs', label: 'saved per week' },
            { stat: '0', label: 'regressions shipped' },
          ].map((item) => (
            <motion.div key={item.label} className="text-center" variants={fadeUp}>
              <p className="text-2xl md:text-3xl tracking-argoHeading text-argo-accent">
                {item.stat}
              </p>
              <p className="text-xs text-argo-textSecondary mt-1">{item.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </SectionWrapper>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Main export
// ──────────────────────────────────────────────────────────────────────

export function RecruitingDemo() {
  const [step, setStep] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const advance = useCallback(() => {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  // Scroll to top on step change
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-argo-bg text-argo-text overflow-y-auto"
    >
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-argo-bg">
        <motion.div
          className="h-full bg-gradient-to-r from-argo-accent to-cyan-400"
          initial={{ width: '0%' }}
          animate={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Step dots */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
        <ProgressDots current={step} total={TOTAL_STEPS} />
      </div>

      {/* Back button */}
      {step > 0 && (
        <motion.button
          className="fixed top-5 left-5 z-50 flex items-center gap-1.5 rounded-lg border border-argo-border bg-argo-surface/80 backdrop-blur px-3 py-1.5 text-xs text-argo-textSecondary hover:text-argo-text transition-colors"
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileTap={{ scale: 0.95 }}
        >
          <ChevronRight className="h-3 w-3 rotate-180" />
          Back
        </motion.button>
      )}

      {/* Section renderer */}
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="hero" {...fadeUp}>
            <HeroSection onStart={advance} />
          </motion.div>
        )}
        {step === 1 && (
          <motion.div key="application" {...fadeUp}>
            <ApplicationSection onSubmit={advance} />
          </motion.div>
        )}
        {step === 2 && (
          <motion.div key="screening" {...fadeUp}>
            <AIScreeningSection onComplete={advance} />
          </motion.div>
        )}
        {step === 3 && (
          <motion.div key="emails" {...fadeUp}>
            <EmailsSection onComplete={advance} />
          </motion.div>
        )}
        {step === 4 && (
          <motion.div key="approval" {...fadeUp}>
            <ApprovalGateSection onComplete={advance} />
          </motion.div>
        )}
        {step === 5 && (
          <motion.div key="digest" {...fadeUp}>
            <DigestSection onComplete={advance} />
          </motion.div>
        )}
        {step === 6 && (
          <motion.div key="regression" {...fadeUp}>
            <RegressionSection onComplete={advance} />
          </motion.div>
        )}
        {step === 7 && (
          <motion.div key="cta" {...fadeUp}>
            <CTASection />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-argo-accent/[0.03] blur-[120px]" />
      </div>
    </div>
  );
}
