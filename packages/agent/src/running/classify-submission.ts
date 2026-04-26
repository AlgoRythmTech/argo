import { z } from 'zod';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';

export const SubmissionClassification = z.object({
  label: z.enum(['strong_match', 'weak_match', 'unqualified', 'spam', 'needs_clarification']),
  confidence: z.number().min(0).max(1),
  criteriaMatched: z.array(z.string()).default([]),
  criteriaMissed: z.array(z.string()).default([]),
  rationale: z.string().min(1).max(800),
});
export type SubmissionClassification = z.infer<typeof SubmissionClassification>;

/**
 * Classifies a submission against the operation's success criteria. Used by
 * the deterministic runtime to decide which template to surface in the
 * approval email.
 */
export async function classifySubmission(
  router: LlmRouter,
  store: InvocationStore,
  args: {
    operationId: string;
    ownerId: string;
    operationName: string;
    triggerKind: string;
    audience: string;
    outcome: string;
    recentEvents: Array<{ timestamp: string; kind: string; summary: string }>;
    submissionPayload: Record<string, unknown>;
    successCriteria: string[];
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.operationName,
    triggerKind: args.triggerKind,
    audience: args.audience,
    outcome: args.outcome,
    recentEvents: args.recentEvents,
    triggerPayload: args.submissionPayload,
    relevantTemplate: null,
    voiceCorpus: [],
    task: `Classify this submission against the success criteria for "${args.audience}". Use exactly the criteria listed below — do not invent new ones. Match means the submission demonstrates the criterion. Miss means it doesn't.`,
    schemaName: 'SubmissionClassification',
    constraints: [
      `criteria are: ${args.successCriteria.map((c) => JSON.stringify(c)).join(', ')}`,
      'criteriaMatched + criteriaMissed must equal the criteria set (no extras, no omissions)',
      'confidence must reflect actual ambiguity in the data',
    ],
  });

  return runInvocation(router, store, {
    state: 'RUNNING',
    kind: 'running_classify_submission',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: SubmissionClassification,
  });
}
