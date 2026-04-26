import { z } from 'zod';
import { EmailAddress, IsoDateString, ShortId, Slug, TimeZone } from './common.js';

/**
 * The trigger types Argo recognises in v1. Determined deterministically from
 * the user's free-text description in the LISTENING state. Adding a new
 * trigger type requires updating the question decision tree in
 * /packages/agent/src/listening/question-tree.ts.
 */
export const TriggerType = z.enum(['form_submission', 'email_received', 'scheduled']);
export type TriggerType = z.infer<typeof TriggerType>;

export const FormFieldType = z.enum([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'select',
  'multi_select',
  'file_upload',
  'url',
]);
export type FormFieldType = z.infer<typeof FormFieldType>;

export const FormField = z.object({
  id: Slug,
  label: z.string().min(1).max(120),
  type: FormFieldType,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  helpText: z.string().max(400).optional(),
  validation: z
    .object({
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      pattern: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .optional(),
});
export type FormField = z.infer<typeof FormField>;

export const TriggerConfig = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('form_submission'),
    formTitle: z.string().min(1).max(160),
    formDescription: z.string().max(800).optional(),
    fields: z.array(FormField).min(1).max(40),
    confirmationMessage: z.string().max(400).optional(),
  }),
  z.object({
    type: z.literal('email_received'),
    inbox: EmailAddress,
    label: z.string().min(1).max(80).optional(),
    subjectPattern: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal('scheduled'),
    cron: z.string().min(9).max(120),
    timezone: TimeZone,
  }),
]);
export type TriggerConfig = z.infer<typeof TriggerConfig>;

/**
 * The deterministic shape Maya's three answers produce. Validated before any
 * downstream LLM call. Failing validation triggers re-ask once, then escalation.
 */
export const WorkflowIntent = z.object({
  rawDescription: z.string().min(20).max(4000),
  trigger: TriggerType,
  audienceDescription: z.string().min(3).max(400),
  outcomeDescription: z.string().min(3).max(800),
  approvalRequired: z.boolean().default(true),
  recipients: z.array(EmailAddress).max(20).default([]),
  schedule: z
    .object({
      cron: z.string(),
      timezone: TimeZone,
    })
    .optional(),
  voiceCorpusEmails: z.array(z.string()).max(50).default([]),
  archetype: z
    .enum(['candidate_intake', 'lead_qualification', 'onboarding_sequence', 'generic'])
    .default('generic'),
});
export type WorkflowIntent = z.infer<typeof WorkflowIntent>;

/**
 * Step kinds in a WorkflowMap. Every kind has a deterministic runtime
 * implementation in /packages/build-engine/src/runtime-steps/{kind}.ts.
 * Adding a new kind requires both a renderer (web) and an executor (runtime).
 */
export const StepKind = z.enum([
  'trigger',
  'validate',
  'enrich',
  'classify',
  'draft_email',
  'approval_gate',
  'send_email',
  'wait',
  'persist',
  'notify',
  'schedule_followup',
  'digest',
]);
export type StepKind = z.infer<typeof StepKind>;

export const StepConfig = z.record(z.string(), z.unknown());

export const WorkflowStep = z.object({
  id: Slug,
  kind: StepKind,
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(240),
  config: StepConfig.default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const WorkflowEdge = z.object({
  id: Slug,
  source: Slug,
  target: Slug,
  label: z.string().max(60).optional(),
  condition: z.string().max(400).optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

/**
 * The artifact the user signs off on before BUILDING starts. Every step
 * carries enough config to be code-generated without an additional LLM round.
 */
export const WorkflowMap = z.object({
  version: z.literal(1),
  operationName: z.string().min(3).max(80),
  ownerEmail: EmailAddress,
  trigger: TriggerConfig,
  steps: z.array(WorkflowStep).min(2).max(20),
  edges: z.array(WorkflowEdge).min(1).max(60),
  digest: z
    .object({
      enabled: z.boolean().default(true),
      cron: z.string().default('0 9 * * 1'),
      timezone: TimeZone,
      audience: z.array(EmailAddress).max(5),
    })
    .optional(),
  metadata: z
    .object({
      archetype: WorkflowIntent.shape.archetype,
      generatedFromIntentId: ShortId.optional(),
      generatedAt: IsoDateString.optional(),
    })
    .optional(),
});
export type WorkflowMap = z.infer<typeof WorkflowMap>;

export const WorkflowMapDraft = WorkflowMap.partial({ steps: true, edges: true }).extend({
  status: z.enum(['draft', 'awaiting_user', 'confirmed']).default('draft'),
});
export type WorkflowMapDraft = z.infer<typeof WorkflowMapDraft>;
