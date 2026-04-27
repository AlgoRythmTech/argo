// Per-operation README generator.
//
// Every Argo operation produces real production code, but the operator
// is rarely the one who reads code. They (and their non-technical
// co-founder, lawyer, ops lead) want a one-page plain-English summary:
// what does this thing do, how does it work, what do you do if it
// breaks. This generator turns the brief + bundle inventory into that
// document.
//
// Three sections. No bullet lists. No code blocks. Written like a
// briefing memo from a senior engineer to an executive.

import { z } from 'zod';
import { request } from 'undici';

export const OperationReadme = z.object({
  /** Plain-English title. NOT the slug. */
  title: z.string().min(4).max(80),
  /** One-sentence elevator pitch. The hook. */
  oneLine: z.string().min(20).max(220),
  /** What this operation does, in 2-3 paragraphs. Audience: non-engineer. */
  whatItDoes: z.string().min(120).max(2400),
  /** How it works -- the mechanism, in plain English. 2-3 paragraphs. */
  howItWorks: z.string().min(120).max(2400),
  /** "If something breaks" -- what the operator should do. 1-2 paragraphs. */
  ifSomethingBreaks: z.string().min(80).max(1600),
});
export type OperationReadme = z.infer<typeof OperationReadme>;

const README_SYSTEM_PROMPT = `
You are Argo's documentarian. The operator just shipped a production
workflow. Your job: write a one-page README that any non-engineer on
their team could read and understand.

# Hard rules

- Output ONLY a JSON object matching this shape:
    { title, oneLine, whatItDoes, howItWorks, ifSomethingBreaks }
- No prose outside JSON. No markdown fences. No code samples.
- "title" is plain English (e.g. "Candidate intake & rejection
  pipeline" — NOT "candidate-intake-pipeline-2x9k").
- "oneLine" is the hook a CEO would tweet.
- "whatItDoes" describes the OUTCOME from the operator's perspective.
  Avoid implementation details. 2-3 paragraphs.
- "howItWorks" describes the MECHANISM in plain English. You may
  mention "a form on your site", "an email arrives in your inbox",
  "Argo waits for your approval" — but NEVER mention class names,
  function names, or framework names. 2-3 paragraphs.
- "ifSomethingBreaks" tells the operator what to do when a submission
  doesn't show up, a form fails, or an email isn't sent. Reference
  Argo's repair flow ("Argo will email you a proposed fix") rather
  than asking the operator to read logs. 1-2 paragraphs.

# Tone

Write like a briefing memo from a senior engineer to an executive.
Short sentences. Confident. No hedging. No marketing copy.

# JSON shape (strict)

{
  "title": "<plain English title>",
  "oneLine": "<one-sentence elevator pitch>",
  "whatItDoes": "<2-3 paragraphs separated by \\n\\n>",
  "howItWorks": "<2-3 paragraphs separated by \\n\\n>",
  "ifSomethingBreaks": "<1-2 paragraphs separated by \\n\\n>"
}
`.trim();

export interface ComposeReadmeArgs {
  operationName: string;
  /**
   * Plain-English brief facts. We pass JSON; the model ignores fields
   * it can't use. Pull this from the latest project_brief.
   */
  brief: {
    name: string;
    audience: string;
    outcome: string;
    trigger: string;
    integrations: readonly string[];
    auth: string;
    persistence: string;
    successCriteria: readonly string[];
    voiceTone?: string | null;
    replyStyle: string;
    complianceNotes?: string | null;
  };
  /** Bundle file paths so the model can sense the surface area. */
  filePaths: readonly string[];
  /** New deps installed (npm packages). */
  newDependencies?: readonly string[];
  model?: string;
  signal?: AbortSignal;
}

export async function composeOperationReadme(args: ComposeReadmeArgs): Promise<OperationReadme> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const primary = args.model ?? process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5';
  const fallback = process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o';

  const candidates = [primary, fallback].filter((m, i, arr) => arr.indexOf(m) === i);
  let lastErr: Error | null = null;
  for (const model of candidates) {
    try {
      const json = await callJson({ apiBase, apiKey, model, args });
      const baseObj =
        (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
      const parsed = OperationReadme.safeParse(baseObj);
      if (!parsed.success) {
        lastErr = new Error(`Readme schema mismatch: ${parsed.error.message.slice(0, 400)}`);
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
  throw lastErr ?? new Error('composeOperationReadme: no candidate model succeeded');
}

interface CallJsonArgs {
  apiBase: string;
  apiKey: string;
  model: string;
  args: ComposeReadmeArgs;
}

async function callJson({ apiBase, apiKey, model, args }: CallJsonArgs): Promise<unknown> {
  const briefSummary = JSON.stringify(args.brief, null, 2);
  const fileList = args.filePaths.slice(0, 80).join('\n');
  const deps = (args.newDependencies ?? []).slice(0, 30).join(', ');
  const userMsg =
    `Operation: ${args.operationName}\n\n` +
    `Brief facts:\n${briefSummary}\n\n` +
    `Files in the bundle (${args.filePaths.length} total):\n${fileList}\n\n` +
    (deps ? `Dependencies installed: ${deps}\n\n` : '') +
    `Write the README JSON now.`;

  const body = {
    model,
    response_format: { type: 'json_object' as const },
    temperature: 0.4,
    max_tokens: 2000,
    messages: [
      { role: 'system' as const, content: README_SYSTEM_PROMPT },
      { role: 'user' as const, content: userMsg },
    ],
  };

  const res = await request(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
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
      `OpenAI readme ${model} -> ${res.statusCode}: ${text.slice(0, 300)}`,
    );
    e.status = res.statusCode;
    throw e;
  }
  const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = parsed.choices?.[0]?.message?.content ?? '';
  return JSON.parse(content);
}

/**
 * Render an OperationReadme as a markdown string for download / copy /
 * direct rendering by react-markdown (or our own simple renderer).
 */
export function renderReadmeAsMarkdown(r: OperationReadme): string {
  return [
    `# ${r.title}`,
    '',
    `> ${r.oneLine}`,
    '',
    '## What this does',
    '',
    r.whatItDoes,
    '',
    '## How it works',
    '',
    r.howItWorks,
    '',
    '## If something breaks',
    '',
    r.ifSomethingBreaks,
    '',
    '---',
    '',
    `_Generated by Argo. Re-renders every time the bundle version bumps._`,
  ].join('\n');
}
