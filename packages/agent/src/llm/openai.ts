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
    const jsonSchema = zodToJsonSchema(args.schema, args.schemaName);

    const body = {
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
      max_tokens: args.maxTokens,
      temperature: args.temperature,
    };

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
      // Fall back: model doesn't support json_schema — retry with json_object.
      return this.completeJsonObject(args);
    }
    if (res.statusCode >= 400) {
      throw new Error(`OpenAI ${args.model} -> ${res.statusCode}: ${text.slice(0, 400)}`);
    }
    return this.unwrapResponse(text, args.model);
  }

  private async completeJsonObject<TSchema extends z.ZodTypeAny>(
    args: OpenAiCompleteArgs<TSchema>,
  ): Promise<LlmCallResult> {
    const body = {
      model: args.model,
      messages: [
        {
          role: 'system' as const,
          content: `${pickSystemPrompt(args.schemaName)}\n\nThe schema you must satisfy is named ${args.schemaName}.`,
        },
        { role: 'user' as const, content: args.prompt },
      ],
      response_format: { type: 'json_object' as const },
      max_tokens: args.maxTokens,
      temperature: args.temperature,
    };

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
