import { z } from 'zod';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';

/**
 * Parses Maya's free-text reply into structured intent.
 * "approve all the engineering ones" -> { kind: 'approve_subset', filter: ... }
 *
 * Section 8: "The system prompt for inbound parsing must be tested against
 * at least 200 real (anonymized) replies before going to production."
 *
 * Pre-production this should be benchmarked via the harness in
 * /apps/api/scripts/inbound-parser-eval.ts (TODO when corpus exists).
 */

export const InboundReplyIntent = z.object({
  kind: z.enum([
    'approve_all',
    'decline_all',
    'approve_subset',
    'decline_subset',
    'forward_request',
    'free_text_question',
    'pause_operation',
    'resume_operation',
    'unknown',
  ]),
  /** Identifiers (names, IDs, or descriptors) the user singled out. */
  selectors: z.array(z.string()).default([]),
  /** Free-text residual to be passed to the next agent step. */
  residualText: z.string(),
  /** Confidence 0–1. Anything below 0.6 should be human-confirmed. */
  confidence: z.number().min(0).max(1),
});
export type InboundReplyIntent = z.infer<typeof InboundReplyIntent>;

export async function parseInboundReply(
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
    inboundEmailText: string;
    relatedApprovalsSummary: string;
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.operationName,
    triggerKind: args.triggerKind,
    audience: args.audience,
    outcome: args.outcome,
    recentEvents: args.recentEvents,
    triggerPayload: {
      replyText: args.inboundEmailText,
      relatedApprovals: args.relatedApprovalsSummary,
    },
    relevantTemplate: null,
    voiceCorpus: [],
    task:
      'Read the user\'s reply and classify their intent. Names mentioned in the reply go in selectors. If the user said "stop", "pause", or "cancel", the kind is pause_operation. If the reply is a question that doesn\'t direct an action, kind is free_text_question.',
    schemaName: 'InboundReplyIntent',
    constraints: [
      'confidence must be honest — below 0.6 if the reply is ambiguous',
      'selectors must be lifted verbatim from the reply (case preserved)',
    ],
  });

  return runInvocation(router, store, {
    state: 'RUNNING',
    kind: 'running_parse_inbound_reply',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: InboundReplyIntent,
  });
}
