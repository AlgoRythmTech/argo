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

const log = pino({ name: 'anthropic-client', level: process.env.LOG_LEVEL ?? 'info' });

export type AnthropicConfig = {
  apiKey: string;
  apiBase: string;
  emergentEnabled: boolean;
  emergentApiKey: string;
  emergentApiBase: string;
};

export type AnthropicCompleteArgs<TSchema extends z.ZodTypeAny> = {
  model: string;
  prompt: string;
  schema: TSchema;
  schemaName: string;
  maxTokens: number;
  temperature: number;
};

/**
 * Thin Anthropic client constrained to JSON output via tool use.
 *
 * Strategy: define a single tool whose input_schema is the JSON Schema for
 * the response. Force tool_choice to that tool. The first tool_use block in
 * the response is the JSON we want. This is the most reliable way to get
 * structured output from Claude in v1.
 *
 * Optional Emergent proxy mode: if EMERGENT_ENABLED=true the client targets
 * the Emergent universal endpoint (which also speaks the Anthropic Messages
 * shape). This lets us route around outages without changing call sites.
 */
export class AnthropicClient {
  constructor(private readonly cfg: AnthropicConfig) {
    if (!cfg.apiKey && !cfg.emergentEnabled) {
      log.warn('ANTHROPIC_API_KEY missing — build engine will fail at first call');
    }
  }

  static fromEnv(): AnthropicClient {
    return new AnthropicClient({
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      apiBase: process.env.ANTHROPIC_API_BASE ?? 'https://api.anthropic.com',
      emergentEnabled: (process.env.EMERGENT_ENABLED ?? '').toLowerCase() === 'true',
      emergentApiKey: process.env.EMERGENT_API_KEY ?? '',
      emergentApiBase: process.env.EMERGENT_API_BASE ?? 'https://api.emergent.sh/v1',
    });
  }

  async completeJson<TSchema extends z.ZodTypeAny>(
    args: AnthropicCompleteArgs<TSchema>,
  ): Promise<LlmCallResult> {
    const candidates = uniqueModels([
      args.model,
      process.env.ANTHROPIC_MODEL_FALLBACK ?? 'claude-sonnet-4-5',
      'claude-sonnet-4-20250514',
    ]);
    let lastErr: Error | null = null;
    for (const model of candidates) {
      try {
        return await this.completeJsonOnce({ ...args, model });
      } catch (err) {
        const e = err as Error & { status?: number };
        const transient =
          e.status === 404 ||
          e.status === 400 ||
          /not_found_error|invalid model|model.*not exist/i.test(e.message ?? '');
        if (!transient) throw err;
        lastErr = e;
        log.warn({ model, err: e.message }, 'anthropic model unavailable, falling back');
      }
    }
    throw lastErr ?? new Error('Anthropic completion failed across all candidates');
  }

  private async completeJsonOnce<TSchema extends z.ZodTypeAny>(
    args: AnthropicCompleteArgs<TSchema>,
  ): Promise<LlmCallResult> {
    const useEmergent = this.cfg.emergentEnabled && this.cfg.emergentApiKey.length > 0;
    const apiBase = useEmergent ? this.cfg.emergentApiBase : this.cfg.apiBase;
    const url = `${apiBase}/v1/messages`;
    const apiKey = useEmergent ? this.cfg.emergentApiKey : this.cfg.apiKey;

    const inputSchema = zodToJsonSchema(args.schema, args.schemaName);
    const toolName = 'argo_response';

    const body = {
      model: args.model,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
      tools: [
        {
          name: toolName,
          description: `Return a JSON object that satisfies the ${args.schemaName} schema.`,
          input_schema: inputSchema,
        },
      ],
      tool_choice: { type: 'tool' as const, name: toolName },
      system: `${pickSystemPrompt(args.schemaName)}\n\nReturn data exclusively via the argo_response tool. Do not produce free-text output.`,
      messages: [{ role: 'user' as const, content: args.prompt }],
    };

    const res = await request(url, {
      method: 'POST',
      headers: useEmergent
        ? {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
          }
        : {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
      body: JSON.stringify(body),
      bodyTimeout: 120_000,
      headersTimeout: 120_000,
    });

    const text = await res.body.text();
    if (res.statusCode >= 400) {
      const e: Error & { status?: number } = new Error(
        `Anthropic ${args.model} -> ${res.statusCode}: ${text.slice(0, 400)}`,
      );
      e.status = res.statusCode;
      throw e;
    }

    const parsed = JSON.parse(text) as {
      content?: Array<{ type: string; input?: unknown; name?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const toolUse = parsed.content?.find((c) => c.type === 'tool_use' && c.name === toolName);
    if (!toolUse || toolUse.input === undefined) {
      // Fall back: maybe the model emitted text instead of using the tool.
      const textBlock = parsed.content?.find((c) => c.type === 'text')?.text ?? '';
      const json = tolerantJsonParse(textBlock);
      return {
        provider: useEmergent ? 'emergent' : 'anthropic',
        model: args.model,
        rawText: textBlock,
        parsedJson: json,
        promptTokens: parsed.usage?.input_tokens ?? null,
        completionTokens: parsed.usage?.output_tokens ?? null,
        costUsd: null,
      };
    }

    return {
      provider: useEmergent ? 'emergent' : 'anthropic',
      model: args.model,
      rawText: JSON.stringify(toolUse.input),
      parsedJson: toolUse.input,
      promptTokens: parsed.usage?.input_tokens ?? null,
      completionTokens: parsed.usage?.output_tokens ?? null,
      costUsd: null,
    };
  }
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
    const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(stripped);
  }
}
