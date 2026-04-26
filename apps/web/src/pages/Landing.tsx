import { useArgo } from '../state/store.js';
import { BackgroundPaths } from '../components/ui/background-paths.js';
import { LiquidButton } from '../components/ui/liquid-glass-button.js';

/**
 * Landing — desktop-only marketing surface. The Section 9 doctrine says the
 * dashboard should be opened twice a month, not twice a day, so the landing
 * page exists primarily to qualify Maya in 8 seconds and route her to the
 * sign-in flow.
 */
export function Landing() {
  const setView = useArgo((s) => s.setView);

  return (
    <div className="argo-desktop-only h-full overflow-y-auto bg-argo-bg">
      <BackgroundPaths
        title="Argo"
        subtitle="Describe the workflow once. Argo runs it. Reply to email when it asks."
        ctaLabel="Sign in →"
        onCtaClick={() => setView('sign-in')}
      />

      <section className="mx-auto max-w-5xl px-6 py-24 grid grid-cols-1 md:grid-cols-3 gap-10">
        <div>
          <div className="text-argo-accent text-sm font-mono uppercase tracking-widest mb-3">
            01 · Describe
          </div>
          <h2 className="text-2xl font-semibold mb-3 text-argo-text">Tell Argo your workflow.</h2>
          <p className="text-argo-textSecondary leading-relaxed">
            Three plain-English questions. No checkboxes. No 12-node Zapier scenarios. You finish in
            under five minutes.
          </p>
        </div>
        <div>
          <div className="text-argo-accent text-sm font-mono uppercase tracking-widest mb-3">
            02 · Approve
          </div>
          <h2 className="text-2xl font-semibold mb-3 text-argo-text">Tap one button per email.</h2>
          <p className="text-argo-textSecondary leading-relaxed">
            Argo emails you when a decision is yours. Approve, edit, or decline. Replies land in
            your contact's inbox in your voice, from your address.
          </p>
        </div>
        <div>
          <div className="text-argo-accent text-sm font-mono uppercase tracking-widest mb-3">
            03 · Sleep
          </div>
          <h2 className="text-2xl font-semibold mb-3 text-argo-text">Argo runs it forever.</h2>
          <p className="text-argo-textSecondary leading-relaxed">
            When something breaks, Argo repairs it in a staging environment and sends a one-tap
            approval. You never see the error.
          </p>
        </div>
      </section>

      <section className="border-t border-argo-border bg-argo-surface/40">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h3 className="text-3xl md:text-4xl font-bold text-argo-text mb-4">
            Flat $199 / month per running operation.
          </h3>
          <p className="text-argo-textSecondary mb-10">
            First operation free for 30 days. Second operation $149. Third and beyond $99 each.
            <br />
            No credits. No tokens. No surprises.
          </p>
          <LiquidButton
            size="xxl"
            onClick={() => setView('sign-in')}
            className="bg-argo-accent text-argo-bg font-semibold hover:scale-105"
          >
            Get my Monday morning back
          </LiquidButton>
        </div>
      </section>

      <footer className="border-t border-argo-border">
        <div className="mx-auto max-w-5xl px-6 py-8 text-xs text-argo-textSecondary flex items-center justify-between">
          <span>© 2026 AlgoRythmTech. Argo is built on the shoulders of the open-source vibe-coding community.</span>
          <span className="font-mono">v0.1.0</span>
        </div>
      </footer>
    </div>
  );
}
