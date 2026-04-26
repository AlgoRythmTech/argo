import { z } from 'zod';
import { IsoDateString, ShortId } from './common.js';

/**
 * Five-state machine. RUNNING is dormant — the agent is invoked only on the
 * three triggers documented in Section 10. Between invocations, deterministic
 * code executes. Agents do not loop in production. Code loops. Agents reflect.
 */
export const AgentState = z.enum(['LISTENING', 'MAPPING', 'BUILDING', 'TESTING', 'RUNNING']);
export type AgentState = z.infer<typeof AgentState>;

export const AgentInvocationKind = z.enum([
  'listening_extract_intent',
  'mapping_generate_map',
  'mapping_apply_edit',
  'building_generate_file',
  'testing_diagnose_failure',
  'running_parse_inbound_reply',
  'running_compose_digest',
  'running_classify_submission',
  'running_draft_outbound_email',
  'repair_propose_patch',
  'repair_propose_smaller_patch',
]);
export type AgentInvocationKind = z.infer<typeof AgentInvocationKind>;

/**
 * Six-field context envelope, never an ad-hoc string concat. Every model call
 * logs the full envelope to `agent_invocations` for replay and audit. When
 * something goes wrong, you replay the envelope, identify the misleading
 * field, and fix the envelope construction — not the prompt.
 */
export const ContextEnvelope = z.object({
  operationSummary: z.object({
    operationId: ShortId,
    operationName: z.string(),
    triggerKind: z.string(),
    audience: z.string(),
    outcome: z.string(),
  }),
  recentEvents: z.array(
    z.object({
      timestamp: IsoDateString,
      kind: z.string(),
      summary: z.string(),
    }),
  ),
  triggerPayload: z.unknown(),
  relevantTemplate: z
    .object({
      templateId: ShortId,
      kind: z.string(),
      body: z.string(),
      approvalRate: z.number().min(0).max(1),
      sendsToDate: z.number().int().nonnegative(),
    })
    .nullable(),
  voiceCorpus: z.array(
    z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      sentAt: IsoDateString,
    }),
  ),
  instruction: z.object({
    task: z.string(),
    schemaName: z.string(),
    constraints: z.array(z.string()).default([]),
  }),
});
export type ContextEnvelope = z.infer<typeof ContextEnvelope>;

export const AgentInvocationStatus = z.enum([
  'pending',
  'in_flight',
  'succeeded',
  'failed_parse',
  'failed_provider',
  'rejected_validation',
  'fallback_template',
]);
export type AgentInvocationStatus = z.infer<typeof AgentInvocationStatus>;

export const AgentProvider = z.enum(['openai', 'anthropic', 'emergent']);
export type AgentProvider = z.infer<typeof AgentProvider>;

export const AgentInvocation = z.object({
  id: ShortId,
  operationId: ShortId.nullable(),
  ownerId: ShortId,
  state: AgentState,
  kind: AgentInvocationKind,
  status: AgentInvocationStatus,
  provider: AgentProvider,
  model: z.string(),
  envelope: ContextEnvelope,
  rawResponse: z.string().nullable(),
  parsedResponse: z.unknown().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  createdAt: IsoDateString,
  completedAt: IsoDateString.nullable(),
});
export type AgentInvocation = z.infer<typeof AgentInvocation>;
