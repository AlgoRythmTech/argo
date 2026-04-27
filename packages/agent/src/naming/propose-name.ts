// Operation auto-naming.
//
// Operators describe a workflow in one sentence — "candidates apply to
// my recruiting site through a form, I want to read each one, reject
// most, and forward the strong ones to the hiring client" — and the
// untreated default is to truncate that sentence into the operation
// name. Result: a workspace full of slug-shaped sentences.
//
// proposeOperationName() asks GPT-5.5 for a clean 2-4 word Title Case
// name. Returns gracefully when the LLM is unavailable so the caller
// can fall back to a truncation.

import { z } from 'zod';
import { request } from 'undici';

export const ProposedName = z.object({
  /** 2-4 words, Title Case, no punctuation, no quotes. */
  name: z
    .string()
    .min(3)
    .max(40)
    .regex(
      /^[A-Z][A-Za-z0-9 &]{2,39}$/,
      'name must be Title Case, alphanumerics + space + &',
    ),
});
export type ProposedName = z.infer<typeof ProposedName>;

const NAMING_SYSTEM_PROMPT = `
You name workflows for an AI business operator called Argo.

# Hard rules

- Output ONLY a JSON object: { "name": "<2-4 words, Title Case>" }.
- 2-4 words. Title Case. NO punctuation. NO quotes. NO emoji.
- Max 40 chars. Allowed characters: A-Z a-z 0-9 space and ampersand.
- Pick a name that describes the OUTCOME, not the mechanism.
  Bad: "Form Receiver" | "API Endpoint"
  Good: "Candidate Intake" | "Demo Booking" | "Refund Triage"
- NEVER include "Workflow" or "Pipeline" or "Operation" — those
  words add no information.
- Avoid generic words like "System", "Manager", "Tool".
- The name will appear in lists alongside other operations, so
  prefer specificity over cleverness.
`.trim();

export interface ProposeNameArgs {
  sentence: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Compose a 2-4 word Title Case name. Throws on irrecoverable errors.
 * Caller should catch and fall back to a deterministic name.
 */
export async function proposeOperationName(args: ProposeNameArgs): Promise<ProposedName> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const primary = args.model ?? process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5';
  const fallback = process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o';

  const candidates = [primary, fallback].filter((m, i, arr) => arr.indexOf(m) === i);
  let lastErr: Error | null = null;

  for (const model of candidates) {
    try {
      const json = await callJson({ apiBase, apiKey, model, sentence: args.sentence, signal: args.signal });
      const baseObj = (typeof json === 'object' && json !== null
        ? json
        : {}) as Record<string, unknown>;
      const parsed = ProposedName.safeParse(baseObj);
      if (!parsed.success) {
        lastErr = new Error(
          `Name schema mismatch: ${parsed.error.message.slice(0, 240)}`,
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
  throw lastErr ?? new Error('proposeOperationName: no candidate model succeeded');
}

interface CallJsonArgs {
  apiBase: string;
  apiKey: string;
  model: string;
  sentence: string;
  signal?: AbortSignal;
}

async function callJson(args: CallJsonArgs): Promise<unknown> {
  const body = {
    model: args.model,
    response_format: { type: 'json_object' as const },
    temperature: 0.6,
    max_tokens: 60,
    messages: [
      { role: 'system' as const, content: NAMING_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: `Workflow description:\n"""${args.sentence.slice(0, 1200)}"""\n\nReturn the JSON now.`,
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
    bodyTimeout: 20_000,
    headersTimeout: 15_000,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    const e: Error & { status?: number } = new Error(
      `OpenAI naming ${args.model} -> ${res.statusCode}: ${text.slice(0, 240)}`,
    );
    e.status = res.statusCode;
    throw e;
  }
  const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = parsed.choices?.[0]?.message?.content ?? '';
  return JSON.parse(content);
}

/**
 * Deterministic fallback: take the first 3-4 meaningful words from the
 * sentence and Title Case them. Used when the LLM is unavailable.
 */
export function fallbackNameFromSentence(sentence: string): string {
  const stop = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'have',
    'i',
    'if',
    'in',
    'is',
    'it',
    'me',
    'my',
    'of',
    'on',
    'or',
    'so',
    'that',
    'the',
    'their',
    'them',
    'then',
    'they',
    'this',
    'to',
    'want',
    'we',
    'when',
    'who',
    'will',
    'with',
    'would',
    'you',
    'your',
  ]);
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const picked = words.slice(0, 3);
  if (picked.length === 0) return 'New Operation';
  return picked.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ').slice(0, 40);
}
