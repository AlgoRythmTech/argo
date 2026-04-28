import { request } from 'undici';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import pino from 'pino';
import type { LlmCallResult } from './router.js';
import {
  ARGO_BASE_SYSTEM_PROMPT,
  BUILD_ENGINE_SYSTEM_PROMPT,
  RUNNING_SYSTEM_PROMPT,
} from './system-prompts.js';

function pickSystemPrompt(schemaName: string): string {
  if (schemaName === 'RepairPatch' || schemaName.startsWith('Building')) {
    return BUILD_ENGINE_SYSTEM_PROMPT;
  }
  if (
    schemaName === 'WeeklyDigest' ||
    schemaName === 'EmailDraft' ||
    schemaName === 'InboundReplyIntent' ||
    schemaName === 'SubmissionClassification'
  ) {
    return RUNNING_SYSTEM_PROMPT;
  }
  return ARGO_BASE_SYSTEM_PROMPT;
}

const log = pino({ name: 'openai-client', level: process.env.LOG_LEVEL ?? 'info' });

export type OpenAiConfig = {
  apiKey: string;
  apiBase: string;
  timeoutMs: number;
};

export type OpenAiCompleteArgs<TSchema extends z.ZodTypeAny> = {
  model: string;
  prompt: string;
  schema: TSchema;
  schemaName: string;
  maxTokens: number;
  temperature: number;
};

/**
 * Thin OpenAI client constrained to JSON-mode completions.
 *
 * Uses the responses API style: a single `input` message and a
 * `response_format` of `json_schema` so the model returns a parseable
 * payload. If the chosen model doesn't support response_format we fall back
 * to the chat completions API with `response_format: { type: "json_object" }`.
 */
export class OpenAiClient {
  constructor(private readonly cfg: OpenAiConfig) {
    if (!cfg.apiKey) {
      log.warn('OPENAI_API_KEY missing — agent will fail at first call');
    }
  }

  static fromEnv(): OpenAiClient {
    return new OpenAiClient({
      apiKey: process.env.OPENAI_API_KEY ?? '',
      apiBase: process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1',
      timeoutMs: Number.parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? '120000', 10),
    });
  }

  async completeJson<TSchema extends z.ZodTypeAny>(
    args: OpenAiCompleteArgs<TSchema>,
  ): Promise<LlmCallResult> {
    const candidates = uniqueModels([args.model, process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o']);
    let lastErr: Error | null = null;
    for (const model of candidates) {
      try {
        return await this.completeJsonOnce({ ...args, model });
      } catch (err) {
        const e = err as Error & { status?: number; reason?: string };
        const transient =
          e.status === 404 ||
          e.status === 400 ||
          /model_not_found|does not exist|invalid model/i.test(e.message ?? '');
        if (!transient) throw err;
        lastErr = e;
        log.warn({ model, err: e.message }, 'openai model unavailable, falling back');
      }
    }
    throw lastErr ?? new Error('OpenAI completion failed across all candidates');
  }

  private async completeJsonOnce<TSchema extends z.ZodTypeAny>(
    args: OpenAiCompleteArgs<TSchema>,
  ): Promise<LlmCallResult> {
    const jsonSchema = zodToJsonSchema(args.schema, args.schemaName);

    const temp = tempForModel(args.model, args.temperature);
    const body: Record<string, unknown> = {
      model: args.model,
      messages: [
        { role: 'system' as const, content: pickSystemPrompt(args.schemaName) },
        { role: 'user' as const, content: args.prompt },
      ],
      response_format: {
        type: 'json_schema' as const,
        json_schema: {
          name: args.schemaName,
          schema: jsonSchema,
          strict: false,
        },
      },
      max_completion_tokens: args.maxTokens,
    };
    if (temp !== undefined) body.temperature = temp;

    const res = await request(`${this.cfg.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      bodyTimeout: this.cfg.timeoutMs,
      headersTimeout: this.cfg.timeoutMs,
    });
    const text = await res.body.text();
    if (res.statusCode === 400 && text.includes('response_format')) {
      return this.completeJsonObject(args);
    }
    if (res.statusCode >= 400) {
      const e: Error & { status?: number } = new Error(
        `OpenAI ${args.model} -> ${res.statusCode}: ${text.slice(0, 400)}`,
      );
      e.status = res.statusCode;
      throw e;
    }
    return this.unwrapResponse(text, args.model);
  }

  private async completeJsonObject<TSchema extends z.ZodTypeAny>(
    args: OpenAiCompleteArgs<TSchema>,
  ): Promise<LlmCallResult> {
    const temp2 = tempForModel(args.model, args.temperature);
    const body: Record<string, unknown> = {
      model: args.model,
      messages: [
        {
          role: 'system' as const,
          content: `${pickSystemPrompt(args.schemaName)}\n\nThe schema you must satisfy is named ${args.schemaName}.`,
        },
        { role: 'user' as const, content: args.prompt },
      ],
      response_format: { type: 'json_object' as const },
      max_completion_tokens: args.maxTokens,
    };
    if (temp2 !== undefined) body.temperature = temp2;

    const res = await request(`${this.cfg.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      bodyTimeout: this.cfg.timeoutMs,
      headersTimeout: this.cfg.timeoutMs,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      throw new Error(`OpenAI fallback ${args.model} -> ${res.statusCode}: ${text.slice(0, 400)}`);
    }
    return this.unwrapResponse(text, args.model);
  }

  /**
   * Free-form text completion (no JSON schema constraint). Used by the
   * conversational chat assistant where structured output isn't needed.
   */
  async completeText(args: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    temperature: number;
  }): Promise<{ text: string; model: string; promptTokens: number | null; completionTokens: number | null }> {
    const candidates = uniqueModels([args.model, process.env.OPENAI_MODEL_FALLBACK ?? 'gpt-4o']);
    let lastErr: Error | null = null;
    for (const model of candidates) {
      try {
        const temp3 = tempForModel(model, args.temperature);
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: 'system' as const, content: args.systemPrompt },
            { role: 'user' as const, content: args.userPrompt },
          ],
          max_completion_tokens: args.maxTokens,
        };
        if (temp3 !== undefined) body.temperature = temp3;
        const res = await request(`${this.cfg.apiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.cfg.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          bodyTimeout: this.cfg.timeoutMs,
          headersTimeout: this.cfg.timeoutMs,
        });
        const text = await res.body.text();
        if (res.statusCode >= 400) {
          const e: Error & { status?: number } = new Error(
            `OpenAI ${model} -> ${res.statusCode}: ${text.slice(0, 400)}`,
          );
          e.status = res.statusCode;
          throw e;
        }
        const parsed = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        return {
          text: parsed.choices?.[0]?.message?.content ?? '',
          model,
          promptTokens: parsed.usage?.prompt_tokens ?? null,
          completionTokens: parsed.usage?.completion_tokens ?? null,
        };
      } catch (err) {
        const e = err as Error & { status?: number };
        const transient = e.status === 404 || e.status === 400 || /model_not_found|does not exist/i.test(e.message ?? '');
        if (!transient) throw err;
        lastErr = e;
        log.warn({ model, err: e.message }, 'openai text model unavailable, falling back');
      }
    }
    throw lastErr ?? new Error('OpenAI text completion failed across all candidates');
  }

  private unwrapResponse(text: string, model: string): LlmCallResult {
    const parsed = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = parsed.choices?.[0]?.message?.content ?? '';
    const json = tolerantJsonParse(content);
    return {
      provider: 'openai',
      model,
      rawText: content,
      parsedJson: json,
      promptTokens: parsed.usage?.prompt_tokens ?? null,
      completionTokens: parsed.usage?.completion_tokens ?? null,
      costUsd: null,
    };
  }
}

/**
 * GPT-5.5 does not support the temperature parameter — only default (1) is
 * accepted. Return the temperature value to include in the request body, or
 * undefined to omit it entirely.
 */
function tempForModel(model: string, requested: number): number | undefined {
  if (model.startsWith('gpt-5.5')) return undefined;
  return requested;
}

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    if (!m) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

function tolerantJsonParse(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip code fences if present.
    const fenceStripped = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      return JSON.parse(fenceStripped);
    } catch (err) {
      throw new Error(`OpenAI returned non-JSON content: ${String(err).slice(0, 200)}`);
    }
  }
}
