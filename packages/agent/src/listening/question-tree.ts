import type { TriggerType } from '@argo/shared-types';

/**
 * The deterministic question tree.
 *
 * Section 10: "LISTENING — exactly three questions. The questions are
 * determined by the trigger type the user describes. There is a decision
 * tree, not a free-form prompt."
 *
 * Trigger detection is keyword-based. Three questions per trigger from a
 * fixed menu of nine. Adding a fourth is an architectural change, not a
 * tweak.
 */

const TRIGGER_KEYWORDS: Array<{ trigger: TriggerType; words: RegExp }> = [
  { trigger: 'form_submission', words: /\b(form|candidate|candidates|applications|leads|signup|signups|application)\b/i },
  { trigger: 'email_received', words: /\b(email|emails|inbox|inboxes|gmail|label|reply|replies|message|messages)\b/i },
  { trigger: 'scheduled', words: /\b(every monday|every (mon|tue|wed|thu|fri|sat|sun)|weekly|daily|cron|schedule|every (day|week|month))\b/i },
];

export function detectTrigger(rawDescription: string): TriggerType {
  for (const { trigger, words } of TRIGGER_KEYWORDS) {
    if (words.test(rawDescription)) return trigger;
  }
  return 'form_submission'; // default — most common in v1
}

export type QuestionId =
  | 'who_audience'
  | 'what_outcome'
  | 'when_intervals'
  | 'form_fields'
  | 'inbox_label'
  | 'cron_pattern'
  | 'recipients'
  | 'voice_examples'
  | 'archetype';

export type Question = {
  id: QuestionId;
  prompt: string;
  helper?: string;
};

const QUESTION_BANK: Record<QuestionId, Question> = {
  who_audience: {
    id: 'who_audience',
    prompt: 'Who is on the other end of this workflow? Describe them in one sentence.',
    helper: 'e.g. "engineering candidates applying to my client searches"',
  },
  what_outcome: {
    id: 'what_outcome',
    prompt: 'What outcome do you want from each one? In one sentence.',
    helper: 'e.g. "either reject politely, schedule a screening call, or forward to the client"',
  },
  when_intervals: {
    id: 'when_intervals',
    prompt: 'How often does this happen, and how soon do you respond?',
    helper: 'e.g. "10–30 a week, I usually reply within a day"',
  },
  form_fields: {
    id: 'form_fields',
    prompt: 'What does the form ask for today? List each field on its own line.',
    helper: 'paste from your existing form, plain text',
  },
  inbox_label: {
    id: 'inbox_label',
    prompt: 'Which inbox or label should Argo watch? Tell me the address or label name.',
  },
  cron_pattern: {
    id: 'cron_pattern',
    prompt: 'When should this run? Describe the schedule in plain English.',
    helper: 'e.g. "every Monday at 9am Eastern"',
  },
  recipients: {
    id: 'recipients',
    prompt: 'Who should be CC\'d on the outbound emails, if anyone?',
    helper: 'comma-separated email addresses, or "none"',
  },
  voice_examples: {
    id: 'voice_examples',
    prompt: 'Paste 2–3 emails you\'ve sent recently in the same voice you want Argo to use.',
    helper: 'these stay private — they\'re used to teach the model your tone',
  },
  archetype: {
    id: 'archetype',
    prompt: 'Pick the closest match: candidate intake, lead qualification, onboarding, or "something else".',
  },
};

const QUESTIONS_BY_TRIGGER: Record<TriggerType, [QuestionId, QuestionId, QuestionId]> = {
  form_submission: ['who_audience', 'what_outcome', 'form_fields'],
  email_received: ['who_audience', 'what_outcome', 'inbox_label'],
  scheduled: ['who_audience', 'what_outcome', 'cron_pattern'],
};

export function questionsFor(trigger: TriggerType): Question[] {
  return QUESTIONS_BY_TRIGGER[trigger].map((id) => QUESTION_BANK[id]);
}

export type DialogueAnswers = {
  trigger: TriggerType;
  rawDescription: string;
  answers: Record<QuestionId, string>;
};
