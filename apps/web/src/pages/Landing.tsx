// The Argo landing page — Inter-500, brand wordmark, three specialist
// demos. This is what investors see before clicking "Sign in". Every word
// is locked to the YC-vibe spec the founder gave us:
//
//   - font-family Inter / weight 500 only
//   - hero line-height 1.05, body 1.55
//   - argo-wordmark gradient on the literal word "Argo"
//   - dark canvas, electric-cyan accent
//   - no looping animations, no marketing fluff

import { motion } from 'framer-motion';
import { ArrowRight, ChevronRight, Play, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { useArgo } from '../state/store.js';
import { LiquidButton } from '../components/ui/liquid-glass-button.js';

const SPECIALIST_DEMOS = [
  {
    title: 'Form-driven workflows',
    persona: 'form_workflow',
    sentence:
      'Candidates apply to my recruiting site through a form. Reject most politely, forward strong matches to the hiring client.',
    output: '8 files · approval-gated email · Mongo persistence · Monday digest',
    color: 'from-argo-accent/30 to-argo-accent/0',
  },
  {
    title: 'Multi-tenant SaaS',
    persona: 'multi_tenant_saas',
    sentence:
      'A SaaS for design teams: workspaces, OAuth-Google login, role-based permissions, realtime cursors over WebSockets, an admin panel.',
    output: '24 files · OAuth + RBAC + WS multiplex · migration runner · audit log',
    color: 'from-fuchsia-500/30 to-fuchsia-500/0',
  },
  {
    title: 'Webhook bridge',
    persona: 'webhook_bridge',
    sentence:
      'Receive Stripe webhooks, deduplicate retries, normalise to my internal event shape, fan out to a Slack channel and Postgres.',
    output: '11 files · HMAC-verified ingress · BullMQ + DLQ · Slack Block Kit',
    color: 'from-amber-500/30 to-amber-500/0',
  },
] as const;

const PROOF_POINTS = [
  {
    icon: Sparkles,
    title: 'Specialists, not chatboxes',
    body: 'Argo dispatches to one of nine personas with battle-tested patterns. REST APIs ship with OpenAPI. Webhooks ship with HMAC + DLQ. SaaS ships with RBAC + migrations.',
  },
  {
    icon: ShieldCheck,
    title: '15-check quality gate',
    body: 'No console.log. No eval. No inlined secrets. No localhost. SIGTERM handlers. Health routes. Zod-on-every-POST. Auto-fix loop re-prompts GPT-5.5 until everything passes.',
  },
  {
    icon: Zap,
    title: 'Runs forever on Blaxel',
    body: 'Every operation gets its own sandbox. The runtime self-heals on failure: detect → diagnose → propose patch → email approval → staging-swap. You never see a stack trace.',
  },
] as const;

export function Landing() {
  const setView = useArgo((s) => s.setView);

  return (
    <div className="min-h-screen bg-argo-bg text-argo-text antialiased">
      <Nav onSignIn={() => setView('sign-in')} />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <BackgroundGradient />
        <div className="relative mx-auto max-w-6xl px-6 pt-32 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-argo-border bg-argo-surface/60 px-3 py-1 text-xs text-argo-textSecondary"
          >
            <span className="argo-status-dot bg-argo-accent" />
            Live preview hosted on Blaxel · Email through AgentMail
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.06 }}
            className="argo-hero text-[64px] sm:text-[88px] md:text-[112px] text-argo-text mb-6 max-w-5xl"
            style={{ letterSpacing: '-0.05em', lineHeight: 1.05 }}
          >
            Describe your workflow.
            <br />
            <span className="argo-wordmark">Argo</span> ships the production stack.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.16 }}
            className="argo-body text-lg sm:text-xl text-argo-textSecondary max-w-2xl mb-10"
          >
            One sentence in. Argo asks 4–6 click-through questions to nail the scope, generates a
            complete typed backend with GPT-5.5, runs a 15-check quality gate, and deploys to a real
            sandbox you can hit in 90 seconds.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.24 }}
            className="flex items-center gap-3"
          >
            <LiquidButton
              size="lg"
              onClick={() => setView('sign-in')}
              className="bg-argo-accent text-argo-bg font-medium rounded-full px-6 py-3 inline-flex items-center gap-2"
            >
              Start scoping <ArrowRight className="h-4 w-4" />
            </LiquidButton>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-argo-border px-5 py-3 text-sm text-argo-textSecondary hover:text-argo-text hover:border-argo-accent/40 transition-colors"
            >
              <Play className="h-4 w-4" /> Watch the 60-second demo
            </a>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl text-xs uppercase tracking-widest text-argo-textSecondary font-mono"
          >
            <Stat label="Models" value="GPT-5.5 + Opus 4.7" />
            <Stat label="Quality gate" value="15 checks" />
            <Stat label="Auto-fix cycles" value="up to 3" />
            <Stat label="Time to live URL" value="~90 s" />
          </motion.div>
        </div>
      </section>

      {/* SPECIALIST DEMOS */}
      <section id="how" className="border-t border-argo-border py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2
            className="argo-hero text-3xl md:text-4xl mb-2 text-argo-text"
            style={{ letterSpacing: '-0.05em', lineHeight: 1.1 }}
          >
            Three apps Argo ships in minutes.
          </h2>
          <p className="text-argo-textSecondary argo-body mb-12 max-w-2xl">
            Each example is a real prompt + the output you'd see in the workspace's Code tab. Try
            any of these once you sign in — the specialist dispatcher routes deterministically.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SPECIALIST_DEMOS.map((d, i) => (
              <motion.article
                key={d.persona}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="group relative overflow-hidden rounded-xl border border-argo-border bg-argo-surface/50 p-6 hover:border-argo-accent/40 transition-colors"
              >
                <div
                  className={`pointer-events-none absolute inset-0 -z-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${d.color}`}
                />
                <div className="relative">
                  <div className="text-xs uppercase tracking-widest text-argo-accent font-mono mb-3">
                    {d.persona.replace(/_/g, ' ')}
                  </div>
                  <h3 className="text-xl text-argo-text mb-3" style={{ letterSpacing: '-0.04em' }}>
                    {d.title}
                  </h3>
                  <blockquote className="text-sm text-argo-textSecondary argo-body italic border-l-2 border-argo-border pl-3 mb-4">
                    "{d.sentence}"
                  </blockquote>
                  <div className="text-xs font-mono text-argo-text bg-argo-bg/60 border border-argo-border rounded px-3 py-2">
                    → {d.output}
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* PROOF POINTS */}
      <section className="border-t border-argo-border py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2
            className="argo-hero text-3xl md:text-4xl mb-2 text-argo-text"
            style={{ letterSpacing: '-0.05em', lineHeight: 1.1 }}
          >
            What makes the output ship-quality.
          </h2>
          <p className="text-argo-textSecondary argo-body mb-12 max-w-2xl">
            Replit and Lovable hand you code that looks fine and breaks on Tuesday. Argo's
            generation goes through a quality pipeline that doesn't ship until everything passes.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {PROOF_POINTS.map((p, i) => (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-argo-accent/10 text-argo-accent mb-4">
                  <p.icon className="h-4 w-4" />
                </div>
                <h3 className="text-lg text-argo-text mb-2" style={{ letterSpacing: '-0.04em' }}>
                  {p.title}
                </h3>
                <p className="text-sm text-argo-textSecondary argo-body">{p.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING — one paragraph, no comparison table (per master prompt §14) */}
      <section className="border-t border-argo-border py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2
            className="argo-hero text-3xl md:text-4xl mb-4 text-argo-text"
            style={{ letterSpacing: '-0.05em', lineHeight: 1.1 }}
          >
            $199/month per running operation.
          </h2>
          <p className="text-argo-textSecondary argo-body">
            First operation free for 30 days. No credits. No tokens. No metered API calls visible to
            you. Second operation is $149; third and beyond are $99 each.
          </p>
          <p className="text-argo-textSecondary argo-body text-sm mt-6">
            We refuse to ship credit-based pricing. If your operation costs us more than $30/month
            in LLM + Blaxel compute, that's our margin problem, not yours.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-argo-border py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2
            className="argo-hero text-4xl md:text-6xl mb-6 text-argo-text"
            style={{ letterSpacing: '-0.05em', lineHeight: 1.05 }}
          >
            Stop shipping demos.
            <br />
            Ship something that runs forever.
          </h2>
          <LiquidButton
            size="xl"
            onClick={() => setView('sign-in')}
            className="bg-argo-accent text-argo-bg font-medium rounded-full px-8 py-4 inline-flex items-center gap-2"
          >
            Start scoping <ArrowRight className="h-5 w-5" />
          </LiquidButton>
        </div>
      </section>

      <footer className="border-t border-argo-border py-8 text-center text-xs text-argo-textSecondary">
        <p>
          Argo's BUILDING-phase code engine stands on the shoulders of open-source — Dyad,
          Open&nbsp;Lovable, Cline. Apache-2.0.
        </p>
        <p className="mt-2">© 2026 AlgoRythmTech · Built for solo operators · YC W27 candidate</p>
      </footer>
    </div>
  );
}

function Nav({ onSignIn }: { onSignIn: () => void }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-argo-bg/70 border-b border-argo-border">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <div className="argo-wordmark text-xl">Argo</div>
        <div className="flex items-center gap-6 text-sm">
          <a
            href="#how"
            className="text-argo-textSecondary hover:text-argo-text transition-colors hidden sm:inline"
          >
            How it works
          </a>
          <a
            href="https://github.com/AlgoRythmTech/argo"
            target="_blank"
            rel="noreferrer"
            className="text-argo-textSecondary hover:text-argo-text transition-colors hidden sm:inline"
          >
            GitHub
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-argo-textSecondary text-[10px] tracking-widest uppercase">{label}</div>
      <div className="text-argo-text text-sm mt-1 normal-case font-mono tracking-tight">{value}</div>
    </div>
  );
}

function BackgroundGradient() {
  return (
    <div aria-hidden className="absolute inset-0 -z-0 overflow-hidden">
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[480px] w-[1200px] bg-gradient-radial from-argo-accent/10 via-argo-accent/5 to-transparent blur-3xl" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,#0A0A0B_85%)]" />
    </div>
  );
}
