// Streaming build — drives GPT-5.5 (or the OpenAI fallback) to emit
// dyad-write/rename/delete/add-dependency tags chunk-by-chunk. Each chunk
// is parsed against Dyad's tag grammar by the caller as it arrives so the
// UI can show files appearing in real time.

import { request } from 'undici';
import { buildSpecialistSystemPrompt, type Specialist } from './specialist-prompts.js';

export interface StreamBuildArgs {
  specialist: Specialist;
  /** The user's free-text description of what to build. */
  userPrompt: string;
  /** Optional priors — e.g. existing files or the current WorkflowMap. */
  context?: string;
  /** Model name (default OPENAI_MODEL_PRIMARY = gpt-5.5). */
  model?: string;
  /** AbortSignal so the API route can cut the stream when the client disconnects. */
  signal?: AbortSignal;
  /** Soft cap on completion tokens. Default 8000 — enough for ~10 files. */
  maxTokens?: number;
}

export interface StreamBuildChunk {
  /** Concatenated text the model has produced so far. */
  fullText: string;
  /** Just the delta produced in this chunk (for SSE forwarding). */
  delta: string;
  /** Cumulative tokens consumed (input + output) when the provider reports it. */
  totalTokens: number | null;
  /** Set when the stream finishes naturally. */
  done: boolean;
  /** Set when the stream was aborted. */
  aborted: boolean;
}

/**
 * Yields chunks as the model streams. Caller (the API route) is responsible
 * for forwarding deltas to the client and parsing fullText with the Dyad
 * tag parser to extract structured actions.
 */
export async function* streamBuild(args: StreamBuildArgs): AsyncGenerator<StreamBuildChunk> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const primary = args.model ?? process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5';
  const fallback = process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY missing — set it in .env.local before invoking the build agent');
  }

  const candidates = unique([primary, fallback]);
  let lastErr: Error | null = null;

  for (const model of candidates) {
    try {
      yield* streamOnce({
        apiBase,
        apiKey,
        model,
        system: buildSpecialistSystemPrompt(args.specialist),
        userPrompt: args.userPrompt,
        context: args.context,
        maxTokens: args.maxTokens ?? 8000,
        signal: args.signal,
      });
      return;
    } catch (err) {
      const e = err as Error & { status?: number };
      const transient =
        e.status === 404 ||
        e.status === 400 ||
        /model_not_found|does not exist|invalid model/i.test(e.message ?? '');
      if (!transient) throw err;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('streamBuild: no candidate model succeeded');
}

interface StreamOnceArgs {
  apiBase: string;
  apiKey: string;
  model: string;
  system: string;
  userPrompt: string;
  context?: string;
  maxTokens: number;
  signal?: AbortSignal;
}

async function* streamOnce(args: StreamOnceArgs): AsyncGenerator<StreamBuildChunk> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: args.system },
  ];
  if (args.context) {
    messages.push({ role: 'user', content: `# Context (existing project)\n\n${args.context}` });
  }
  messages.push({ role: 'user', content: args.userPrompt });

  const body = {
    model: args.model,
    messages,
    stream: true,
    max_tokens: args.maxTokens,
    temperature: 0.2, // Low — code generation is not creative writing.
  };

  const res = await request(`${args.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: args.signal,
    bodyTimeout: 0,
    headersTimeout: 60_000,
  });

  if (res.statusCode >= 400) {
    const text = await res.body.text();
    const e: Error & { status?: number } = new Error(
      `OpenAI streaming ${args.model} -> ${res.statusCode}: ${text.slice(0, 300)}`,
    );
    e.status = res.statusCode;
    throw e;
  }

  let buffer = '';
  let fullText = '';
  let totalTokens: number | null = null;
  const decoder = new TextDecoder();

  for await (const chunk of res.body) {
    if (args.signal?.aborted) {
      yield { fullText, delta: '', totalTokens, done: false, aborted: true };
      return;
    }
    buffer += decoder.decode(chunk, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');

      const dataLines = event
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const dataStr = dataLines.join('');
      if (dataStr === '[DONE]') {
        yield { fullText, delta: '', totalTokens, done: true, aborted: false };
        return;
      }
      let parsed: OpenAiStreamEvent;
      try {
        parsed = JSON.parse(dataStr) as OpenAiStreamEvent;
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (parsed.usage?.total_tokens !== undefined) totalTokens = parsed.usage.total_tokens;
      if (delta) {
        fullText += delta;
        yield { fullText, delta, totalTokens, done: false, aborted: false };
      }
    }
  }

  yield { fullText, delta: '', totalTokens, done: true, aborted: false };
}

interface OpenAiStreamEvent {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
