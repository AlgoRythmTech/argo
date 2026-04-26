import { WorkflowMap, type WorkflowMap as WorkflowMapType } from '@argo/shared-types';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';

/**
 * State 2 in the UI lets the user click a step and say "make this wait 24
 * hours" or "ask for resume URL too". This invocation rewrites the map
 * in-place. The constraint set is tight — we only allow edits within the
 * step's config and metadata fields, never the kind or the trigger.
 */
export async function applyMapEdit(
  router: LlmRouter,
  store: InvocationStore,
  args: {
    operationId: string;
    ownerId: string;
    currentMap: WorkflowMapType;
    targetStepId: string;
    userInstruction: string;
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.currentMap.operationName,
    triggerKind: args.currentMap.trigger.type,
    audience: args.currentMap.metadata?.archetype ?? 'unknown',
    outcome: '(edit in place)',
    recentEvents: [],
    triggerPayload: {
      currentMap: args.currentMap,
      targetStepId: args.targetStepId,
      userInstruction: args.userInstruction,
    },
    relevantTemplate: null,
    voiceCorpus: [],
    task:
      'Apply the user\'s edit to the named step in the WorkflowMap and return the updated map. Preserve the trigger, version, and ownerEmail. Only modify the step the user named, plus any edges immediately adjacent if the edit changes flow. Never invent new step kinds.',
    schemaName: 'WorkflowMap',
    constraints: [
      'version must be 1',
      `ownerEmail must equal "${args.currentMap.ownerEmail}"`,
      `operationName must equal "${args.currentMap.operationName}"`,
      `the step with id "${args.targetStepId}" MUST be present in the result`,
      'do not change the trigger config',
    ],
  });

  return runInvocation(router, store, {
    state: 'MAPPING',
    kind: 'mapping_apply_edit',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: WorkflowMap,
  });
}
