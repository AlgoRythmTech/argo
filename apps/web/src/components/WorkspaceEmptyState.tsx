// Workspace empty state — the front door for a brand-new operator.
//
// When ops.length === 0 the workspace was rendering PreviewPane's
// "preview lands here" copy, which is more confusing than inviting.
// This component replaces that with: a hero, six example-workflow
// cards, and a hint that any of them auto-fills the prompt below.
//
// The example workflows span the specialist taxonomy (recruiting /
// sales / support / finance / product / marketing) so most operators
// see something close to their actual use case.

import { motion } from 'framer-motion';
import {
  Briefcase,
  CalendarClock,
  Inbox,
  Mail,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';

interface ExampleWorkflow {
  icon: typeof Sparkles;
  title: string;
  description: string;
  /** Sentence the operator would have typed; auto-fills the prompt. */
  sentence: string;
  /** Tag grouping for layout / future filters. */
  tag: 'recruiting' | 'sales' | 'support' | 'finance' | 'product' | 'marketing';
}

const EXAMPLES: ExampleWorkflow[] = [
  {
    icon: Briefcase,
    title: 'Candidate intake & rejection',
    description:
      'Applicants apply via a form. Argo scores fit, drafts a personalised reject for weak ones, forwards strong ones to the hiring client.',
    sentence:
      'Candidates apply to my recruiting site through a form. I want Argo to read each one, reject most with a personalised note in my voice, and forward the strong ones to my hiring client with a one-click approval.',
    tag: 'recruiting',
  },
  {
    icon: CalendarClock,
    title: 'Demo bookings → Slack + calendar',
    description:
      'Form submissions become calendar invites and a Slack ping to the AE. Reschedules and cancellations propagate.',
    sentence:
      'When a prospect books a demo on my pricing page, I want Argo to create a Google Calendar invite for me + the AE, send a Slack ping with the prospect details, and follow up by email if they reschedule.',
    tag: 'sales',
  },
  {
    icon: Inbox,
    title: 'Support inbox triage',
    description:
      'Inbound support emails are classified (refund / bug / billing / account). Argo drafts replies; you approve from the digest.',
    sentence:
      'I get 30-50 support emails a day. I want Argo to read each one, classify it (refund / bug / billing / account), draft a reply in my voice, and email me a daily digest of what to approve before sending.',
    tag: 'support',
  },
  {
    icon: Wallet,
    title: 'Refund request approvals',
    description:
      'Customer fills a refund form. Argo checks the order, drafts the response, queues approval if > $200.',
    sentence:
      'Customers request refunds via a form on my checkout. I want Argo to look up the order, decide if the refund is justified per my policy, auto-approve under $200, and queue anything bigger for my email approval.',
    tag: 'finance',
  },
  {
    icon: ShieldCheck,
    title: 'Product feedback weekly digest',
    description:
      'In-app feedback collects in Mongo. Argo writes a Monday-morning prose digest of themes, surprises, urgent bugs.',
    sentence:
      'My users submit feedback via a form inside my app. I want Argo to collect it all week and email me a Monday-morning prose digest organised by theme, with a section flagging anything that sounds like a regression.',
    tag: 'product',
  },
  {
    icon: Mail,
    title: 'Newsletter subscription pipeline',
    description:
      'Form-driven double-opt-in into a list. Welcome email, weekly drip, unsubscribe link, all without a vendor.',
    sentence:
      'Visitors subscribe to my newsletter via a form. I want Argo to handle the double-opt-in, send a welcome email, drip 3 onboarding emails over the first week, and let me email new posts to the whole list.',
    tag: 'marketing',
  },
];

interface WorkspaceEmptyStateProps {
  /** Optional first-name to personalise the greeting. */
  firstName?: string;
  /**
   * Click handler for an example card. The host should set the
   * sentence as the value of the prompt input below; the operator
   * can edit before sending.
   */
  onPickExample: (sentence: string) => void;
}

export function WorkspaceEmptyState({ firstName, onPickExample }: WorkspaceEmptyStateProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-12">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mb-10"
        >
          <div className="flex items-center gap-2 mb-3 text-argo-accent">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs uppercase tracking-widest">
              {firstName ? `Welcome, ${firstName}` : 'Welcome to Argo'}
            </span>
          </div>
          <h1
            className="argo-hero text-4xl text-argo-text mb-3"
            style={{ letterSpacing: '-0.05em', lineHeight: 1.05 }}
          >
            What would you like Argo to operate?
          </h1>
          <p className="text-argo-textSecondary argo-body text-base max-w-2xl">
            Describe the workflow in one sentence — Argo will follow up with 4–6 click-through
            questions to nail the scope, then build the entire production stack. Or pick one
            of these to get started.
          </p>
        </motion.header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EXAMPLES.map((ex, i) => {
            const Icon = ex.icon;
            return (
              <motion.button
                key={ex.title}
                type="button"
                onClick={() => onPickExample(ex.sentence)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.04 * i, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -1 }}
                className="group text-left rounded-xl border border-argo-border bg-argo-surface/40 hover:bg-argo-surface hover:border-argo-accent/40 transition-colors px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-argo-accent/15 text-argo-accent flex-shrink-0">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-argo-text font-medium leading-snug mb-1">{ex.title}</div>
                    <div className="text-argo-textSecondary text-xs argo-body leading-relaxed">
                      {ex.description}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary/60 font-mono mt-0.5">
                    {ex.tag}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.4 }}
          className="mt-10 text-center text-xs text-argo-textSecondary argo-body"
        >
          Click an example to load it into the prompt box below — you can edit before sending.
        </motion.div>
      </div>
    </div>
  );
}
