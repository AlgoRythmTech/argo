import { z } from 'zod';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';

export const EmailDraft = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1),
  /** A 1-line gloss the dashboard shows in the activity feed. */
  oneLineSummary: z.string().min(1).max(200),
});
export type EmailDraft = z.infer<typeof EmailDraft>;

/**
 * Drafts an outbound email in the user's voice. Voice corpus is the load-
 * bearing field — the model is instructed to mirror tone, length, salutation,
 * and signature.
 */
export async function draftOutboundEmail(
  router: LlmRouter,
  store: InvocationStore,
  args: {
    operationId: string;
    ownerId: string;
    operationName: string;
    triggerKind: string;
    audience: string;
    outcome: string;
    recipientName: string;
    intent: 'reject' | 'forward' | 'screen' | 'follow_up';
    submissionPayload: Record<string, unknown>;
    voiceCorpus: Array<{ to: string; subject: string; body: string; sentAt: string }>;
    relatedTemplateBody?: string;
    relatedTemplateApprovalRate?: number;
    relatedTemplateSends?: number;
    relatedTemplateId?: string;
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.operationName,
    triggerKind: args.triggerKind,
    audience: args.audience,
    outcome: args.outcome,
    recentEvents: [],
    triggerPayload: { intent: args.intent, recipientName: args.recipientName, ...args.submissionPayload },
    relevantTemplate:
      args.relatedTemplateBody &&
      args.relatedTemplateId !== undefined &&
      args.relatedTemplateApprovalRate !== undefined &&
      args.relatedTemplateSends !== undefined
        ? {
            templateId: args.relatedTemplateId,
            kind: args.intent,
            body: args.relatedTemplateBody,
            approvalRate: args.relatedTemplateApprovalRate,
            sendsToDate: args.relatedTemplateSends,
          }
        : null,
    voiceCorpus: args.voiceCorpus.slice(-15),
    task:
      'Draft an outbound email matching the user\'s voice. Use the relevant template if one is attached as a starting point; otherwise mirror the voice corpus. Keep it under 180 words. No marketing language. No emojis unless the corpus uses them. Sign off the way the corpus signs off.',
    schemaName: 'EmailDraft',
    constraints: [
      `intent: ${args.intent}`,
      `recipient first name: ${args.recipientName}`,
      'subject must be plain text, no all-caps, no exclamation marks unless the corpus uses them',
      'body must end with the user\'s usual sign-off (mirror the corpus)',
    ],
  });

  return runInvocation(router, store, {
    state: 'RUNNING',
    kind: 'running_draft_outbound_email',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: EmailDraft,
  });
}
