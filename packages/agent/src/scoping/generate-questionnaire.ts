// Generates a click-driven scoping questionnaire from the user's first
// sentence. This is THE differentiator — instead of asking "what do you
// want to build?" and accepting a fuzzy answer, Argo extracts a precise
// brief through 3-6 click-card questions a la Perplexity.

import { request } from 'undici';
import { nanoid } from 'nanoid';
import { ScopingQuestionnaire } from '@argo/shared-types';
import { pickSpecialist, type Specialist } from '../llm/specialist-prompts.js';

const QUESTIONNAIRE_SYSTEM_PROMPT = `
You are Argo's intake agent. The user gave you ONE sentence describing
the workflow they want to automate. Your job: produce a structured JSON
questionnaire of 4–6 questions that, when answered, will give Argo a
complete brief to build production code from.

# Hard rules

- Output ONLY a JSON object. No prose. No markdown.
- Every question MUST have kind ∈
    { single_choice, multi_choice, short_text, long_text, numeric, pick_one_of_recommended }.
- Choice questions MUST have 2–6 options. Each option has id, label, optional hint, optional recommended:true.
- For options requiring "Argo's recommendation", set exactly ONE option to recommended:true.
- briefField MUST come from this enum: name, audience, outcome, trigger,
  fields, integrations, auth, persistence, rate_limits, data_classification,
  success_criteria, voice_tone, reply_style, scheduling,
  notification_recipients, compliance_notes, free_form.
- Each question id MUST be a kebab-case slug.
- detectedSummary is one short sentence describing what you think they're building.
- Question count: 4–6 ideal. Never more than 6. Never fewer than 3.

# Strategic question selection

Pick the questions that resolve the largest amount of ambiguity. Skip
questions whose answer is obvious from the sentence. Always include
questions for: trigger (if ambiguous), audience, success criteria, and
ONE integration question if any third-party system is mentioned.

NEVER ask "what's it called?" — name it yourself based on the sentence.
NEVER ask "what kind of workflow is this?" — you should know.

# Tone

Questions should sound like a thoughtful product manager scoping a
project, not a wizard. Each prompt is 1 sentence. Optional helper text
is 1 sentence.

# JSON shape (strict)

{
  "id": "<short id>",
  "rawSentence": "<echo back the user's sentence>",
  "detectedSummary": "<one-sentence inference>",
  "specialist": "<one of: rest_api | crud_app | scraper_pipeline | scheduled_job | webhook_bridge | slack_bot | form_workflow | generic>",
  "questions": [ ... 4-6 questions ... ],
  "createdAt": "<ISO 8601 with timezone>"
}
`.trim();

export interface GenerateQuestionnaireArgs {
  sentence: string;
  /** Optional override of the model. Defaults to OPENAI_MODEL_PRIMARY. */
  model?: string;
  signal?: AbortSignal;
}

export async function generateQuestionnaire(
  args: GenerateQuestionnaireArgs,
): Promise<ScopingQuestionnaire> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const primary = args.model ?? process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5';
  const fallback = process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o';

  const specialist: Specialist = pickSpecialist({
    archetype: 'generic',
    triggerKind: 'form_submission',
    description: args.sentence,
  });

  const candidates = [primary, fallback].filter((m, i, arr) => arr.indexOf(m) === i);
  let lastErr: Error | null = null;

  for (const model of candidates) {
    try {
      const json = await callJson({
        apiBase,
        apiKey,
        model,
        sentence: args.sentence,
        specialist,
        signal: args.signal,
      });
      const baseObj = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
      const parsed = ScopingQuestionnaire.safeParse({
        ...baseObj,
        // Always overwrite — the model often hallucinates the id and timestamp.
        id: 'q_' + nanoid(12),
        rawSentence: args.sentence,
        specialist,
        createdAt: new Date().toISOString(),
      });
      if (!parsed.success) {
        lastErr = new Error(
          `Questionnaire schema mismatch: ${parsed.error.message.slice(0, 400)}`,
        );
        continue;
      }
      return parsed.data;
    } catch (err) {
      const e = err as Error & { status?: number };
      const transient =
        e.status === 404 ||
        e.status === 400 ||
        /model_not_found|invalid model/i.test(e.message ?? '');
      if (!transient) throw err;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('generateQuestionnaire: no candidate model succeeded');
}

interface CallJsonArgs {
  apiBase: string;
  apiKey: string;
  model: string;
  sentence: string;
  specialist: Specialist;
  signal?: AbortSignal;
}

async function callJson(args: CallJsonArgs): Promise<unknown> {
  const isGpt55 = args.model.startsWith('gpt-5.5');
  const body: Record<string, unknown> = {
    model: args.model,
    response_format: { type: 'json_object' as const },
    max_completion_tokens: 2200,
    messages: [
      { role: 'system' as const, content: QUESTIONNAIRE_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: `User's sentence:\n"""${args.sentence}"""\n\nDetected specialist: ${args.specialist}\n\nReturn the questionnaire JSON now.`,
      },
    ],
  };
  if (!isGpt55) body.temperature = 0.4;

  const res = await request(`${args.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(args.signal ? { signal: args.signal } : {}),
    bodyTimeout: 60_000,
    headersTimeout: 30_000,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    const e: Error & { status?: number } = new Error(
      `OpenAI questionnaire ${args.model} -> ${res.statusCode}: ${text.slice(0, 300)}`,
    );
    e.status = res.statusCode;
    throw e;
  }
  const parsed = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsed.choices?.[0]?.message?.content ?? '';
  return JSON.parse(content);
}
