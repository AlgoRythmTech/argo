// Compiles an answered Questionnaire into a strictly-typed ProjectBrief.
// Deterministic — no LLM here. The brief is the single artifact the build
// loop consumes, so its shape must be predictable.

import {
  ProjectBrief,
  type QuestionnaireSubmission,
  type ScopingQuestionnaire,
} from '@argo/shared-types';

export interface CompileBriefArgs {
  questionnaire: ScopingQuestionnaire;
  submission: QuestionnaireSubmission;
  /** Inferred operation name (defaulted from sentence when no name question). */
  fallbackName: string;
  /** Owner email — used as default notification recipient + brief.audience helper. */
  ownerEmail: string;
}

export function compileBrief(args: CompileBriefArgs) {
  const { questionnaire, submission } = args;
  const answersById = new Map(submission.answers.map((a) => [a.questionId, a]));
  const defaulted: string[] = [];

  // Build a per-briefField bag of selected option labels + free text.
  const fieldBag = new Map<
    string,
    { selectedLabels: string[]; selectedIds: string[]; text: string | null }
  >();

  for (const q of questionnaire.questions) {
    const ans = answersById.get(q.id);
    const selectedIds = ans?.selectedOptionIds ?? [];
    const selectedLabels = selectedIds
      .map((id) => q.options.find((o) => o.id === id)?.label ?? id)
      .filter(Boolean);
    const text = ans?.textValue?.trim() ?? null;
    const existing = fieldBag.get(q.briefField) ?? { selectedLabels: [], selectedIds: [], text: null };
    existing.selectedLabels.push(...selectedLabels);
    existing.selectedIds.push(...selectedIds);
    if (text && !existing.text) existing.text = text;
    fieldBag.set(q.briefField, existing);
  }

  const pick = (field: string) => fieldBag.get(field);

  const name = pick('name')?.text ?? args.fallbackName;
  if (!pick('name')?.text) defaulted.push('name');

  const audience =
    pick('audience')?.text ??
    pick('audience')?.selectedLabels[0] ??
    'Operator\'s contacts';
  if (!pick('audience')?.text && !pick('audience')?.selectedLabels.length) defaulted.push('audience');

  const outcome =
    pick('outcome')?.text ??
    pick('outcome')?.selectedLabels[0] ??
    questionnaire.detectedSummary;
  if (!pick('outcome')?.text && !pick('outcome')?.selectedLabels.length) defaulted.push('outcome');

  const triggerRaw = pick('trigger')?.selectedIds[0] ?? pick('trigger')?.text ?? '';
  const trigger = mapTrigger(triggerRaw, questionnaire.specialist);
  if (!triggerRaw) defaulted.push('trigger');

  const integrations = mapIntegrations(pick('integrations'));
  if (integrations.length === 0) defaulted.push('integrations');

  const auth = mapAuth(pick('auth'));
  if (!pick('auth')?.selectedIds.length) defaulted.push('auth');

  const persistence = mapPersistence(pick('persistence'));
  if (!pick('persistence')?.selectedIds.length) defaulted.push('persistence');

  const dataClassification = mapDataClassification(pick('data_classification'));
  if (!pick('data_classification')?.selectedIds.length) defaulted.push('data_classification');

  const successCriteria = pick('success_criteria')?.text
    ? splitLines(pick('success_criteria')!.text!)
    : pick('success_criteria')?.selectedLabels ?? [];
  if (successCriteria.length === 0) defaulted.push('success_criteria');

  const replyStyle = mapReplyStyle(pick('reply_style'));
  if (!pick('reply_style')?.selectedIds.length) defaulted.push('reply_style');

  const voiceTone = pick('voice_tone')?.text ?? undefined;
  if (!voiceTone) defaulted.push('voice_tone');

  const notificationRecipients = pick('notification_recipients')?.text
    ? extractEmails(pick('notification_recipients')!.text!)
    : [args.ownerEmail];
  if (!pick('notification_recipients')?.text) defaulted.push('notification_recipients');

  const complianceNotes = pick('compliance_notes')?.text ?? undefined;
  if (!complianceNotes) defaulted.push('compliance_notes');

  const freeForm = pick('free_form')?.text ?? undefined;

  // Form fields synthesised from the answer to the "fields" question
  // OR — when the user didn't get one — from the canonical Argo defaults
  // for the chosen specialist.
  const fields =
    deriveFields(pick('fields'), trigger, questionnaire.specialist) ?? [];
  if (fields.length === 0 && trigger === 'form_submission') defaulted.push('fields');

  const briefCandidate: ProjectBrief = {
    name,
    audience,
    outcome,
    trigger,
    fields,
    integrations,
    auth,
    persistence,
    rateLimits: { formPerMinutePerIp: 60, webhookPerMinutePerIp: 1000 },
    dataClassification,
    successCriteria,
    ...(voiceTone !== undefined ? { voiceTone } : {}),
    replyStyle,
    scheduling: { digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' },
    notificationRecipients,
    ...(complianceNotes !== undefined ? { complianceNotes } : {}),
    ...(freeForm !== undefined ? { freeForm } : {}),
    defaulted,
    questionnaireId: questionnaire.id,
    generatedAt: new Date().toISOString(),
  };

  // Validate against the schema — throws if anything's off, which is what
  // we want (a malformed brief is worse than no brief).
  return ProjectBrief.parse(briefCandidate);
}

// ── Mapping helpers ────────────────────────────────────────────────────

function mapTrigger(
  raw: string,
  specialist: ScopingQuestionnaire['specialist'],
): ProjectBrief['trigger'] {
  const r = raw.toLowerCase();
  if (r.includes('form') || r === 'form_submission') return 'form_submission';
  if (r.includes('email') || r === 'email_received') return 'email_received';
  if (r.includes('schedule') || r.includes('cron') || r === 'scheduled') return 'scheduled';
  if (r.includes('webhook')) return 'webhook';
  // Sensible specialist-driven default.
  if (specialist === 'scheduled_job') return 'scheduled';
  if (specialist === 'webhook_bridge') return 'webhook';
  if (specialist === 'slack_bot') return 'webhook';
  return 'form_submission';
}

function mapIntegrations(
  bag: { selectedIds: string[]; selectedLabels: string[]; text: string | null } | undefined,
): ProjectBrief['integrations'] {
  if (!bag) return [];
  const knownEnums: ProjectBrief['integrations'] = [];
  const allow: ReadonlySet<string> = new Set([
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
  ]);
  for (const id of bag.selectedIds) {
    const norm = id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (allow.has(norm)) knownEnums.push(norm as ProjectBrief['integrations'][number]);
  }
  if (bag.text) {
    const tokens = bag.text
      .toLowerCase()
      .split(/[,\s]+/)
      .map((t) => t.replace(/[^a-z0-9_]/g, '_'));
    for (const t of tokens) {
      if (allow.has(t)) knownEnums.push(t as ProjectBrief['integrations'][number]);
    }
  }
  return Array.from(new Set(knownEnums));
}

function mapAuth(
  bag: { selectedIds: string[] } | undefined,
): ProjectBrief['auth'] {
  const id = bag?.selectedIds[0]?.toLowerCase() ?? '';
  if (id.includes('magic')) return 'magic_link';
  if (id.includes('api_key') || id.includes('apikey')) return 'api_key';
  if (id.includes('google')) return 'oauth_google';
  if (id.includes('github')) return 'oauth_github';
  if (id === 'none' || id.includes('public')) return 'none';
  return 'none';
}

function mapPersistence(
  bag: { selectedIds: string[] } | undefined,
): ProjectBrief['persistence'] {
  const id = bag?.selectedIds[0]?.toLowerCase() ?? '';
  if (id.includes('postgres') || id.includes('sql')) return 'postgres';
  if (id.includes('memory')) return 'in_memory';
  return 'mongodb';
}

function mapDataClassification(
  bag: { selectedIds: string[] } | undefined,
): ProjectBrief['dataClassification'] {
  const id = bag?.selectedIds[0]?.toLowerCase() ?? '';
  if (id.includes('public')) return 'public';
  if (id.includes('internal')) return 'internal';
  if (id.includes('kyc')) return 'pii_with_kyc';
  return 'pii';
}

function mapReplyStyle(
  bag: { selectedIds: string[] } | undefined,
): ProjectBrief['replyStyle'] {
  const id = bag?.selectedIds[0]?.toLowerCase() ?? '';
  if (id.includes('formal')) return 'formal';
  if (id.includes('brief')) return 'brief';
  if (id.includes('casual')) return 'casual';
  return 'warm';
}

function deriveFields(
  bag: { selectedIds: string[]; text: string | null } | undefined,
  trigger: ProjectBrief['trigger'],
  specialist: ScopingQuestionnaire['specialist'],
): ProjectBrief['fields'] {
  if (trigger !== 'form_submission') return [];
  if (bag?.text) {
    const lines = splitLines(bag.text);
    if (lines.length > 0) {
      return lines.slice(0, 30).map((label) => ({
        id: slugify(label),
        label,
        type: inferFieldType(label),
        required: !/optional|opt\.|\(optional\)/i.test(label),
        options: [],
      }));
    }
  }
  // Specialist-driven default field set.
  if (specialist === 'form_workflow') {
    return [
      { id: 'full-name', label: 'Full name', type: 'short_text', required: true, options: [] },
      { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
      { id: 'phone', label: 'Phone', type: 'phone', required: false, options: [] },
      {
        id: 'message',
        label: 'Message',
        type: 'long_text',
        required: true,
        options: [],
      },
    ];
  }
  return [];
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractEmails(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return text.match(re) ?? [];
}

function inferFieldType(label: string): ProjectBrief['fields'][number]['type'] {
  const l = label.toLowerCase();
  if (/email/.test(l)) return 'email';
  if (/phone|mobile|cell/.test(l)) return 'phone';
  if (/url|link|website/.test(l)) return 'url';
  if (/date|when/.test(l)) return 'date';
  if (/age|years|count|amount/.test(l)) return 'number';
  if (/file|attachment|resume|cv/.test(l)) return 'file_upload';
  if (/why|describe|comments?|notes?|message/.test(l)) return 'long_text';
  return 'short_text';
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'field';
}
