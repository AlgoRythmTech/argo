import { WorkflowIntent } from '@argo/shared-types';
import { buildContextEnvelope } from '../envelope.js';
import type { LlmRouter } from '../llm/router.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { DialogueAnswers } from './question-tree.js';

/**
 * LISTENING extractor. Combines the deterministic answers with the trigger
 * detection result and asks the LLM to *only* normalise to a WorkflowIntent.
 * No question generation, no creative latitude.
 */
export async function extractWorkflowIntent(
  router: LlmRouter,
  store: InvocationStore,
  args: {
    operationId: string;
    ownerId: string;
    dialogue: DialogueAnswers;
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: '(unnamed)',
    triggerKind: args.dialogue.trigger,
    audience: args.dialogue.answers.who_audience ?? '',
    outcome: args.dialogue.answers.what_outcome ?? '',
    recentEvents: [],
    triggerPayload: args.dialogue.answers,
    relevantTemplate: null,
    voiceCorpus: parseVoiceExamples(args.dialogue.answers.voice_examples ?? ''),
    task:
      'Extract a normalised WorkflowIntent from the user\'s answers. Use the trigger field as given. Pick the archetype that best matches what they described — candidate_intake, lead_qualification, onboarding_sequence, or generic. Do not invent fields the user did not provide.',
    schemaName: 'WorkflowIntent',
    constraints: [
      'rawDescription must be the user\'s combined answers, joined with newlines',
      'recipients must be valid email addresses or empty',
      'Do not include voiceCorpusEmails — that field is populated server-side',
    ],
  });

  return runInvocation(router, store, {
    state: 'LISTENING',
    kind: 'listening_extract_intent',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: WorkflowIntent,
  });
}

function parseVoiceExamples(raw: string): Array<{ to: string; subject: string; body: string; sentAt: string }> {
  if (!raw.trim()) return [];
  const blocks = raw.split(/\n\s*\n/).slice(0, 5);
  return blocks.map((b, ix) => ({
    to: 'redacted@example.com',
    subject: `voice-sample-${ix + 1}`,
    body: b.trim(),
    sentAt: new Date().toISOString(),
  }));
}
