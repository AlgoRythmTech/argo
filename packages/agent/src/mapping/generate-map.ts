import { WorkflowMap, type WorkflowIntent } from '@argo/shared-types';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';
import { fallbackMapForArchetype } from './fallback-templates.js';

/**
 * MAPPING — the only state where the agent has creative latitude.
 *
 * Section 10: "MAPPING — the agent generates a WorkflowMap from the
 * WorkflowIntent. [...] If parsing fails, retry once with a correction
 * prompt that includes the parse error. If parsing fails twice, fall back
 * to a templated map for the closest matching archetype from the gallery."
 */

export type GenerateMapArgs = {
  operationId: string;
  ownerId: string;
  ownerEmail: string;
  intent: WorkflowIntent;
  /** A friendly name proposed by the user OR derived from the description. */
  operationName: string;
  /** IANA timezone for digest scheduling. */
  timezone: string;
};

export async function generateWorkflowMap(
  router: LlmRouter,
  store: InvocationStore,
  args: GenerateMapArgs,
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.operationName,
    triggerKind: args.intent.trigger,
    audience: args.intent.audienceDescription,
    outcome: args.intent.outcomeDescription,
    recentEvents: [],
    triggerPayload: args.intent,
    relevantTemplate: null,
    voiceCorpus: [],
    task: `Produce a WorkflowMap that captures the user's described operation. The map must:
- Have a clear chronological flow from trigger → enrichment → classification → approval gate → outbound action → persistence → optional follow-up
- Use ${args.intent.trigger} as the trigger
- Include an approval_gate step before any outbound third-party email
- Include a digest step set for Monday 09:00 in ${args.timezone}
- Use stable lowercase-hyphen step ids
- Each step's summary must be one sentence written in plain English a non-technical user understands`,
    schemaName: 'WorkflowMap',
    constraints: [
      'version must be 1',
      `ownerEmail must equal "${args.ownerEmail}"`,
      `operationName must equal "${args.operationName}"`,
      `digest.timezone must equal "${args.timezone}"`,
      'every step id must be unique and lowercase-hyphen',
      'every edge must reference existing step ids',
      'no step kind outside the schema enum',
    ],
  });

  const result = await runInvocation(router, store, {
    state: 'MAPPING',
    kind: 'mapping_generate_map',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: WorkflowMap,
  });

  if (result.ok) return result;

  // Both attempts failed. Fall back to the archetype template.
  const fallback = fallbackMapForArchetype({
    archetype: args.intent.archetype,
    operationName: args.operationName,
    ownerEmail: args.ownerEmail,
    timezone: args.timezone,
    intent: args.intent,
  });

  return {
    ok: true as const,
    data: fallback,
    invocationId: result.invocationId,
    fallbackUsed: true as const,
  };
}
