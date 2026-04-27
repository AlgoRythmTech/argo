// Multi-round scoping refinement.
//
// After the operator answers the first questionnaire, compileBrief
// returns a typed ProjectBrief plus a `defaulted: string[]` listing
// every field we had to fill in from a default. Some defaults are
// fine ("we'll use yourself as the only notification recipient");
// some leave the build dangerously vague ("we don't know what fields
// the form has, so we picked generic ones").
//
// generateFollowups() takes the brief + the original questionnaire +
// submission and asks GPT-5.5 to mint AT MOST 3 follow-up questions,
// strictly typed against the same ScopingQuestionnaire schema. If the
// brief is already crisp, the model is allowed to return zero
// questions and we surface "refined: false".
//
// Hard rules:
//   - Never re-ask a question already answered well.
//   - Never invent fields that weren't in the original brief.
//   - Cap at 3 follow-ups so the operator never feels interrogated.

import { z } from 'zod';
import { request } from 'undici';
import { nanoid } from 'nanoid';
import {
  ScopingQuestionnaire,
  type ProjectBrief,
  type QuestionnaireSubmission,
} from '@argo/shared-types';

const FOLLOWUP_SYSTEM_PROMPT = `
You are Argo's intake refiner. The operator already answered an initial
scoping questionnaire. We compiled a draft ProjectBrief from those
answers. Some fields had to be defaulted — they appear in the brief's
"defaulted" array.

Your job: decide whether 1-3 SHORT follow-up questions would meaningfully
sharpen the build. If everything is crisp enough to build a high-quality
production stack, return ZERO questions.

# Hard rules

- Output ONLY a JSON object. No prose. No markdown. No code fences.
- AT MOST 3 follow-up questions. Often 0, 1, or 2 is correct.
- NEVER re-ask anything the operator already answered well. The first
  questionnaire's answers are below — read them.
- Each question MUST follow the SAME shape as the first questionnaire:
    { id (kebab-case), kind, briefField, prompt, helper?, options[], optional }
- briefField MUST be one of: name, audience, outcome, trigger, fields,
  integrations, auth, persistence, rate_limits, data_classification,
  success_criteria, voice_tone, reply_style, scheduling,
  notification_recipients, compliance_notes, free_form.
- For choice kinds, supply 2-6 options. Mark exactly one as recommended:true.
- "rationale" is one sentence per question explaining WHY the gap matters.

# Strategic question selection

Prioritise (in order):
  1. Defaulted fields whose default could mis-steer the build (e.g.
     fields=[] when trigger is form_submission means we'll guess columns).
  2. Vague success criteria ("works well", "looks good") — ask for one
     concrete acceptance test the operator would actually check.
  3. Voice / reply_style mismatches — if the audience is "VC partners"
     but the reply_style is "casual", ask once.
  4. Compliance notes when audience implies regulated data (PII, PHI,
     financial, EU residents) and notes are empty.

If NONE of the above apply, return { "questions": [] } and don't fish.

# JSON shape (strict)

{
  "questions": [ ...0-3 questions, EACH with a "rationale" field in addition to the normal Question shape ... ],
  "refinementSummary": "<one sentence: what gap(s) we're closing — or 'no refinement needed'>"
}
`.trim();

/** Followups response from the LLM. Same Question shape as ScopingQuestionnaire.questions, plus a rationale. */
export const RefinementQuestion = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      'single_choice',
      'multi_choice',
      'short_text',
      'long_text',
      'numeric',
      'pick_one_of_recommended',
    ]),
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
    prompt: z.string().min(1),
    helper: z.string().optional(),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          hint: z.string().optional(),
          recommended: z.boolean().optional(),
        }),
      )
      .max(6)
      .default([]),
    optional: z.boolean().optional(),
    rationale: z.string().min(1).max(280),
  })
  .strict();

export type RefinementQuestion = z.infer<typeof RefinementQuestion>;

export const RefinementResponse = z.object({
  questions: z.array(RefinementQuestion).max(3),
  refinementSummary: z.string().min(1).max(280),
});

export type RefinementResponse = z.infer<typeof RefinementResponse>;

export interface GenerateFollowupsArgs {
  brief: ProjectBrief;
  questionnaire: ScopingQuestionnaire;
  submission: QuestionnaireSubmission;
  /** Optional model override. Defaults to OPENAI_MODEL_PRIMARY. */
  model?: string;
  signal?: AbortSignal;
}

export interface FollowupResult {
  refined: boolean;
  refinementSummary: string;
  /** When refined=true, this is the new partial-questionnaire to ask. */
  questionnaire?: ScopingQuestionnaire;
  /** Echoes the per-question rationale list so the UI can render "why". */
  rationales: Array<{ questionId: string; rationale: string }>;
}

export async function generateFollowups(args: GenerateFollowupsArgs): Promise<FollowupResult> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const primary = args.model ?? process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5';
  const fallback = process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o';

  const candidates = [primary, fallback].filter((m, i, arr) => arr.indexOf(m) === i);
  let lastErr: Error | null = null;

  for (const model of candidates) {
    try {
      const json = await callJson({
        apiBase,
        apiKey,
        model,
        brief: args.brief,
        questionnaire: args.questionnaire,
        submission: args.submission,
        signal: args.signal,
      });
      const baseObj = (typeof json === 'object' && json !== null
        ? json
        : {}) as Record<string, unknown>;
      const parsed = RefinementResponse.safeParse(baseObj);
      if (!parsed.success) {
        lastErr = new Error(
          `Refinement schema mismatch: ${parsed.error.message.slice(0, 400)}`,
        );
        continue;
      }
      const data = parsed.data;
      if (data.questions.length === 0) {
        return {
          refined: false,
          refinementSummary: data.refinementSummary,
          rationales: [],
        };
      }

      // Repackage as a fresh ScopingQuestionnaire so the existing
      // submission flow can answer it without bespoke handling.
      const refinedQuestionnaire = ScopingQuestionnaire.parse({
        id: 'q_' + nanoid(12),
        rawSentence: args.questionnaire.rawSentence,
        detectedSummary: `Refinement after first round: ${data.refinementSummary}`,
        specialist: args.questionnaire.specialist,
        questions: data.questions.map((q) => ({
          id: q.id,
          kind: q.kind,
          briefField: q.briefField,
          prompt: q.prompt,
          ...(q.helper !== undefined ? { helper: q.helper } : {}),
          options: q.options,
          ...(q.optional !== undefined ? { optional: q.optional } : {}),
        })),
        createdAt: new Date().toISOString(),
      });

      return {
        refined: true,
        refinementSummary: data.refinementSummary,
        questionnaire: refinedQuestionnaire,
        rationales: data.questions.map((q) => ({ questionId: q.id, rationale: q.rationale })),
      };
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
  throw lastErr ?? new Error('generateFollowups: no candidate model succeeded');
}

interface CallJsonArgs {
  apiBase: string;
  apiKey: string;
  model: string;
  brief: ProjectBrief;
  questionnaire: ScopingQuestionnaire;
  submission: QuestionnaireSubmission;
  signal?: AbortSignal;
}

async function callJson(args: CallJsonArgs): Promise<unknown> {
  // Compress the prior round into a tight Q/A pairing so the model
  // can read the operator's exact intent without parsing the full
  // submission shape.
  const answersById = new Map(args.submission.answers.map((a) => [a.questionId, a]));
  const priorRoundLines: string[] = [];
  for (const q of args.questionnaire.questions) {
    const ans = answersById.get(q.id);
    const selected = (ans?.selectedOptionIds ?? [])
      .map((id) => q.options.find((o) => o.id === id)?.label ?? id)
      .filter(Boolean)
      .join(', ');
    const text = ans?.textValue?.trim() ?? '';
    const answerLine = [selected, text].filter(Boolean).join(' — ');
    priorRoundLines.push(`Q: ${q.prompt}\nA: ${answerLine || '(no answer)'}`);
  }

  const briefSummary = JSON.stringify(
    {
      name: args.brief.name,
      audience: args.brief.audience,
      outcome: args.brief.outcome,
      trigger: args.brief.trigger,
      fieldsCount: args.brief.fields.length,
      integrations: args.brief.integrations,
      auth: args.brief.auth,
      persistence: args.brief.persistence,
      dataClassification: args.brief.dataClassification,
      successCriteria: args.brief.successCriteria,
      replyStyle: args.brief.replyStyle,
      voiceTone: args.brief.voiceTone ?? null,
      complianceNotes: args.brief.complianceNotes ?? null,
      defaulted: args.brief.defaulted,
    },
    null,
    2,
  );

  const body = {
    model: args.model,
    response_format: { type: 'json_object' as const },
    temperature: 0.3,
    max_tokens: 1800,
    messages: [
      { role: 'system' as const, content: FOLLOWUP_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content:
          `Operator's original sentence:\n"""${args.questionnaire.rawSentence}"""\n\n` +
          `Detected specialist: ${args.questionnaire.specialist}\n\n` +
          `Compiled brief so far:\n${briefSummary}\n\n` +
          `First-round Q&A:\n${priorRoundLines.join('\n\n')}\n\n` +
          `Return the refinement JSON now. Zero questions is a valid answer.`,
      },
    ],
  };

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
      `OpenAI followups ${args.model} -> ${res.statusCode}: ${text.slice(0, 300)}`,
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
