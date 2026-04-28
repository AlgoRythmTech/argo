// Argo landing — 22 sections, heavy 3D, scroll-linked everywhere.
// Inter-500 only, electric-cyan accent on dark canvas. No pricing.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import {
  ArrowRight,
  Boxes,
  Brain,
  Bug,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Cpu,
  Database,
  Eye,
  FileCode2,
  Fingerprint,
  Github,
  Inbox,
  Lock,
  Mail,
  MessageCircle,
  Network,
  Play,
  Rocket,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Wand2,
  Zap,
} from 'lucide-react';
import { useArgo } from '../state/store.js';
import { LiquidButton } from '../components/ui/liquid-glass-button.js';
import { cn } from '../lib/utils.js';

// ──────────────────────────────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────────────────────────────

const SPECIALIST_DEMOS = [
  {
    title: 'Form-driven workflows',
    persona: 'form_workflow',
    sentence:
      'Candidates apply to my recruiting site through a form. Reject most politely, forward strong matches to the hiring client.',
    output: '8 files · approval-gated email · Mongo persistence · Monday digest',
    glow: 'from-argo-accent/40 via-argo-accent/10 to-transparent',
  },
  {
    title: 'Multi-tenant SaaS',
    persona: 'multi_tenant_saas',
    sentence:
      'A SaaS for design teams: workspaces, OAuth-Google login, role-based permissions, realtime cursors over WebSockets, an admin panel.',
    output: '24 files · OAuth + RBAC + WS multiplex · migration runner · audit log',
    glow: 'from-fuchsia-500/40 via-fuchsia-500/10 to-transparent',
  },
  {
    title: 'Webhook bridge',
    persona: 'webhook_bridge',
    sentence:
      'Receive Stripe webhooks, deduplicate retries, normalise to my internal event shape, fan out to a Slack channel and Postgres.',
    output: '11 files · HMAC-verified ingress · BullMQ + DLQ · Slack Block Kit',
    glow: 'from-amber-400/40 via-amber-400/10 to-transparent',
  },
] as const;

const QUALITY_CHECKS = [
  'no_console_log','no_eval_or_function','no_inlined_secrets',
  'no_localhost_in_code','no_test_credentials','no_unsanitised_html',
  'no_sql_concatenation','no_prototype_pollution','no_weak_crypto',
  'no_unsafe_regex','no_path_traversal','no_xml_xxe',
  'no_secrets_in_errors','no_open_cors','no_http_outbound',
  'public_route_rate_limit','sigterm_handler_present','health_route_present',
  'package_json_valid','zod_validation_on_post','escape_for_email_used',
  'no_missing_await_on_async','helmet_registered','body_limit_set',
  'fastify_error_handler_set','mongo_collection_has_indexes',
  'route_sets_content_type','no_exposed_stack_traces','request_logger_in_handlers',
  'env_referenced_only_via_process_env','imports_resolve','observability_telemetry_emitted',
  'shutdown_drains_in_flight',
];

const HOW_IT_WORKS = [
  {
    n: '01', icon: Sparkles, title: 'Scope',
    body: 'One sentence describes the workflow. GPT-5.5 generates 4–6 click-card questions to nail the brief. Refines once if anything\'s vague.',
    detail: 'Trigger · audience · integrations · voice · compliance — all from clicks, not typing.',
  },
  {
    n: '02', icon: Wand2, title: 'Build',
    body: 'Specialist persona dispatches. GPT-5.5 streams typed Fastify + Zod + Mongo with reference patterns cribbed from real production code.',
    detail: '12 specialists · 32 reference snippets · streamed file-write tags · auto-fix loop.',
  },
  {
    n: '03', icon: Eye, title: 'Preview',
    body: 'A 49-check quality gate + 15-category security scanner + auto-generated regression tests run before every deploy. Changes that break existing features are automatically blocked.',
    detail: '49 quality checks · 15 security scan categories · auto-generated test suite · regression guard · npm hallucination detection.',
  },
  {
    n: '04', icon: Inbox, title: 'Operate from email',
    body: 'Argo emails when a decision is needed. Approve / Edit / Decline — three buttons, never more. Monday digest summarises the week as prose.',
    detail: 'You don\'t open the workspace daily. The trust ratchet gates the first 10 sends per template.',
  },
] as const;

const ARCHITECTURE_NODES = [
  { icon: Send, label: 'Form post', x: 8, y: 50 },
  { icon: ShieldCheck, label: 'Zod + helmet + rate limit', x: 26, y: 35 },
  { icon: Brain, label: 'GPT-5.5 classifier', x: 46, y: 50 },
  { icon: Database, label: 'Mongo persistence', x: 64, y: 35 },
  { icon: Mail, label: 'AgentMail · approval', x: 82, y: 50 },
  { icon: Inbox, label: 'Operator inbox', x: 92, y: 18 },
] as const;

const COMPARISON_ROWS = [
  { feature: 'Auto-refund on platform errors (never pay for our bugs)', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Diff review before ANY code change (no silent modifications)', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Full version history with one-click rollback', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Loop detection — stops and refunds after 3 failed attempts', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Quality gate (49 checks) + security scanner (15 categories)', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Auto-generated regression tests before every change', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Transparent pricing — per-model, per-token, no opaque credits', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'One-click code export (download ZIP or push to GitHub)', argo: true, kis: false, replit: 'partial', lovable: 'partial' },
  { feature: 'Custom domains with auto-SSL', argo: true, kis: false, replit: 'partial', lovable: false },
  { feature: 'Data browser (no SQL/RLS knowledge needed)', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'AI agent builder with sandbox deployment', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Self-healing — detects errors, proposes fix, waits for approval', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Human support for platform bugs (not just AI chat)', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'No secrets in plain text (enforced by quality gate)', argo: true, kis: false, replit: false, lovable: false },
  { feature: 'Production-grade by default (auth, rate limiting, health checks)', argo: true, kis: false, replit: 'partial', lovable: false },
  { feature: 'Built for non-developers (conversational, click-through setup)', argo: true, kis: false, replit: false, lovable: 'partial' },
  { feature: 'Operate from email — approve/reject without opening dashboard', argo: true, kis: false, replit: false, lovable: false },
];

const FAQ = [
  {
    q: 'Who is Argo for?',
    a: 'Solo operators and small teams running real businesses: recruiters, agency owners, indie SaaS founders, ops leads. People who need software that actually works in production, not another fragile demo.',
  },
  {
    q: 'How is this different from Replit / Lovable / Bolt / Emergent?',
    a: 'Those tools generate code and hope it works. Users report agents that lie about changes, credits burning during platform crashes, and entire codebases disappearing. Argo runs 49 quality checks + 15 security scans + regression tests before EVERY deploy. We auto-refund platform errors. We never apply code changes without showing you a diff first. We never delete your code.',
  },
  {
    q: 'What about pricing? I\'ve been burned by credit systems before.',
    a: 'We hear you. Argo\'s guarantee: platform crashes, AI loops, and environment errors NEVER consume your credits. We auto-refund failed invocations. You see exactly what each model costs — per token, per invocation, per operation. No opaque credits. No surprises.',
  },
  {
    q: 'What if the AI breaks my working code?',
    a: 'It can\'t. Every change is shown as a visual diff before it\'s applied. Risky changes (schema, auth, routing) require explicit approval. Regression tests run before every change — if your change would break existing features, Argo blocks it. Plus, full version history with one-click rollback to any prior state.',
  },
  {
    q: 'Can I take my code and leave?',
    a: 'Absolutely. One-click download as ZIP. One-click push to GitHub. Standard Node.js/React — runs anywhere. No lock-in, ever. You own your code.',
  },
  {
    q: 'Do I see the code?',
    a: 'Always. Read-only Code tab with syntax highlighting and full bundle search. Plus a data browser so you can see what\'s in your database without learning SQL. Auditors love it.',
  },
  {
    q: 'What about support?',
    a: 'Real humans for serious problems. Platform bugs, data incidents, and complex debugging are handled by engineers, not just AI. You never pay credits to troubleshoot our bugs. This is the opposite of what Lovable and Emergent do.',
  },
  {
    q: 'Is this production-ready or another prototype tool?',
    a: 'Production-ready. Every generated app ships with a real test suite, health checks, logging, rate limiting, input validation, and secrets management. No passwords in plain text. No spaghetti code. No "AI slop." The quality gate enforces this on every single deploy.',
  },
];

// Archetypes — third-person operator profiles. Honest descriptions of
// who Argo is built for. No fake testimonials, no invented names.
const ARCHETYPES = [
  {
    role: 'The recruiter who tried Lovable',
    pain: 'Built a candidate intake in Lovable. Looked great for a week. Then asked for a phone field — the AI broke the email flow, burned $180 in credits trying to fix it, and support said "try rephrasing your prompt."',
    win: 'One sentence in Argo. Three clicks to configure. Regression tests run before every change. Adding a phone field? 12 baseline tests pass, field added, 12 tests pass again. Zero regressions. Zero credits burned on loops.',
  },
  {
    role: 'The founder burned by Bolt',
    pain: 'Built an MVP, was about to deploy, and the AI deleted half the codebase. Lost a week of work. Bolt support? Silence for 5 days. Had to buy more tokens just to rebuild what the AI destroyed.',
    win: 'Every version saved in Argo. One-click rollback to any prior state. Code changes require your approval — the AI shows you a diff first. Nothing is ever permanently deleted. And we never charge you for our bugs.',
  },
  {
    role: 'The agency owner who outgrew Replit',
    pain: 'Three internal tools running on Replit. The AI agent keeps modifying files without asking, ignoring instructions, and taking shortcuts. The IDE lags. The billing is unpredictable. But the tools are too entangled to migrate.',
    win: 'Each operation runs in its own isolated sandbox with its own quality gate. Export your code to GitHub with one click. Transparent per-operation billing. And the AI never touches your code without showing you what it will change first.',
  },
  {
    role: 'The dev who doesn\'t trust vibe-coded apps',
    pain: 'Saw the r/vibecoding posts: spaghetti code, passwords in plain text, no tests, no structure. Told the CEO "we can\'t ship this" after reviewing the output from Emergent.',
    win: '49 quality checks enforce clean architecture. 15 security scan categories catch secrets in plain text, SQL injection, XSS, and more. Every app ships with auto-generated tests, health checks, rate limiting, and input validation. Show this to your CTO.',
  },
];

const TECH_STACK = [
  { label: 'Fastify v4', sub: 'Typed routes' },
  { label: 'Zod', sub: 'Validation' },
  { label: 'Mongo', sub: 'Persistence' },
  { label: 'GPT-5.5', sub: 'Code synthesis' },
  { label: 'Blaxel', sub: 'Sandbox runtime' },
  { label: 'AgentMail', sub: 'Email plane' },
];

const REFUSALS = [
  'We refuse to charge you when our platform crashes.',
  'We refuse to let the AI delete your working code.',
  'We refuse to ship changes without showing you a diff first.',
  'We refuse to hide behind opaque "credits" — you see every cent.',
  'We refuse to loop on the same bug and burn your money.',
  'We refuse to put secrets in plain text. Ever.',
  'We refuse to say "fixed" when it isn\'t. Tests must pass.',
  'We refuse to be another fragile demo tool. We build production software.',
];

const CITY_NODES = [
  { city: 'New York', x: 27, y: 38 },
  { city: 'San Francisco', x: 14, y: 41 },
  { city: 'London', x: 47, y: 32 },
  { city: 'Berlin', x: 51, y: 32 },
  { city: 'Bangalore', x: 67, y: 51 },
  { city: 'Singapore', x: 75, y: 60 },
  { city: 'Sydney', x: 87, y: 73 },
  { city: 'São Paulo', x: 33, y: 70 },
  { city: 'Toronto', x: 25, y: 35 },
  { city: 'Tokyo', x: 82, y: 42 },
];

// ──────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────

export function Landing() {
  const setView = useArgo((s) => s.setView);
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 80, damping: 30 });

  return (
    <div ref={containerRef} className="min-h-screen bg-argo-bg text-argo-text antialiased overflow-x-hidden">
      <ScrollProgressBar progress={smoothProgress} />
      <Nav onSignIn={() => setView('sign-in')} setView={setView} />
      <Hero onSignIn={() => setView('sign-in')} setView={setView} />
      <TrustStrip />
      <BigNumbers />
      <BuildPreview3D />
      <SpecialistsSection />
      <SentenceToStack />
      <HowItWorksTimeline />
      <PinnedBuildLoop />
      <QualityGateMarquee />
      <ArchitectureDiagram />
      <TechStackCube />
      <EmailApprovalMockup />
      <FeaturePillars />
      <PersonasCarousel />
      <ComparisonTable />
      <GlobeSection />
      <MemoryNeuralViz />
      <RefusalsScroll />
      <CodingToolsVsOperator />
      <IntegrationsConstellation />
      <FAQSection />
      <FinalCta onSignIn={() => setView('sign-in')} />
      <Footer />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Scroll progress bar
// ──────────────────────────────────────────────────────────────────────

function ScrollProgressBar({ progress }: { progress: MotionValue<number> }) {
  return (
    <motion.div
      style={{ scaleX: progress }}
      className="fixed top-0 left-0 right-0 h-[2px] bg-argo-accent origin-left z-50"
      aria-hidden
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Nav
// ──────────────────────────────────────────────────────────────────────

function Nav({ onSignIn, setView }: { onSignIn: () => void; setView: (v: 'guarantees') => void }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-argo-bg/70 border-b border-argo-border">
      <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
        <div className="argo-wordmark text-xl">Argo</div>
        <div className="flex items-center gap-6 text-sm">
          <a href="#how" className="text-argo-textSecondary hover:text-argo-text transition-colors hidden md:inline">How it works</a>
          <a href="#quality" className="text-argo-textSecondary hover:text-argo-text transition-colors hidden md:inline">Quality</a>
          <a href="#vs" className="text-argo-textSecondary hover:text-argo-text transition-colors hidden md:inline">Vs others</a>
          <a href="#faq" className="text-argo-textSecondary hover:text-argo-text transition-colors hidden md:inline">FAQ</a>
          <button type="button" onClick={() => setView('guarantees')} className="text-argo-accent hover:text-argo-text transition-colors hidden md:inline font-medium">Guarantees</button>
          <a href="https://github.com/AlgoRythmTech/argo" target="_blank" rel="noreferrer" className="text-argo-textSecondary hover:text-argo-text transition-colors hidden sm:inline-flex items-center gap-1">
            <Github className="h-3.5 w-3.5" /> GitHub
          </a>
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-1 rounded-full border border-argo-border bg-argo-surface px-4 py-1.5 text-sm text-argo-text hover:border-argo-accent/40 transition-colors"
          >
            Sign in <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────────────

function Hero({ onSignIn, setView }: { onSignIn: () => void; setView: (view: 'demo' | 'studio') => void }) {
  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);
  const orb1X = useTransform(mouseX, [0, 1], [-40, 40]);
  const orb1Y = useTransform(mouseY, [0, 1], [-30, 30]);
  const orb2X = useTransform(mouseX, [0, 1], [40, -40]);
  const orb2Y = useTransform(mouseY, [0, 1], [30, -30]);
  const tiltX = useTransform(mouseY, [0, 1], [4, -4]);
  const tiltY = useTransform(mouseX, [0, 1], [-4, 4]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseX.set(e.clientX / window.innerWidth);
      mouseY.set(e.clientY / window.innerHeight);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [mouseX, mouseY]);

  return (
    <section className="relative overflow-hidden pt-28 pb-32">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <motion.div style={{ x: orb1X, y: orb1Y }} className="absolute -top-32 left-1/4 h-[700px] w-[900px] rounded-full bg-argo-accent/20 blur-[140px]" />
        <motion.div style={{ x: orb2X, y: orb2Y }} className="absolute top-32 right-1/4 h-[600px] w-[800px] rounded-full bg-fuchsia-500/15 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,229,204,0.08),transparent_60%)]" />
        <GridPattern />
        <FloatingDots count={36} />
        <ConicSweep />
      </div>

      <div className="relative mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 flex flex-wrap items-center gap-3"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-argo-border bg-argo-surface/60 px-3 py-1 text-xs text-argo-textSecondary">
            <span className="argo-status-dot bg-argo-accent" />
            Live preview hosted on Blaxel · Email through AgentMail · Memory via supermemory.ai
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs text-fuchsia-300 font-mono uppercase tracking-widest">
            Never Ship Broken Workflows
          </span>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.06 }}
          className="argo-hero text-[64px] sm:text-[88px] md:text-[124px] text-argo-text mb-6 max-w-6xl"
          style={{ letterSpacing: '-0.05em', lineHeight: 0.96 }}
        >
          Describe your workflow.
          <br />
          <RotatingHeadline />
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
          className="argo-body text-lg sm:text-xl text-argo-textSecondary max-w-2xl mb-10"
        >
          Replit generates code. Lovable prototypes UIs. Argo{' '}
          <span className="text-argo-text">refuses to ship changes that break what already works</span>.
          49 quality checks, 15 security scans, auto-generated regression tests, and human approval
          gates — on every single deploy. One sentence in. Live workflow in 90 seconds. Then it
          operates your business while you sleep.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.24 }}
          className="flex flex-wrap items-center gap-3"
        >
          <LiquidButton
            size="lg"
            onClick={onSignIn}
            className="bg-argo-accent text-argo-bg font-medium rounded-full px-6 py-3 inline-flex items-center gap-2"
          >
            Start building <ArrowRight className="h-4 w-4" />
          </LiquidButton>
          <button
            type="button"
            onClick={() => setView('demo')}
            className="inline-flex items-center gap-2 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-5 py-3 text-sm text-fuchsia-300 hover:bg-fuchsia-500/20 hover:border-fuchsia-500/50 transition-colors"
          >
            <Play className="h-4 w-4" /> See the recruiting demo
          </button>
        </motion.div>

        {/* Floating 3D micro cards */}
        <motion.div
          style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 1400, transformStyle: 'preserve-3d' }}
          className="relative mt-24 h-72 hidden md:block"
        >
          <FloatingCard
            label="cycle 2/3 · gate passed"
            sub="33 / 33 checks · 1.4s"
            icon={<ShieldCheck className="h-4 w-4 text-argo-green" />}
            x="0%" y="0%" z={120} delay={0.0}
          />
          <FloatingCard
            label="write server.js"
            sub="2,134 bytes · argo:generated"
            icon={<FileCode2 className="h-4 w-4 text-argo-accent" />}
            x="36%" y="40%" z={60} delay={0.2}
          />
          <FloatingCard
            label="approval emailed to maya"
            sub="re: jordan reeves · senior frontend"
            icon={<Mail className="h-4 w-4 text-fuchsia-400" />}
            x="68%" y="6%" z={150} delay={0.4}
          />
          <FloatingCard
            label="repair proposed"
            sub="outbound SPF realignment"
            icon={<Bug className="h-4 w-4 text-argo-amber" />}
            x="48%" y="68%" z={30} delay={0.6}
          />
        </motion.div>
      </div>
    </section>
  );
}

function FloatingCard({ label, sub, icon, x, y, z, delay }: { label: string; sub: string; icon: React.ReactNode; x: string; y: string; z: number; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.4 + delay, ease: [0.16, 1, 0.3, 1] }}
      style={{ left: x, top: y, transform: `translateZ(${z}px)` }}
      className="absolute rounded-xl border border-argo-border bg-argo-surface/80 backdrop-blur-md px-3.5 py-2.5 shadow-2xl shadow-argo-accent/10 max-w-[260px]"
    >
      <div className="flex items-center gap-2 text-xs font-mono text-argo-text">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-[10px] font-mono text-argo-textSecondary mt-0.5 truncate">{sub}</div>
    </motion.div>
  );
}

function RotatingHeadline() {
  const phrases = ['ships the production stack.', 'operates it forever.', 'runs your business.'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % phrases.length), 3200);
    return () => clearInterval(id);
  }, [phrases.length]);
  return (
    <span className="inline-block align-baseline">
      <span className="argo-wordmark">Argo</span>{' '}
      <span className="relative inline-block min-w-[14ch]">
        <AnimatePresence mode="wait">
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -20, filter: 'blur(8px)' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 whitespace-nowrap"
          >
            {phrases[i]}
          </motion.span>
        </AnimatePresence>
        <span className="invisible whitespace-nowrap">{phrases[0]}</span>
      </span>
    </span>
  );
}

function GridPattern() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.045]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  );
}

function ConicSweep() {
  return (
    <div
      aria-hidden
      className="absolute -top-1/4 left-1/2 -translate-x-1/2 h-[1200px] w-[1200px] opacity-30 mix-blend-screen pointer-events-none"
      style={{
        background:
          'conic-gradient(from 220deg at 50% 50%, rgba(0,229,204,0) 0deg, rgba(0,229,204,0.08) 40deg, rgba(217,70,239,0.05) 120deg, rgba(0,229,204,0) 200deg, rgba(0,229,204,0) 360deg)',
        animation: 'conicSpin 30s linear infinite',
        borderRadius: '50%',
        filter: 'blur(40px)',
      }}
    >
      <style>{`@keyframes conicSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

function FloatingDots({ count }: { count: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i, x: Math.random() * 100, y: Math.random() * 100,
        delay: Math.random() * 5, duration: 8 + Math.random() * 8,
        size: 1 + Math.random() * 2,
      })),
    [count],
  );
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {dots.map((d) => (
        <motion.span
          key={d.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.6, 0], y: [0, -40, -80] }}
          transition={{ duration: d.duration, delay: d.delay, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute rounded-full bg-argo-accent"
          style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.size, height: d.size, boxShadow: '0 0 8px rgba(0,229,204,0.6)' }}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Trust strip
// ──────────────────────────────────────────────────────────────────────

function TrustStrip() {
  // Workflow archetypes Argo ships. Not customer logos — these are
  // honest descriptions of the operations the system has been
  // designed for.
  const labels = [
    'Candidate intake','Refund triage','Demo bookings','Newsletter pipelines',
    'Support inbox','Approval workflows','Webhook bridges','Subscription onboarding',
    'Form validation','Scheduled digests','Internal tools','Multi-tenant SaaS',
  ];
  return (
    <section className="border-y border-argo-border py-8 overflow-hidden">
      <div className="text-center text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono mb-4">
        Argo is built for the workflows you don't want to babysit
      </div>
      <div className="relative">
        <div className="flex gap-12 animate-[marquee_40s_linear_infinite] whitespace-nowrap">
          {[...labels, ...labels].map((l, i) => (
            <span key={i} className="text-argo-textSecondary/60 font-mono text-sm tracking-wide uppercase">{l}</span>
          ))}
        </div>
        <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-argo-bg to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-argo-bg to-transparent pointer-events-none" />
      </div>
      <style>{`@keyframes marquee { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }`}</style>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Big numbers — animated count-up
// ──────────────────────────────────────────────────────────────────────

function BigNumbers() {
  const stats = [
    { n: 33, suffix: '', label: 'Quality checks', sub: 'Ran in milliseconds, every build' },
    { n: 12, suffix: '', label: 'Specialist personas', sub: 'Auto-routed by the dispatcher' },
    { n: 32, suffix: '', label: 'Reference patterns', sub: 'Cribbed from real production code' },
    { n: 90, suffix: 's', label: 'To live URL', sub: 'Sentence in → public URL out' },
  ];
  return (
    <section className="relative border-b border-argo-border py-28 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 h-[400px] w-[400px] rounded-full bg-argo-accent/10 blur-[120px]" />
        <div className="absolute top-1/2 right-1/4 -translate-y-1/2 h-[400px] w-[400px] rounded-full bg-fuchsia-500/8 blur-[120px]" />
      </div>
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-6 text-center">
          {stats.map((s) => (
            <CountUpStat key={s.label} {...s} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CountUpStat({ n, suffix, label, sub }: { n: number; suffix: string; label: string; sub: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    let started = false;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !started) {
          started = true;
          const duration = 1500;
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setVal(Math.round(n * eased));
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      }
    }, { threshold: 0.4 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [n]);
  return (
    <div ref={ref}>
      <div className="argo-hero text-6xl md:text-8xl text-argo-text" style={{ letterSpacing: '-0.07em', lineHeight: 0.95 }}>
        <span className="argo-wordmark">{val}</span>
        <span className="text-argo-accent">{suffix}</span>
      </div>
      <div className="text-sm text-argo-text mt-4 font-medium" style={{ letterSpacing: '-0.02em' }}>{label}</div>
      <div className="text-xs text-argo-textSecondary mt-1 font-mono uppercase tracking-widest">{sub}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 3D code preview window
// ──────────────────────────────────────────────────────────────────────

function BuildPreview3D() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const rotateX = useTransform(scrollYProgress, [0, 0.5, 1], [22, 0, -10]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.9, 1, 0.95]);
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.4, 1, 1, 0.7]);

  const FILES = [
    { path: 'server.js', tone: 'argo-accent' },
    { path: 'routes/submissions.js', tone: 'argo-accent' },
    { path: 'classifier/score-fit.js', tone: 'argo-accent' },
    { path: 'mailer/templates.js', tone: 'argo-accent' },
    { path: 'security/escape.js', tone: 'argo-textSecondary' },
    { path: 'db/mongo.js', tone: 'argo-textSecondary' },
    { path: 'package.json', tone: 'argo-textSecondary' },
  ];

  return (
    <section ref={ref} className="relative py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center mb-12">
          <h2 className="argo-hero text-4xl md:text-5xl text-argo-text mb-3" style={{ letterSpacing: '-0.05em' }}>
            Watch GPT-5.5 stream the stack.
          </h2>
          <p className="text-argo-textSecondary argo-body max-w-2xl mx-auto">
            Every file-write tag is a file landing in the bundle in real time. Up to three auto-fix
            cycles. The 33-check quality gate runs on every cycle.
          </p>
        </div>
        <motion.div
          style={{ rotateX, scale, opacity, transformPerspective: 1400 }}
          className="relative mx-auto max-w-5xl"
        >
          <div className="relative rounded-2xl border border-argo-border bg-argo-surface shadow-2xl shadow-argo-accent/10 overflow-hidden">
            <div className="flex items-center gap-2 px-4 h-10 border-b border-argo-border bg-argo-bg/40">
              <span className="h-3 w-3 rounded-full bg-argo-red/70" />
              <span className="h-3 w-3 rounded-full bg-argo-amber/70" />
              <span className="h-3 w-3 rounded-full bg-argo-green/70" />
              <span className="ml-3 text-xs font-mono text-argo-textSecondary">argo · candidate-intake · v3 · streaming…</span>
              <span className="ml-auto text-[10px] uppercase tracking-widest text-argo-accent font-mono">gpt-5.5</span>
            </div>
            <div className="flex items-center gap-1 px-3 h-10 border-b border-argo-border bg-argo-bg/20">
              {['Preview','Code','Diff','Replay','Inbox','Memory'].map((t, i) => (
                <span key={t} className={cn('flex items-center gap-1 px-2.5 h-6 rounded text-[11px]', i === 1 ? 'bg-argo-accent/15 text-argo-accent' : 'text-argo-textSecondary')}>{t}</span>
              ))}
              <div className="ml-auto inline-flex items-center gap-2 text-[10px] font-mono text-argo-textSecondary">
                <Cpu className="h-3 w-3" />
                <span>4,231 tok · </span>
                <CircleDollarSign className="h-3 w-3 text-argo-accent" />
                <span className="text-argo-accent">$0.087</span>
              </div>
            </div>
            <div className="grid grid-cols-[200px_1fr]">
              <aside className="border-r border-argo-border py-3 px-2 bg-argo-bg/20">
                {FILES.map((f, i) => (
                  <motion.div
                    key={f.path}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: '-100px' }}
                    transition={{ delay: 0.1 + i * 0.06, duration: 0.3 }}
                    className="flex items-center gap-2 text-xs font-mono px-2 py-1 rounded text-argo-text"
                  >
                    <FileCode2 className={cn('h-3 w-3', `text-${f.tone}`)} />
                    <span className="truncate">{f.path}</span>
                  </motion.div>
                ))}
              </aside>
              <div className="bg-[#0a0a0b] font-mono text-[12px] leading-[1.6] p-4 overflow-hidden">
                <CodeStream />
              </div>
            </div>
            <div className="border-t border-argo-border bg-argo-bg/20 px-4 h-9 flex items-center justify-between text-[11px] font-mono text-argo-textSecondary">
              <span className="inline-flex items-center gap-2">
                <span className="argo-status-dot bg-argo-green" />
                Cycle 2 · gate passed · ready to deploy
              </span>
              <span className="inline-flex items-center gap-3">
                <CheckCircle2 className="h-3 w-3 text-argo-green" />
                <span>33 / 33 checks</span>
                <Zap className="h-3 w-3 text-argo-accent" />
                <span>1.4 s</span>
              </span>
            </div>
          </div>
          <div aria-hidden className="absolute -bottom-12 left-1/2 -translate-x-1/2 h-32 w-[80%] bg-argo-accent/30 blur-[80px] rounded-full" />
        </motion.div>
      </div>
    </section>
  );
}

function CodeStream() {
  const lines = [
    { c: 'argo-textSecondary', t: '// argo:generated' },
    { c: 'fuchsia-300', t: 'import' }, { c: 'argo-text', t: " Fastify from 'fastify';" },
    { c: 'fuchsia-300', t: 'import' }, { c: 'argo-text', t: " { z } from 'zod';" },
    { c: 'fuchsia-300', t: 'import' }, { c: 'argo-text', t: " { db } from '../db/mongo.js';" },
    { c: 'argo-textSecondary', t: '' },
    { c: 'fuchsia-300', t: 'const' }, { c: 'argo-text', t: ' Submission = ' },
    { c: 'argo-accent', t: 'z' }, { c: 'argo-text', t: '.object({' },
    { c: 'argo-textSecondary', t: '  name: ' }, { c: 'argo-accent', t: 'z' }, { c: 'argo-text', t: '.string().min(2).max(120),' },
    { c: 'argo-textSecondary', t: '  email: ' }, { c: 'argo-accent', t: 'z' }, { c: 'argo-text', t: '.string().email(),' },
    { c: 'argo-text', t: '});' },
    { c: 'argo-textSecondary', t: '' },
    { c: 'fuchsia-300', t: 'export async function' }, { c: 'amber-300', t: ' registerSubmissions' },
    { c: 'argo-text', t: '(app) {' },
    { c: 'argo-text', t: "  app.post('/submissions', " },
    { c: 'fuchsia-300', t: 'async' }, { c: 'argo-text', t: ' (request, reply) => {' },
    { c: 'argo-textSecondary', t: '    request.log.info({ ip: request.ip }, ' },
    { c: 'argo-green', t: "'inbound_submission'" }, { c: 'argo-text', t: ');' },
    { c: 'argo-textSecondary', t: '    // ...validate, classify, persist, mail' },
    { c: 'argo-text', t: '  });' }, { c: 'argo-text', t: '}' },
  ];
  return (
    <div>
      {lines.map((l, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -6 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ delay: 0.05 * i, duration: 0.2 }}
          className={cn('whitespace-pre', `text-${l.c}`)}
        >
          {l.t || ' '}
        </motion.div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Specialists
// ──────────────────────────────────────────────────────────────────────

function SpecialistsSection() {
  return (
    <section id="specialists" className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Specialist library</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            Twelve personas. One auto-routing dispatcher.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            Argo dispatches your brief to the persona that owns the right shape — REST APIs ship with
            OpenAPI, webhooks ship with HMAC + DLQ, SaaS ships with RBAC + migrations.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SPECIALIST_DEMOS.map((d, i) => (
            <TiltCard key={d.persona} demo={d} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TiltCard({ demo, index }: { demo: (typeof SPECIALIST_DEMOS)[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const rotX = useMotionValue(0);
  const rotY = useMotionValue(0);
  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rotX.set((py - 0.5) * -10);
    rotY.set((px - 0.5) * 10);
  };
  const onLeave = () => { rotX.set(0); rotY.set(0); };

  return (
    <motion.article
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1200 }}
      className="group relative overflow-hidden rounded-2xl border border-argo-border bg-argo-surface/50 p-6 transition-colors hover:border-argo-accent/40"
    >
      <div className={cn('pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500', demo.glow)} />
      <div className="relative">
        <div className="text-xs uppercase tracking-widest text-argo-accent font-mono mb-3">
          {demo.persona.replace(/_/g, ' ')}
        </div>
        <h3 className="text-xl text-argo-text mb-3" style={{ letterSpacing: '-0.04em' }}>{demo.title}</h3>
        <blockquote className="text-sm text-argo-textSecondary argo-body italic border-l-2 border-argo-border pl-3 mb-4">
          "{demo.sentence}"
        </blockquote>
        <div className="text-xs font-mono text-argo-text bg-argo-bg/60 border border-argo-border rounded px-3 py-2">
          → {demo.output}
        </div>
      </div>
    </motion.article>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Sentence-to-Stack split-screen
// ──────────────────────────────────────────────────────────────────────

function SentenceToStack() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 20%'] });
  const sentence = '"Candidates apply via a form. Reject most politely, forward strong matches to the hiring client."';
  const visibleChars = useTransform(scrollYProgress, [0, 0.5], [0, sentence.length]);
  const fileCount = useTransform(scrollYProgress, [0.4, 1], [0, 8]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState(0);

  useEffect(() => {
    return visibleChars.on('change', (v) => setText(sentence.slice(0, Math.round(v))));
  }, [visibleChars, sentence]);
  useEffect(() => {
    return fileCount.on('change', (v) => setFiles(Math.max(0, Math.round(v))));
  }, [fileCount]);

  const FILES = [
    'server.js','routes/submissions.js','classifier/score-fit.js','mailer/templates.js',
    'security/escape.js','db/mongo.js','tests/happy-path.test.js','package.json',
  ];

  return (
    <section ref={ref} className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Sentence → stack</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            Scroll to watch one sentence become eight files.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            The split-screen below is synchronised to your scroll. Left: what the operator typed. Right:
            the files Argo wrote.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[420px]">
          <div className="rounded-2xl border border-argo-border bg-argo-surface/30 p-8 flex items-center">
            <div>
              <div className="text-xs uppercase tracking-widest text-argo-textSecondary font-mono mb-3">Operator says</div>
              <p className="argo-hero text-2xl md:text-3xl text-argo-text leading-snug" style={{ letterSpacing: '-0.03em' }}>
                {text}
                <span className="inline-block w-[2px] h-7 bg-argo-accent ml-1 animate-pulse align-middle" />
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-argo-border bg-argo-surface/30 p-6">
            <div className="text-xs uppercase tracking-widest text-argo-textSecondary font-mono mb-3 flex items-center gap-2">
              <FileCode2 className="h-3 w-3 text-argo-accent" /> Argo writes
              <span className="ml-auto font-mono text-argo-accent">{files} / 8</span>
            </div>
            <ul className="space-y-1.5">
              {FILES.map((f, i) => (
                <li
                  key={f}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md font-mono text-sm transition-all duration-300',
                    i < files
                      ? 'bg-argo-accent/10 text-argo-text border border-argo-accent/30'
                      : 'bg-argo-bg/40 text-argo-textSecondary/40 border border-transparent',
                  )}
                >
                  {i < files ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-argo-green" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-argo-textSecondary/30" />
                  )}
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// How it works timeline
// ──────────────────────────────────────────────────────────────────────

function HowItWorksTimeline() {
  return (
    <section id="how" className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">The flow</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            Four moves. About 90 seconds end-to-end.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            From "I want a form that…" to a live URL the operator can drop into their site —
            and then everything happens from email.
          </p>
        </div>
        <div className="relative max-w-4xl mx-auto">
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-argo-accent/40 via-argo-border to-transparent" />
          <ul className="space-y-16">
            {HOW_IT_WORKS.map((s, i) => (
              <TimelineStep key={s.n} step={s} index={i} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TimelineStep({ step, index }: { step: (typeof HOW_IT_WORKS)[number]; index: number }) {
  const Icon = step.icon;
  const isLeft = index % 2 === 0;
  return (
    <li className="relative">
      <div className="md:grid md:grid-cols-2 md:gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: isLeft ? -30 : 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={cn('pl-16 md:pl-0', isLeft ? 'md:text-right md:pr-12' : 'md:order-2 md:pl-12')}
        >
          <div className="text-xs uppercase tracking-widest text-argo-accent font-mono mb-2">Step {step.n}</div>
          <h3 className="argo-hero text-2xl md:text-3xl text-argo-text mb-3" style={{ letterSpacing: '-0.04em' }}>{step.title}</h3>
          <p className="text-argo-textSecondary argo-body mb-2">{step.body}</p>
          <p className="text-xs font-mono text-argo-textSecondary/80 leading-relaxed">{step.detail}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute left-0 md:left-1/2 -translate-y-1 md:-translate-x-1/2 inline-flex items-center justify-center h-14 w-14 rounded-full border border-argo-accent/40 bg-argo-bg shadow-lg shadow-argo-accent/10"
        >
          <Icon className="h-5 w-5 text-argo-accent" />
        </motion.div>
        <div className={cn('hidden md:block', isLeft ? 'md:order-2' : '')} />
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Pinned build loop — sticky scrubber through 3 cycles
// ──────────────────────────────────────────────────────────────────────

function PinnedBuildLoop() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  // 3 cycles + final = 4 phases
  const phase = useTransform(scrollYProgress, [0, 0.33, 0.66, 1], [0, 1, 2, 3]);
  const [p, setP] = useState(0);
  useEffect(() => phase.on('change', (v) => setP(Math.min(3, Math.floor(v * 1.001)))), [phase]);

  const cycles = [
    { label: 'Cycle 1', files: 6, errors: 4, status: 'failed', notes: ['no_console_log','helmet_registered','body_limit_set','request_logger_in_handlers'] },
    { label: 'Cycle 2', files: 8, errors: 1, status: 'failed', notes: ['mongo_collection_has_indexes'] },
    { label: 'Cycle 3', files: 8, errors: 0, status: 'passed', notes: [] },
    { label: 'Deployed', files: 8, errors: 0, status: 'live', notes: [] },
  ];
  const c = cycles[p]!;

  return (
    <section ref={ref} className="relative border-t border-argo-border" style={{ height: '300vh' }}>
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[1000px] bg-argo-accent/10 blur-[120px] rounded-full" />
        </div>
        <div className="mx-auto max-w-7xl px-6 w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Auto-fix loop</span>
              <h2 className="argo-hero text-4xl md:text-6xl mt-2 mb-4 text-argo-text" style={{ letterSpacing: '-0.05em', lineHeight: 1.0 }}>
                Three cycles to <span className="argo-wordmark">production-grade</span>.
              </h2>
              <p className="text-argo-textSecondary argo-body mb-6">
                Scroll to step through Argo's auto-fix loop. Cycle 1 misses some checks; cycle 2 patches
                most; cycle 3 lands clean. Most real builds pass on the first.
              </p>
              <div className="flex items-center gap-2">
                {cycles.map((cc, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 h-1 rounded-full transition-all duration-300',
                      i <= p ? (cc.status === 'failed' ? 'bg-argo-amber' : cc.status === 'passed' ? 'bg-argo-green' : 'bg-argo-accent') : 'bg-argo-border',
                    )}
                  />
                ))}
              </div>
              <div className="mt-3 text-xs font-mono uppercase tracking-widest text-argo-textSecondary">
                {p + 1} / 4 — scroll to advance
              </div>
            </div>
            <motion.div
              key={p}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative rounded-2xl border border-argo-border bg-argo-surface/60 backdrop-blur-md p-6 shadow-2xl shadow-argo-accent/10"
            >
              <div className="flex items-center justify-between mb-4">
                <span className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-widest',
                  c.status === 'failed' ? 'border-argo-amber/40 bg-argo-amber/10 text-argo-amber'
                  : c.status === 'passed' ? 'border-argo-green/40 bg-argo-green/10 text-argo-green'
                  : 'border-argo-accent/40 bg-argo-accent/10 text-argo-accent',
                )}>
                  {c.status === 'live' ? <Rocket className="h-3 w-3" /> : c.status === 'passed' ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                  {c.label}
                </span>
                <span className="text-xs font-mono text-argo-textSecondary">
                  {c.files} files · {c.errors} {c.errors === 1 ? 'error' : 'errors'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mb-4">
                {Array.from({ length: 33 }, (_, i) => {
                  const failedHere = i < c.errors;
                  return (
                    <div
                      key={i}
                      className={cn(
                        'h-2 rounded-full',
                        c.status === 'live' ? 'bg-argo-accent' : failedHere ? 'bg-argo-amber' : 'bg-argo-green/70',
                      )}
                    />
                  );
                })}
              </div>
              {c.notes.length > 0 ? (
                <div className="text-xs font-mono text-argo-amber bg-argo-amber/5 border border-argo-amber/20 rounded p-3">
                  <div className="text-[10px] uppercase tracking-widest mb-1.5">Re-prompting GPT-5.5 with:</div>
                  <ul className="space-y-1">
                    {c.notes.map((n) => (
                      <li key={n} className="flex items-center gap-1.5">
                        <ShieldAlert className="h-3 w-3" /> {n}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : c.status === 'live' ? (
                <div className="text-xs font-mono text-argo-accent bg-argo-accent/5 border border-argo-accent/20 rounded p-3 flex items-center gap-2">
                  <Rocket className="h-3 w-3" /> live at demo.argo.run/candidate-intake-3 — 1.4s end-to-end
                </div>
              ) : (
                <div className="text-xs font-mono text-argo-green bg-argo-green/5 border border-argo-green/20 rounded p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3" /> 33 / 33 checks · ready to ship
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Quality gate marquee
// ──────────────────────────────────────────────────────────────────────

function QualityGateMarquee() {
  const half = Math.ceil(QUALITY_CHECKS.length / 2);
  const row1 = QUALITY_CHECKS.slice(0, half);
  const row2 = QUALITY_CHECKS.slice(half);
  return (
    <section id="quality" className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 mb-12">
        <div className="max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Quality gate</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            33 checks. Milliseconds. Every build.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            Argo refuses to deploy code that fails the gate. Failures become a structured error
            report; the auto-fix loop re-prompts GPT-5.5 with it. Up to three cycles. Most builds
            pass on the first.
          </p>
        </div>
      </div>
      <CheckMarquee checks={row1} direction="left" />
      <div className="h-3" />
      <CheckMarquee checks={row2} direction="right" />
      <style>{`
        @keyframes marqueeL { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes marqueeR { 0%{transform:translateX(-50%)} 100%{transform:translateX(0)} }
      `}</style>
    </section>
  );
}

function CheckMarquee({ checks, direction }: { checks: string[]; direction: 'left' | 'right' }) {
  return (
    <div className="relative">
      <div className={cn('flex gap-3 whitespace-nowrap', direction === 'left' ? 'animate-[marqueeL_50s_linear_infinite]' : 'animate-[marqueeR_50s_linear_infinite]')}>
        {[...checks, ...checks].map((c, i) => (
          <span key={i} className="inline-flex items-center gap-2 rounded-full border border-argo-border bg-argo-surface/40 px-3 py-1.5 text-xs font-mono text-argo-textSecondary">
            <CheckCircle2 className="h-3 w-3 text-argo-green flex-shrink-0" />
            {c}
          </span>
        ))}
      </div>
      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-argo-bg to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-argo-bg to-transparent pointer-events-none" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Architecture diagram
// ──────────────────────────────────────────────────────────────────────

function ArchitectureDiagram() {
  return (
    <section className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Architecture</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            One operation, one sandbox, one inbox.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            Each Argo operation gets its own Blaxel sandbox, its own Mongo namespace, its own
            outbound mail identity. Failures in one operation can't reach another.
          </p>
        </div>
        <div className="relative h-[280px] rounded-2xl border border-argo-border bg-argo-surface/30 overflow-hidden">
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {ARCHITECTURE_NODES.slice(0, -1).map((n, i) => {
              const next = ARCHITECTURE_NODES[i + 1]!;
              return (
                <motion.line
                  key={i}
                  x1={n.x} y1={n.y} x2={next.x} y2={next.y}
                  stroke="rgba(0,229,204,0.4)" strokeWidth="0.4" strokeDasharray="2 1.5"
                  initial={{ pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 1.4, delay: 0.1 + i * 0.15 }}
                />
              );
            })}
          </svg>
          {ARCHITECTURE_NODES.map((n, i) => {
            const Icon = n.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.6 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.4, delay: 0.2 + i * 0.15 }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5"
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
              >
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-argo-accent/30 blur-md" />
                  <div className="relative h-12 w-12 rounded-full border border-argo-accent/40 bg-argo-bg flex items-center justify-center">
                    <Icon className="h-5 w-5 text-argo-accent" />
                  </div>
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-argo-textSecondary text-center max-w-[12ch]">{n.label}</span>
              </motion.div>
            );
          })}
          <motion.span
            initial={{ left: '8%', top: '50%' }}
            animate={{ left: ['8%','26%','46%','64%','82%','92%'], top: ['50%','35%','50%','35%','50%','18%'] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute h-2 w-2 rounded-full bg-argo-accent"
            style={{ boxShadow: '0 0 12px rgba(0,229,204,0.9)' }}
            aria-hidden
          />
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: 3D rotating tech-stack cube
// ──────────────────────────────────────────────────────────────────────

function TechStackCube() {
  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">The stack</span>
            <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
              Six pieces. No exotic dependencies.
            </h2>
            <p className="text-argo-textSecondary argo-body mb-6">
              Argo writes a stack you could read in an afternoon. Typed Fastify routes. Zod validators.
              Mongo persistence. GPT-5.5 for synthesis. Blaxel for the sandbox. AgentMail for the inbox.
              Boring choices, audited code, predictable bills.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {TECH_STACK.map((t) => (
                <div key={t.label} className="flex items-baseline gap-2">
                  <span className="argo-status-dot bg-argo-accent" />
                  <span className="text-argo-text font-mono">{t.label}</span>
                  <span className="text-argo-textSecondary text-xs">{t.sub}</span>
                </div>
              ))}
            </div>
          </div>
          <CubeViz />
        </div>
      </div>
    </section>
  );
}

function CubeViz() {
  return (
    <div className="relative h-[420px] flex items-center justify-center">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,229,204,0.18),transparent_60%)]" aria-hidden />
      <div
        className="relative"
        style={{
          width: 240, height: 240,
          perspective: 1200,
        }}
      >
        <motion.div
          animate={{ rotateX: 360, rotateY: 360 }}
          transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          style={{
            width: 240, height: 240,
            position: 'relative',
            transformStyle: 'preserve-3d',
          }}
        >
          {[
            { face: 'front',  t: 'translateZ(120px)', label: 'Fastify',   sub: 'Typed routes' },
            { face: 'back',   t: 'rotateY(180deg) translateZ(120px)', label: 'Zod',       sub: 'Validation' },
            { face: 'right',  t: 'rotateY(90deg) translateZ(120px)',  label: 'Mongo',     sub: 'Persistence' },
            { face: 'left',   t: 'rotateY(-90deg) translateZ(120px)', label: 'GPT-5.5',   sub: 'Synthesis' },
            { face: 'top',    t: 'rotateX(90deg) translateZ(120px)',  label: 'Blaxel',    sub: 'Sandbox' },
            { face: 'bottom', t: 'rotateX(-90deg) translateZ(120px)', label: 'AgentMail', sub: 'Inbox' },
          ].map((f) => (
            <div
              key={f.face}
              className="absolute inset-0 rounded-2xl border border-argo-accent/40 bg-argo-surface/80 backdrop-blur-md flex flex-col items-center justify-center text-center px-4"
              style={{ transform: f.t, boxShadow: '0 0 40px rgba(0,229,204,0.15)' }}
            >
              <div className="argo-hero text-2xl text-argo-text mb-1" style={{ letterSpacing: '-0.04em' }}>{f.label}</div>
              <div className="text-[10px] uppercase tracking-widest text-argo-accent font-mono">{f.sub}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Email approval mockup
// ──────────────────────────────────────────────────────────────────────

function EmailApprovalMockup() {
  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Operate from email</span>
            <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-4 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
              Three buttons. Never more.
            </h2>
            <p className="text-argo-textSecondary argo-body mb-4">
              When a strong candidate arrives, when a refund needs sign-off, when something breaks —
              Argo emails you with everything you need to decide in 10 seconds. No dashboard to open,
              no thread to scroll.
            </p>
            <ul className="space-y-3 text-sm text-argo-text">
              <li className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-argo-green flex-shrink-0" /> Signed approval tokens — link can't be replayed</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-argo-green flex-shrink-0" /> 4-minute hold window before any send</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-argo-green flex-shrink-0" /> Trust ratchet on the first 10 sends per template</li>
            </ul>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20, rotateY: -10 }}
            whileInView={{ opacity: 1, y: 0, rotateY: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformPerspective: 1200 }}
            className="relative"
          >
            <div className="absolute -inset-6 bg-argo-accent/10 blur-[80px] rounded-full" aria-hidden />
            <div className="relative rounded-2xl border border-argo-border bg-argo-surface shadow-2xl shadow-argo-accent/20 overflow-hidden max-w-md ml-auto">
              <div className="px-5 py-3 border-b border-argo-border bg-argo-bg/30">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-argo-text">
                    <div className="h-7 w-7 rounded-full bg-argo-accent/20 text-argo-accent inline-flex items-center justify-center font-mono">A</div>
                    <div>
                      <div className="font-medium">Argo · Candidate Intake</div>
                      <div className="text-argo-textSecondary text-[11px]">argo@hello.argo.run · 9:42 AM</div>
                    </div>
                  </div>
                  <div className="text-argo-textSecondary text-[11px]">to you@youroperation.co</div>
                </div>
              </div>
              <div className="px-5 py-5">
                <div className="text-base text-argo-text mb-3" style={{ letterSpacing: '-0.02em' }}>
                  Approve forwarding this candidate to the hiring client?
                </div>
                <p className="text-sm text-argo-textSecondary argo-body mb-4">
                  Senior Frontend · 5 years · scored 0.87 against the role brief.<br />
                  Cover letter mentions React Server Components — strong fit for the role.
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <button className="inline-flex items-center gap-1.5 rounded-full bg-argo-accent text-argo-bg text-sm font-medium px-4 py-2 hover:opacity-90 transition-opacity">
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button className="inline-flex items-center gap-1.5 rounded-full border border-argo-border text-argo-text text-sm font-medium px-4 py-2 hover:border-argo-accent/40 transition-colors">
                    Edit first
                  </button>
                  <button className="inline-flex items-center gap-1.5 rounded-full border border-argo-border text-argo-textSecondary text-sm font-medium px-4 py-2 hover:text-argo-text transition-colors">
                    Decline
                  </button>
                </div>
                <div className="text-[11px] text-argo-textSecondary font-mono border-t border-argo-border/60 pt-3 leading-relaxed">
                  Argo holds for 4 minutes before sending — that's your window to override.<br />
                  Reply STOP to pause this template. Reply MORE for the full reasoning trace.
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Feature pillars
// ──────────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Sparkles, title: 'Specialists, not chatboxes', body: '12 personas pick the right shape: REST · CRUD · scraper · scheduled job · webhook bridge · Slack bot · form workflow · multi-tenant SaaS · agent runtime · data pipeline · search service · internal tool.' },
  { icon: ShieldCheck, title: '33-check quality gate', body: 'No console.log · no eval · no inlined secrets · no localhost. SIGTERM handlers. Health routes. Helmet · body limits · error handlers · Mongo indexes · request logger. Auto-fixes until green.' },
  { icon: Brain, title: 'Persistent operator memory', body: 'Argo remembers your voice, your client quirks, the workflows you already approved. Backed by supermemory.ai. You see and prune everything in the Memory tab.' },
  { icon: Inbox, title: 'Operate from email', body: 'Approve / Edit / Decline — three buttons, never more. Monday digest as prose. The trust ratchet gates the first 10 sends per template so you never ship a typo at scale.' },
  { icon: Bug, title: 'Self-healing repairs', body: 'When something breaks in production, Argo detects it, proposes a patch, runs the synthetic test suite against it, and emails you for approval. Never auto-applies.' },
  { icon: Boxes, title: 'Per-operation isolation', body: 'Every operation gets its own Blaxel sandbox + its own Mongo namespace + its own outbound mail identity. A failure in one operation can\'t reach another.' },
  { icon: Network, title: 'Auditor-grade transparency', body: 'Code tab is read-only with full bundle search. Replay tab shows every agent invocation with cost, duration, and PII-redacted envelope. Diff tab compares any two bundle versions.' },
  { icon: Lock, title: 'Magic-link only auth', body: 'No passwords. No SSO complexity. Magic link in, session cookie out. Every operation is owner-scoped at the database layer with row-level isolation.' },
] as const;

function FeaturePillars() {
  return (
    <section className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Why operators pick Argo</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            Replit gives you a prototype. Argo gives you an operator.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            Generic AI vibe coders ship code that looks fine and breaks on Tuesday. Argo's output
            ships through the same checks a senior engineer would run before deploy.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              className="group rounded-xl border border-argo-border bg-argo-surface/40 p-5 hover:border-argo-accent/40 hover:bg-argo-surface/70 transition-colors"
            >
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-argo-accent/15 text-argo-accent mb-4 group-hover:bg-argo-accent/25 transition-colors">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="text-base text-argo-text mb-2" style={{ letterSpacing: '-0.03em' }}>{f.title}</h3>
              <p className="text-xs text-argo-textSecondary argo-body leading-relaxed">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Personas carousel
// ──────────────────────────────────────────────────────────────────────

function PersonasCarousel() {
  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Who Argo is built for</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            Four archetypes. One thing in common: they don't want to learn AWS to ship a refund flow.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            Argo is for people running businesses on glue code. Not for developers shopping for a
            faster IDE. The wedge isn't "ship code with AI." It's "stop opening the dashboard."
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {ARCHETYPES.map((a, i) => (
            <motion.article
              key={a.role}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="group relative rounded-2xl border border-argo-border bg-argo-surface/40 p-6 hover:border-argo-accent/40 hover:bg-argo-surface/60 transition-colors overflow-hidden"
            >
              <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-argo-accent/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <div className="text-xs uppercase tracking-widest text-argo-accent font-mono mb-3">
                  Archetype 0{i + 1}
                </div>
                <h3 className="argo-hero text-2xl text-argo-text mb-4" style={{ letterSpacing: '-0.04em' }}>
                  {a.role}
                </h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono mb-1">
                      Today
                    </div>
                    <p className="text-argo-textSecondary argo-body leading-relaxed">{a.pain}</p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-argo-accent font-mono mb-1">
                      With Argo
                    </div>
                    <p className="text-argo-text argo-body leading-relaxed">{a.win}</p>
                  </div>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Comparison table
// ──────────────────────────────────────────────────────────────────────

function ComparisonTable() {
  return (
    <section id="vs" className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">vs the field</span>
          <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
            What Argo does that other vibe coders don't.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            We respect Replit, Lovable, and Bolt — they unlocked a generation. Argo is a different
            wedge: not "generate a one-shot prototype" but "operate the workflow forever."
          </p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-argo-border bg-argo-surface/30">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-argo-border">
                <th className="text-left text-xs uppercase tracking-widest text-argo-textSecondary font-mono px-6 py-4">Capability</th>
                <th className="text-center text-xs uppercase tracking-widest text-argo-accent font-mono px-4 py-4">Argo</th>
                <th className="text-center text-xs uppercase tracking-widest text-argo-textSecondary font-mono px-4 py-4">kis.ai</th>
                <th className="text-center text-xs uppercase tracking-widest text-argo-textSecondary font-mono px-4 py-4">Replit</th>
                <th className="text-center text-xs uppercase tracking-widest text-argo-textSecondary font-mono px-4 py-4">Lovable</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.feature} className="border-b border-argo-border/40 last:border-b-0">
                  <td className="px-6 py-3.5 text-sm text-argo-text">{row.feature}</td>
                  <td className="px-4 py-3.5 text-center"><Cell v={row.argo} highlight /></td>
                  <td className="px-4 py-3.5 text-center"><Cell v={row.kis} /></td>
                  <td className="px-4 py-3.5 text-center"><Cell v={row.replit} /></td>
                  <td className="px-4 py-3.5 text-center"><Cell v={row.lovable} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Cell({ v, highlight }: { v: boolean | string; highlight?: boolean }) {
  if (v === true) {
    return (
      <span className={cn('inline-flex items-center justify-center h-5 w-5 rounded-full', highlight ? 'bg-argo-accent text-argo-bg' : 'bg-argo-green/15 text-argo-green')}>
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (v === false) return <span className="text-argo-textSecondary/40 font-mono text-sm">—</span>;
  if (v === 'partial') return <span className="text-argo-amber font-mono text-xs uppercase">partial</span>;
  return <span className={cn('font-mono text-xs uppercase', highlight ? 'text-argo-accent' : 'text-argo-textSecondary')}>{v}</span>;
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Globe / world section
// ──────────────────────────────────────────────────────────────────────

function GlobeSection() {
  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Anywhere</span>
            <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
              Operations live where your operators are.
            </h2>
            <p className="text-argo-textSecondary argo-body mb-6">
              Blaxel runs sandboxes in regions close to your data. AgentMail dispatches from
              region-local senders so SPF and DKIM align. Memory is per-owner. The whole pipeline is
              quiet, distributed, and private.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-argo-accent" /> us-east-1</div>
              <div className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-argo-accent" /> eu-west-2</div>
              <div className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-argo-accent" /> ap-south-1</div>
              <div className="flex items-center gap-2"><Server className="h-3.5 w-3.5 text-argo-accent" /> sa-east-1</div>
            </div>
          </div>
          <WorldMap />
        </div>
      </div>
    </section>
  );
}

function WorldMap() {
  // Stylised dotted "world map" via a grid mask + city pulses on top.
  return (
    <div className="relative h-[360px] rounded-2xl border border-argo-border bg-argo-surface/30 overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <DottedWorld />
      </div>
      <div className="absolute inset-0">
        {CITY_NODES.map((c, i) => (
          <div
            key={c.city}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          >
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full bg-argo-accent animate-ping"
                style={{ animationDelay: `${(i * 0.4) % 3}s`, animationDuration: '2.5s', height: 12, width: 12 }}
              />
              <div className="relative h-3 w-3 rounded-full bg-argo-accent" style={{ boxShadow: '0 0 12px rgba(0,229,204,0.9)' }} />
            </div>
            <div className="absolute left-3 top-1 text-[10px] font-mono uppercase tracking-widest text-argo-textSecondary whitespace-nowrap">
              {c.city}
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent,rgba(10,10,11,0.4))] pointer-events-none" />
    </div>
  );
}

function DottedWorld() {
  // Generate a dot grid that approximates continents via a few coverage blobs.
  const dots = useMemo(() => {
    const arr: Array<{ x: number; y: number; on: boolean }> = [];
    const cols = 80;
    const rows = 32;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c / cols) * 100;
        const y = (r / rows) * 100;
        // Rough continent masks
        const inNA = x > 12 && x < 30 && y > 25 && y < 50;
        const inSA = x > 25 && x < 38 && y > 55 && y < 80;
        const inEU = x > 44 && x < 55 && y > 25 && y < 40;
        const inAF = x > 45 && x < 58 && y > 40 && y < 65;
        const inAS = x > 55 && x < 80 && y > 25 && y < 60;
        const inAU = x > 78 && x < 92 && y > 65 && y < 80;
        const on = (inNA || inSA || inEU || inAF || inAS || inAU) && Math.random() > 0.3;
        arr.push({ x, y, on });
      }
    }
    return arr;
  }, []);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
      {dots.map((d, i) =>
        d.on ? <circle key={i} cx={d.x} cy={d.y} r="0.35" fill="rgba(0,229,204,0.5)" /> : null,
      )}
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Memory neural visualization
// ──────────────────────────────────────────────────────────────────────

function MemoryNeuralViz() {
  // Simple constellation: 24 nodes in a randomised layout, lines between
  // close pairs, each line animated with a stroke-dashoffset pulse.
  const nodes = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: 8 + Math.random() * 84,
      y: 10 + Math.random() * 80,
    }));
  }, []);
  const edges = useMemo(() => {
    const out: Array<{ a: number; b: number }> = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i]!.x - nodes[j]!.x;
        const dy = nodes[i]!.y - nodes[j]!.y;
        if (dx * dx + dy * dy < 230) out.push({ a: i, b: j });
      }
    }
    return out;
  }, [nodes]);

  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="relative h-[400px] rounded-2xl border border-argo-border bg-argo-surface/30 overflow-hidden order-2 md:order-1">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
              {edges.map((e, i) => {
                const A = nodes[e.a]!;
                const B = nodes[e.b]!;
                return (
                  <motion.line
                    key={i}
                    x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                    stroke="rgba(0,229,204,0.3)"
                    strokeWidth="0.18"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 1.2, delay: i * 0.02 }}
                  />
                );
              })}
              {nodes.map((n, i) => (
                <motion.circle
                  key={n.id}
                  cx={n.x} cy={n.y} r="0.7"
                  fill="rgba(0,229,204,0.95)"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 3 + (i % 4), repeat: Infinity, delay: i * 0.1 }}
                />
              ))}
            </svg>
          </div>
          <div className="order-1 md:order-2">
            <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Memory</span>
            <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
              Argo remembers what you taught it once.
            </h2>
            <p className="text-argo-textSecondary argo-body mb-6">
              Voice tone, client quirks, the refunds you already approved, the wording you hate.
              Backed by supermemory.ai. Visible in the Memory tab — every fact, with a delete button.
              Black-box memory feels creepy. A visible, editable list feels like an assistant taking
              notes.
            </p>
            <ul className="space-y-2.5 text-sm text-argo-text">
              <li className="flex items-center gap-3"><Fingerprint className="h-4 w-4 text-argo-accent flex-shrink-0" /> Owner-scoped at the storage layer</li>
              <li className="flex items-center gap-3"><Fingerprint className="h-4 w-4 text-argo-accent flex-shrink-0" /> Folded into every build prompt</li>
              <li className="flex items-center gap-3"><Fingerprint className="h-4 w-4 text-argo-accent flex-shrink-0" /> One-click forget for any fact</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Refusals scroll wall
// ──────────────────────────────────────────────────────────────────────

function RefusalsScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  return (
    <section ref={ref} className="border-t border-argo-border py-40 overflow-hidden">
      <div className="mx-auto max-w-5xl px-6">
        <div className="text-center mb-16">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">What we refuse</span>
        </div>
        <ul className="space-y-12 md:space-y-16">
          {REFUSALS.map((r, i) => (
            <RefusalLine key={r} text={r} index={i} progress={scrollYProgress} count={REFUSALS.length} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function RefusalLine({ text, index, progress, count }: { text: string; index: number; progress: MotionValue<number>; count: number }) {
  const start = (index / count) * 0.7;
  const end = start + 0.18;
  const opacity = useTransform(progress, [start, end, end + 0.2], [0.15, 1, 0.4]);
  const x = useTransform(progress, [start, end], [-30, 0]);
  return (
    <motion.li
      style={{ opacity, x }}
      className="argo-hero text-3xl md:text-5xl lg:text-6xl text-argo-text text-center"
    >
      {text}
    </motion.li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Coding tools vs operator (the wedge)
// ──────────────────────────────────────────────────────────────────────

const VS_ROWS = [
  { dev: 'A VS Code workspace', op: 'No IDE. The workspace is a webpage.' },
  { dev: 'A REST / GraphQL / gRPC autogen', op: 'A typed Fastify route the operator never has to read.' },
  { dev: 'A Kubernetes-ready Helm chart', op: 'A Blaxel sandbox the operator never has to deploy.' },
  { dev: 'An LLM gateway with multi-modal access', op: 'GPT-5.5 + Opus 4.7 routed by intent. The operator never picks a model.' },
  { dev: '50+ integrations to configure', op: 'The integrations the brief actually needs, wired by the persona.' },
  { dev: 'YAML + JavaScript you maintain in Git', op: 'A bundle the operator never opens unless an auditor asks.' },
  { dev: 'A "Book a demo" CTA gated by sales', op: 'Magic link in. Live URL out. Ninety seconds.' },
];

function CodingToolsVsOperator() {
  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[800px] rounded-full bg-fuchsia-500/8 blur-[120px]" />
      </div>
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">The wedge</span>
          <h2 className="argo-hero text-4xl md:text-6xl mt-2 mb-4 text-argo-text" style={{ letterSpacing: '-0.05em', lineHeight: 1.0 }}>
            Coding tools build a thing.
            <br />
            <span className="argo-wordmark">Argo runs it.</span>
          </h2>
          <p className="text-argo-textSecondary argo-body">
            The "AI development partner" category — IDEs, code-gen platforms, dev workspaces — is
            already crowded. They're great for developers. They're useless for operators. Argo is
            the other thing.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-argo-border rounded-2xl overflow-hidden border border-argo-border">
          <div className="bg-argo-bg p-6">
            <div className="text-xs uppercase tracking-widest text-argo-textSecondary font-mono mb-4 flex items-center gap-2">
              <Terminal className="h-3 w-3" /> Coding tools give you
            </div>
            <ul className="space-y-3">
              {VS_ROWS.map((r, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="flex items-start gap-3 text-sm text-argo-textSecondary border-b border-argo-border/40 pb-3 last:border-b-0 last:pb-0"
                >
                  <span className="text-argo-textSecondary/40 font-mono mt-0.5 flex-shrink-0">—</span>
                  <span>{r.dev}</span>
                </motion.li>
              ))}
            </ul>
          </div>
          <div className="bg-argo-bg relative p-6">
            <div className="absolute inset-0 bg-gradient-to-br from-argo-accent/5 to-transparent pointer-events-none" />
            <div className="relative">
              <div className="text-xs uppercase tracking-widest text-argo-accent font-mono mb-4 flex items-center gap-2">
                <Rocket className="h-3 w-3" /> Argo gives you
              </div>
              <ul className="space-y-3">
                {VS_ROWS.map((r, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: 10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: '-80px' }}
                    transition={{ duration: 0.4, delay: i * 0.05 + 0.1 }}
                    className="flex items-start gap-3 text-sm text-argo-text border-b border-argo-border/40 pb-3 last:border-b-0 last:pb-0"
                  >
                    <CheckCircle2 className="h-4 w-4 text-argo-accent mt-0.5 flex-shrink-0" />
                    <span>{r.op}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-10 text-center text-argo-textSecondary argo-body italic max-w-2xl mx-auto">
          If you're a developer shopping for a faster IDE, every other tool in this market is for
          you. If you're an operator shopping for the workflow you don't want to babysit, there's
          only one Argo.
        </p>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// NEW: Integrations constellation — typed registry surfaced as a graph
// ──────────────────────────────────────────────────────────────────────

const INTEGRATIONS = [
  { name: 'Stripe', tier: 'core', x: 50, y: 22 },
  { name: 'Slack', tier: 'core', x: 28, y: 30 },
  { name: 'Mongo', tier: 'core', x: 72, y: 30 },
  { name: 'Postgres', tier: 'core', x: 78, y: 50 },
  { name: 'Redis', tier: 'core', x: 22, y: 50 },
  { name: 'AgentMail', tier: 'core', x: 50, y: 50 },
  { name: 'SendGrid', tier: 'mail', x: 60, y: 70 },
  { name: 'Twilio', tier: 'mail', x: 38, y: 72 },
  { name: 'Calendly', tier: 'sched', x: 80, y: 75 },
  { name: 'Discord', tier: 'chat', x: 18, y: 70 },
  { name: 'Gmail', tier: 'mail', x: 70, y: 88 },
  { name: 'OpenAI', tier: 'llm', x: 30, y: 88 },
  { name: 'Anthropic', tier: 'llm', x: 50, y: 88 },
  { name: 'S3', tier: 'storage', x: 90, y: 60 },
  { name: 'Webhooks', tier: 'core', x: 10, y: 38 },
  { name: 'Pinecone', tier: 'vector', x: 88, y: 18 },
  { name: 'OpenAPI', tier: 'spec', x: 12, y: 22 },
];

function IntegrationsConstellation() {
  // Connect every node to the central AgentMail/Argo hub at (50,50)
  const hub = { x: 50, y: 50 };
  return (
    <section className="border-t border-argo-border py-32 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">Integrations</span>
            <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-3 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
              Typed integrations, wired by the persona.
            </h2>
            <p className="text-argo-textSecondary argo-body mb-6">
              Argo doesn't ask you to "configure 50+ integrations." The dispatcher reads the brief,
              the persona picks the integrations the workflow actually needs, and the build engine
              wires them with HMAC verification, retry logic, and dead-letter queues — all from the
              reference-pattern library.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Pill label="Mail" tone="accent" />
              <Pill label="Storage" tone="accent" />
              <Pill label="Database" tone="accent" />
              <Pill label="Webhooks" tone="accent" />
              <Pill label="Chat ops" tone="accent" />
              <Pill label="LLM gateway" tone="accent" />
              <Pill label="Scheduler" tone="accent" />
              <Pill label="Vector store" tone="accent" />
            </div>
            <p className="mt-6 text-xs font-mono text-argo-textSecondary">
              Adding a new integration is a typed registry entry + 1 reference pattern, not a sales call.
            </p>
          </div>
          <div className="relative h-[420px] rounded-2xl border border-argo-border bg-argo-surface/30 overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,229,204,0.18),transparent_60%)]" aria-hidden />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              {INTEGRATIONS.map((n, i) => (
                <motion.line
                  key={i}
                  x1={n.x} y1={n.y} x2={hub.x} y2={hub.y}
                  stroke="rgba(0,229,204,0.25)"
                  strokeWidth="0.18"
                  strokeDasharray="1.5 1"
                  initial={{ pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 1.2, delay: 0.05 * i }}
                />
              ))}
              {/* central hub glow */}
              <circle cx={hub.x} cy={hub.y} r="3" fill="rgba(0,229,204,0.15)" />
              <circle cx={hub.x} cy={hub.y} r="1.5" fill="rgba(0,229,204,0.95)" />
            </svg>
            {INTEGRATIONS.map((n, i) => (
              <motion.div
                key={n.name}
                initial={{ opacity: 0, scale: 0.6 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.4, delay: 0.05 * i + 0.4 }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
              >
                <div className="relative inline-flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-argo-accent/20 blur-md" />
                  <div className="relative px-2.5 py-1 rounded-full border border-argo-accent/40 bg-argo-bg text-[10px] font-mono uppercase tracking-wider text-argo-text whitespace-nowrap">
                    {n.name}
                  </div>
                </div>
              </motion.div>
            ))}
            {/* central wordmark */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div className="argo-wordmark text-2xl">Argo</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pill({ label, tone }: { label: string; tone: 'accent' | 'mute' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono',
        tone === 'accent'
          ? 'border-argo-accent/40 bg-argo-accent/10 text-argo-accent'
          : 'border-argo-border bg-argo-surface/40 text-argo-textSecondary',
      )}
    >
      <span className="argo-status-dot bg-argo-accent" />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// FAQ
// ──────────────────────────────────────────────────────────────────────

function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="border-t border-argo-border py-32">
      <div className="mx-auto max-w-3xl px-6">
        <span className="text-xs uppercase tracking-widest text-argo-accent font-mono">FAQ</span>
        <h2 className="argo-hero text-4xl md:text-5xl mt-2 mb-10 text-argo-text" style={{ letterSpacing: '-0.05em' }}>
          The honest questions.
        </h2>
        <ul className="divide-y divide-argo-border border-y border-argo-border">
          {FAQ.map((item, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 py-5 text-left hover:text-argo-accent transition-colors"
              >
                <span className="text-argo-text text-base sm:text-lg" style={{ letterSpacing: '-0.02em' }}>{item.q}</span>
                <ChevronRight className={cn('h-4 w-4 text-argo-textSecondary transition-transform', open === i && 'rotate-90 text-argo-accent')} />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="pb-6 text-argo-textSecondary argo-body text-sm leading-relaxed max-w-2xl">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Final CTA
// ──────────────────────────────────────────────────────────────────────

function FinalCta({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="relative border-t border-argo-border py-40 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[900px] rounded-full bg-argo-accent/15 blur-[140px]" />
        <ConicSweep />
      </div>
      <div className="mx-auto max-w-4xl px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="argo-hero text-5xl md:text-7xl mb-6 text-argo-text"
          style={{ letterSpacing: '-0.05em', lineHeight: 0.98 }}
        >
          Stop shipping demos.
          <br />
          Ship something that
          <br />
          <span className="argo-wordmark">runs forever.</span>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-argo-textSecondary argo-body text-base mb-10 max-w-xl mx-auto"
        >
          Sign in with your email. Argo asks one question, builds the stack, deploys the URL.
          Ninety seconds.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <LiquidButton
            size="xl"
            onClick={onSignIn}
            className="bg-argo-accent text-argo-bg font-medium rounded-full px-8 py-4 inline-flex items-center gap-2 shadow-lg shadow-argo-accent/30"
          >
            Start scoping <Rocket className="h-5 w-5" />
          </LiquidButton>
          <a
            href="https://github.com/AlgoRythmTech/argo"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-argo-border px-6 py-3.5 text-sm text-argo-textSecondary hover:text-argo-text hover:border-argo-accent/40 transition-colors"
          >
            <Github className="h-4 w-4" /> Browse the source
          </a>
        </motion.div>
        <div className="mt-10 flex items-center justify-center gap-6 text-xs text-argo-textSecondary font-mono">
          <span className="inline-flex items-center gap-1.5"><Star className="h-3 w-3 text-argo-accent" /> Magic-link auth</span>
          <span className="inline-flex items-center gap-1.5"><ShieldAlert className="h-3 w-3 text-argo-accent" /> Apache-2.0</span>
          <span className="inline-flex items-center gap-1.5"><Terminal className="h-3 w-3 text-argo-accent" /> Node 20 · TS</span>
          <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3 w-3 text-argo-accent" /> Email-first ops</span>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-argo-border py-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="argo-wordmark text-2xl mb-2">Argo</div>
            <p className="text-xs text-argo-textSecondary argo-body">
              The AI Business Operator. One sentence in. Production stack out. Operates forever from email.
            </p>
          </div>
          <FooterCol title="Product" links={[
            ['How it works', '#how'], ['Quality gate', '#quality'],
            ['Vs Replit / Lovable', '#vs'], ['FAQ', '#faq'],
          ]} />
          <FooterCol title="Build" links={[
            ['GitHub', 'https://github.com/AlgoRythmTech/argo'],
            ['Specialists', '#specialists'],
          ]} />
          <FooterCol title="Stack" links={[
            ['Fastify', 'https://fastify.dev'],
            ['Zod', 'https://zod.dev'],
            ['Blaxel', 'https://blaxel.ai'],
            ['AgentMail', '#'],
            ['supermemory.ai', 'https://supermemory.ai'],
          ]} />
        </div>
        <div className="border-t border-argo-border pt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-argo-textSecondary">
          <p>© 2026 AlgoRythmTech · Built for solo operators</p>
          <p className="font-mono">Inter-500 · electric cyan · dark canvas</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-argo-textSecondary font-mono mb-3">{title}</div>
      <ul className="space-y-1.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="text-sm text-argo-textSecondary hover:text-argo-text transition-colors">{label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
