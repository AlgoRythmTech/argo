import { z } from 'zod';
import { ShortId, Slug } from './common.js';

/**
 * The Scoping Questionnaire — the click-driven artifact that turns one
 * fuzzy sentence into a precise ProjectBrief. Inspired by Perplexity's
 * "follow-up questions as button-cards" pattern but evolved for software
 * specification.
 *
 * The agent generates this from the user's first sentence. The user
 * answers in 30 seconds by clicking. The answers compile into a
 * ProjectBrief that the build loop consumes verbatim.
 */

export const QuestionKind = z.enum([
  'single_choice',
  'multi_choice',
  'short_text',
  'long_text',
  'numeric',
  'pick_one_of_recommended', // single_choice + a recommended hint per option
]);
export type QuestionKind = z.infer<typeof QuestionKind>;

export const QuestionOption = z.object({
  id: Slug,
  label: z.string().min(1).max(120),
  /** Optional 1-line helper rendered under the option button. */
  hint: z.string().max(200).optional(),
  /** True for the option the agent recommends; UI ribbons it. */
  recommended: z.boolean().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const ScopingQuestion = z.object({
  id: Slug,
  /** Plain-English question shown to the user. */
  prompt: z.string().min(8).max(280),
  /** Renders below the prompt in lighter text. */
  helper: z.string().max(280).optional(),
  kind: QuestionKind,
  options: z.array(QuestionOption).max(8).default([]),
  /** Free-text placeholder for short_text / long_text / numeric. */
  placeholder: z.string().max(120).optional(),
  required: z.boolean().default(true),
  /** Maps the user's answer into a key in the ProjectBrief. */
  briefField: z.enum([
    'name',
    'audience',
    'outcome',
    'trigger',
    'fields',
    'integrations',
    'auth',
    'persistence',
    'rate_limits',
    'data_classification',
    'success_criteria',
    'voice_tone',
    'reply_style',
    'scheduling',
    'notification_recipients',
    'compliance_notes',
    'free_form',
  ]),
});
export type ScopingQuestion = z.infer<typeof ScopingQuestion>;

export const ScopingQuestionnaire = z.object({
  id: ShortId,
  rawSentence: z.string().min(8).max(2000),
  /** What the agent thinks the user is building. Shown as the title above the questions. */
  detectedSummary: z.string().min(8).max(280),
  /** The deterministic specialist Argo will dispatch to once the brief lands. */
  specialist: z.enum([
    'rest_api',
    'crud_app',
    'scraper_pipeline',
    'scheduled_job',
    'webhook_bridge',
    'slack_bot',
    'form_workflow',
    'generic',
  ]),
  questions: z.array(ScopingQuestion).min(3).max(8),
  createdAt: z.string().datetime({ offset: true }),
});
export type ScopingQuestionnaire = z.infer<typeof ScopingQuestionnaire>;

/**
 * A single answer the user picked / typed for one question.
 */
export const QuestionAnswer = z.object({
  questionId: Slug,
  /** Set when the question is single/multi/pick_one_of_recommended. */
  selectedOptionIds: z.array(Slug).default([]),
  /** Set when the question is short_text/long_text/numeric. */
  textValue: z.string().max(2000).optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

export const QuestionnaireSubmission = z.object({
  questionnaireId: ShortId,
  answers: z.array(QuestionAnswer).min(1),
});
export type QuestionnaireSubmission = z.infer<typeof QuestionnaireSubmission>;

/**
 * The compiled output — a precise machine-readable spec the build loop
 * consumes verbatim. Every field is either filled by the user via the
 * questionnaire OR carried forward from a sensible default (recorded in
 * `defaulted` so the operator can see what Argo assumed).
 */
export const ProjectBrief = z.object({
  // Identity
  name: z.string().min(2).max(80),
  audience: z.string().min(3).max(280),
  outcome: z.string().min(3).max(400),

  // Trigger
  trigger: z.enum(['form_submission', 'email_received', 'scheduled', 'webhook']),

  // Form fields (only when trigger=form_submission). Each field has a
  // type the form generator + Zod schema generator can use directly.
  fields: z
    .array(
      z.object({
        id: Slug,
        label: z.string().min(1).max(120),
        type: z.enum([
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
        ]),
        required: z.boolean().default(true),
        options: z.array(z.string()).max(50).default([]),
      }),
    )
    .default([]),

  // Integrations the user explicitly asked for. The build loop wires the
  // matching specialist patterns + adds the right deps via dyad-add-dependency.
  integrations: z
    .array(
      z.enum([
        'slack',
        'discord',
        'gmail',
        'calendly',
        'stripe',
        'mongodb',
        'postgres',
        'sendgrid',
        'twilio',
        'openai',
        'anthropic',
        's3',
        'webhooks_inbound',
        'webhooks_outbound',
      ]),
    )
    .default([]),

  // Auth model for the operator's clients (NOT for Argo itself).
  auth: z.enum(['none', 'magic_link', 'api_key', 'oauth_google', 'oauth_github']).default('none'),

  persistence: z.enum(['mongodb', 'postgres', 'in_memory']).default('mongodb'),

  rateLimits: z
    .object({
      formPerMinutePerIp: z.number().int().positive().default(60),
      webhookPerMinutePerIp: z.number().int().positive().default(1000),
    })
    .default({ formPerMinutePerIp: 60, webhookPerMinutePerIp: 1000 }),

  dataClassification: z
    .enum(['public', 'internal', 'pii', 'pii_with_kyc'])
    .default('pii'),

  successCriteria: z.array(z.string().min(3).max(200)).default([]),

  voiceTone: z.string().max(280).optional(),
  replyStyle: z.enum(['brief', 'warm', 'formal', 'casual']).default('warm'),

  scheduling: z
    .object({
      digestEnabled: z.boolean().default(true),
      digestCron: z.string().default('0 9 * * 1'),
      digestTimezone: z.string().default('America/New_York'),
    })
    .default({ digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' }),

  notificationRecipients: z.array(z.string().email()).max(10).default([]),

  complianceNotes: z.string().max(800).optional(),

  /** Anything else the user wrote in the free-text question. */
  freeForm: z.string().max(2000).optional(),

  // Provenance — which fields the user explicitly answered vs. defaulted.
  defaulted: z.array(z.string()).default([]),
  questionnaireId: ShortId,
  generatedAt: z.string().datetime({ offset: true }),
});
export type ProjectBrief = z.infer<typeof ProjectBrief>;
