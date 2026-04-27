// Email preview surface — "this is what your operator sees."
//
// The whole Argo doctrine is "operate from email." The workspace
// exists for setup + monthly check-in. Most of an operator's life
// with Argo is reading + replying to four kinds of emails. This
// modal renders polished mockups of all four so a board member,
// investor, or operator-prospect can SEE the operate-from-email
// experience in 30 seconds without spinning up a real workflow.
//
// Mounted from the workspace header next to the About / Spend pills.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ChevronRight,
  Inbox,
  Mail,
  PenLine,
  Rocket,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

type EmailKind = 'approval' | 'digest' | 'repair' | 'deploy';

interface EmailMockup {
  kind: EmailKind;
  icon: typeof Mail;
  tone: string;
  subject: string;
  fromLine: string;
  toLine: string;
  preview: string;
  /** Body rendered as JSX so we can style buttons + structure. */
  body: React.ReactNode;
}

interface EmailPreviewModalProps {
  /** Used to render a tiny "Argo for {operationName}" header line. */
  operationName?: string;
  /** Trigger button copy override. Default: "What this looks like in your inbox". */
  triggerLabel?: string;
}

export function EmailPreviewModal({
  operationName,
  triggerLabel,
}: EmailPreviewModalProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<EmailKind>('approval');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const opLabel = operationName ?? 'your operation';
  const emails: EmailMockup[] = [
    {
      kind: 'approval',
      icon: Mail,
      tone: 'argo-accent',
      subject: 'Approve forwarding this candidate?',
      fromLine: `Argo · ${opLabel}`,
      toLine: 'you@youroperation.co',
      preview: 'Senior Frontend candidate scored 0.87 against the role brief — strong fit.',
      body: (
        <>
          <p className="text-base text-argo-text mb-3" style={{ letterSpacing: '-0.02em' }}>
            Approve forwarding this candidate to the hiring client?
          </p>
          <div className="text-sm text-argo-textSecondary argo-body mb-4 leading-relaxed">
            <strong className="text-argo-text">Senior Frontend</strong> · 5 years · scored
            <strong className="text-argo-text"> 0.87 </strong>against the role brief.
            <br />
            Cover letter mentions React Server Components — strong fit for the role.
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <FauxBtn primary>
              <CheckCircle2 className="h-4 w-4" /> Approve
            </FauxBtn>
            <FauxBtn>
              <PenLine className="h-4 w-4" /> Edit first
            </FauxBtn>
            <FauxBtn dim>Decline</FauxBtn>
          </div>
          <FineprintRow>
            Argo holds for 4 minutes before sending. Reply STOP to pause this template. Reply
            MORE for the full reasoning trace.
          </FineprintRow>
        </>
      ),
    },
    {
      kind: 'digest',
      icon: Inbox,
      tone: 'fuchsia-400',
      subject: `Monday digest · ${opLabel}`,
      fromLine: `Argo · ${opLabel}`,
      toLine: 'you@youroperation.co',
      preview:
        'Twelve applications this week, eight rejected, four forwarded. One stale approval, one repair proposed.',
      body: (
        <>
          <p className="text-base text-argo-text mb-3" style={{ letterSpacing: '-0.02em' }}>
            Good morning. Here's the week.
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-3 leading-relaxed">
            Twelve applications came through {opLabel} this week. You approved four forwards and
            declined one (the rest were auto-rejected with personalised notes — same voice you've
            used for the last two months).
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-3 leading-relaxed">
            One forwarded candidate has been sitting in the hiring client's inbox for five days
            without a response. Want me to nudge? Reply NUDGE and I'll send a polite follow-up.
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-4 leading-relaxed">
            The auto-reject template has shipped <strong className="text-argo-text">21 sends</strong>
            so far with a 96% non-bounce rate. Trust ratchet is now closed; future rejects send
            without the 4-minute hold.
          </p>
          <FineprintRow>
            Generated Monday 09:00 in your timezone. Reply STOP to pause the digest.
          </FineprintRow>
        </>
      ),
    },
    {
      kind: 'repair',
      icon: Wrench,
      tone: 'argo-amber',
      subject: 'I think I can fix the SPF bounces — approve?',
      fromLine: `Argo · ${opLabel}`,
      toLine: 'you@youroperation.co',
      preview: '3 reject emails bounced this morning with SPF softfail. I have a 2-line patch ready.',
      body: (
        <>
          <p className="text-base text-argo-text mb-3" style={{ letterSpacing: '-0.02em' }}>
            I think I can fix the SPF bounces — approve the patch?
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-3 leading-relaxed">
            <strong className="text-argo-text">What broke:</strong> 3 reject emails bounced this
            morning. The recipient's mail server returned SPF softfail because the From envelope
            used your domain but DKIM was signed by Argo's sender.
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-3 leading-relaxed">
            <strong className="text-argo-text">My fix:</strong> Switch the From envelope to the
            verified Argo sender so SPF aligns. Recipients still see your Reply-To, so this is
            invisible to them.
          </p>
          <p className="text-xs text-argo-textSecondary font-mono mb-4 bg-argo-bg/40 border border-argo-border/40 rounded px-2.5 py-1.5">
            email/templates/reject.js · 1 line changed<br />
            <span className="text-argo-red">- envelope.from = operator.email;</span>
            <br />
            <span className="text-argo-green">+ envelope.from = process.env.MAILER_FROM_VERIFIED;</span>
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-4 leading-relaxed">
            <strong className="text-argo-text">What I tested:</strong> Re-ran the synthetic
            happy-path against bigcorp.com sandbox — mail accepted with PASS on SPF + DKIM. I'll
            staging-swap the change in 90 seconds after you approve.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            <FauxBtn primary>
              <CheckCircle2 className="h-4 w-4" /> Approve repair
            </FauxBtn>
            <FauxBtn dim>Reject and roll back</FauxBtn>
          </div>
          <FineprintRow>
            Repairs are never auto-applied. The 3 bounced emails will retry after the patch
            ships.
          </FineprintRow>
        </>
      ),
    },
    {
      kind: 'deploy',
      icon: Rocket,
      tone: 'argo-green',
      subject: `${opLabel} v3 is live`,
      fromLine: `Argo · ${opLabel}`,
      toLine: 'you@youroperation.co',
      preview: 'Shipped v3 in 2 cycles with GPT-5.5 · 33/33 quality checks · live URL inside.',
      body: (
        <>
          <p className="text-base text-argo-text mb-3" style={{ letterSpacing: '-0.02em' }}>
            {opLabel} <span className="text-argo-green">v3</span> is live.
          </p>
          <p className="text-sm text-argo-textSecondary argo-body mb-3 leading-relaxed">
            Build took 2 auto-fix cycles · 33/33 quality checks passed · runtime tests green ·
            reviewer signed off. Deployed to its own Blaxel sandbox.
          </p>
          <div className="rounded-md border border-argo-border bg-argo-bg/40 px-3 py-2 mb-4 text-xs font-mono">
            <span className="text-argo-textSecondary">URL:</span>
            <span className="text-argo-accent ml-2">
              https://{(operationName ?? 'demo').toLowerCase().replace(/\s+/g, '-')}.argo-ops.run
            </span>
          </div>
          <p className="text-sm text-argo-textSecondary argo-body mb-4 leading-relaxed">
            Drop the URL into your site. From here on, Argo handles every submission — you'll only
            hear from me when a strong candidate needs your approval, when something breaks, or
            on Monday morning.
          </p>
          <FineprintRow>
            Cost so far: $0.32 in LLM spend across the build. You're well under the $30/month
            budget for this operation.
          </FineprintRow>
        </>
      ),
    },
  ];

  const activeEmail = emails.find((e) => e.kind === active) ?? emails[0]!;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Preview the four emails Argo sends"
        className="inline-flex items-center gap-1.5 rounded-full border border-argo-border bg-argo-surface/40 px-2.5 py-0.5 text-xs text-argo-textSecondary hover:text-argo-text hover:border-argo-accent/40 transition-colors font-mono"
      >
        <Mail className="h-3 w-3" />
        <span>{triggerLabel ?? 'Email preview'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              key="modal"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl max-h-[88vh] flex rounded-2xl border border-argo-border bg-argo-surface shadow-2xl shadow-black/40 overflow-hidden"
            >
              <aside className="w-72 flex-shrink-0 border-r border-argo-border bg-argo-bg/40 flex flex-col">
                <header className="px-4 py-3 border-b border-argo-border flex items-center gap-2 text-argo-text">
                  <Sparkles className="h-3.5 w-3.5 text-argo-accent" />
                  <span className="text-sm">Operator inbox</span>
                </header>
                <div className="flex-1 overflow-y-auto">
                  {emails.map((e) => {
                    const Icon = e.icon;
                    const isActive = e.kind === active;
                    return (
                      <button
                        key={e.kind}
                        type="button"
                        onClick={() => setActive(e.kind)}
                        className={cn(
                          'w-full text-left px-4 py-3 border-b border-argo-border/50 flex items-start gap-3 transition-colors',
                          isActive ? 'bg-argo-accent/10' : 'hover:bg-argo-surface/60',
                        )}
                      >
                        <Icon className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', `text-${e.tone}`)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono text-argo-textSecondary truncate">
                            {e.fromLine}
                          </div>
                          <div className="text-sm text-argo-text truncate" style={{ letterSpacing: '-0.01em' }}>
                            {e.subject}
                          </div>
                          <div className="text-xs text-argo-textSecondary truncate mt-0.5 argo-body">
                            {e.preview}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <footer className="px-4 py-3 border-t border-argo-border text-[11px] text-argo-textSecondary font-mono">
                  Mock previews · real delivery via AgentMail
                </footer>
              </aside>

              <div className="flex-1 flex flex-col min-w-0">
                <header className="border-b border-argo-border px-5 h-12 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-argo-textSecondary font-mono">
                    <ChevronRight className="h-3 w-3" />
                    {activeEmail.kind}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="text-argo-textSecondary hover:text-argo-text"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>
                <div className="flex-1 overflow-y-auto">
                  <div className="px-6 py-5 border-b border-argo-border/60">
                    <div className="flex items-center justify-between text-xs text-argo-textSecondary mb-1">
                      <span className="font-mono">{activeEmail.fromLine}</span>
                      <span className="font-mono">9:42 AM</span>
                    </div>
                    <h2
                      className="text-2xl text-argo-text"
                      style={{ letterSpacing: '-0.03em' }}
                    >
                      {activeEmail.subject}
                    </h2>
                    <div className="text-xs text-argo-textSecondary mt-1 font-mono">
                      to {activeEmail.toLine}
                    </div>
                  </div>
                  <div className="px-6 py-6">{activeEmail.body}</div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function FauxBtn({
  children,
  primary,
  dim,
}: {
  children: React.ReactNode;
  primary?: boolean;
  dim?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium select-none',
        primary
          ? 'bg-argo-accent text-argo-bg'
          : dim
          ? 'border border-argo-border text-argo-textSecondary'
          : 'border border-argo-border text-argo-text',
      )}
    >
      {children}
    </span>
  );
}

function FineprintRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-argo-textSecondary font-mono border-t border-argo-border/60 pt-3 leading-relaxed">
      {children}
    </div>
  );
}
