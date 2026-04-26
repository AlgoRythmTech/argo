import { z } from 'zod';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';

export const WeeklyDigest = z.object({
  paragraphOne: z.string().min(40).max(800),
  paragraphTwo: z.string().min(40).max(800),
  paragraphThree: z.string().min(40).max(800),
  /** If the third paragraph offers an action, name it here. The API generates the URL. */
  proposedActionLabel: z.string().min(1).max(60).nullable(),
  proposedActionDescription: z.string().min(1).max(400).nullable(),
});
export type WeeklyDigest = z.infer<typeof WeeklyDigest>;

/**
 * Section 8, Doctrine 3: "The weekly digest is prose, not a template. It is
 * generated fresh by the LLM each Monday. The prompt instructs the model to
 * write as a knowledgeable employee who has been with the company for a
 * year, not a reporting tool. Three paragraphs. No bullet lists, no metrics
 * tables, no charts."
 */
export async function composeWeeklyDigest(
  router: LlmRouter,
  store: InvocationStore,
  args: {
    operationId: string;
    ownerId: string;
    operationName: string;
    triggerKind: string;
    audience: string;
    outcome: string;
    weekSummary: {
      submissionsThisWeek: number;
      submissionsLastWeek: number;
      approvedThisWeek: number;
      declinedThisWeek: number;
      pendingApprovals: number;
      anomalies: string[];
      stalledItems: Array<{ description: string; daysWaiting: number }>;
    };
    voiceCorpus: Array<{ to: string; subject: string; body: string; sentAt: string }>;
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.operationName,
    triggerKind: args.triggerKind,
    audience: args.audience,
    outcome: args.outcome,
    recentEvents: [],
    triggerPayload: args.weekSummary,
    relevantTemplate: null,
    voiceCorpus: args.voiceCorpus.slice(-15),
    task:
      'Write a Monday digest as three paragraphs of prose. Paragraph one summarises the week. Paragraph two names anomalies (a client who hasn\'t responded, a sudden spike, a template approval rate dropping). Paragraph three proposes ONE specific action and offers to take it. Write as a knowledgeable employee who has been here a year — not a report.',
    schemaName: 'WeeklyDigest',
    constraints: [
      'no bullet points anywhere',
      'no metrics tables',
      'each paragraph is one paragraph (no internal newlines)',
      'paragraphs are conversational, not formal',
      'if you propose an action, set proposedActionLabel and proposedActionDescription; otherwise null both',
    ],
  });

  return runInvocation(router, store, {
    state: 'RUNNING',
    kind: 'running_compose_digest',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: WeeklyDigest,
  });
}
