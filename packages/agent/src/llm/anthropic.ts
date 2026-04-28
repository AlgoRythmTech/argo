import Anthropic from '@anthropic-ai/sdk';
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

/** Models that support the cache_control beta for system prompts. */
const CACHE_ELIGIBLE_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-sonnet-4-5',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
]);

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
 * Anthropic client using the official @anthropic-ai/sdk.
 *
 * Supports Claude Opus 4.6, Claude Sonnet 4.6, and all existing Claude
 * models. Uses tool-use for structured JSON output (same strategy as the
 * original undici-based client). Prompt caching is enabled for system
 * prompts on eligible models via the cache_control header.
 *
 * Optional Emergent proxy mode: if EMERGENT_ENABLED=true the client targets
 * the Emergent universal endpoint. This lets us route around outages without
 * changing call sites.
 */
export class AnthropicClient {
  private readonly sdk: Anthropic;
  private readonly emergentSdk: Anthropic | null;

  constructor(private readonly cfg: AnthropicConfig) {
    if (!cfg.apiKey && !cfg.emergentEnabled) {
      log.warn('ANTHROPIC_API_KEY missing — build engine will fail at first call');
    }

    this.sdk = new Anthropic({
      apiKey: cfg.apiKey || 'missing-key',
      baseURL: cfg.apiBase.endsWith('/v1') ? cfg.apiBase : `${cfg.apiBase}/v1`,
    });

    this.emergentSdk = cfg.emergentEnabled && cfg.emergentApiKey
      ? new Anthropic({
          apiKey: cfg.emergentApiKey,
          baseURL: cfg.emergentApiBase.endsWith('/v1')
            ? cfg.emergentApiBase
            : `${cfg.emergentApiBase}/v1`,
        })
      : null;
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
      process.env.ANTHROPIC_MODEL_FALLBACK ?? 'claude-haiku-4-5-20251001',
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
    const useEmergent = this.cfg.emergentEnabled && this.emergentSdk !== null;
    const client = useEmergent ? this.emergentSdk! : this.sdk;

    const inputSchema = zodToJsonSchema(args.schema, args.schemaName);
    const toolName = 'argo_response';

    const systemPrompt = `${pickSystemPrompt(args.schemaName)}\n\nReturn data exclusively via the argo_response tool. Do not produce free-text output.`;

    // Build the system parameter with prompt caching for eligible models.
    const useCaching = CACHE_ELIGIBLE_MODELS.has(args.model);
    const systemParam: Anthropic.MessageCreateParams['system'] = useCaching
      ? [
          {
            type: 'text' as const,
            text: systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : systemPrompt;

    try {
      const response = await client.messages.create({
        model: args.model,
        max_tokens: args.maxTokens,
        temperature: args.temperature,
        tools: [
          {
            name: toolName,
            description: `Return a JSON object that satisfies the ${args.schemaName} schema.`,
            input_schema: inputSchema as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool' as const, name: toolName },
        system: systemParam,
        messages: [{ role: 'user' as const, content: args.prompt }],
      });

      const toolUse = response.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === toolName,
      );

      if (!toolUse || toolUse.input === undefined) {
        // Fall back: maybe the model emitted text instead of using the tool.
        const textBlock = response.content.find(
          (c): c is Anthropic.TextBlock => c.type === 'text',
        );
        const textContent = textBlock?.text ?? '';
        const json = tolerantJsonParse(textContent);
        return {
          provider: useEmergent ? 'emergent' : 'anthropic',
          model: args.model,
          rawText: textContent,
          parsedJson: json,
          promptTokens: response.usage?.input_tokens ?? null,
          completionTokens: response.usage?.output_tokens ?? null,
          costUsd: null,
        };
      }

      return {
        provider: useEmergent ? 'emergent' : 'anthropic',
        model: args.model,
        rawText: JSON.stringify(toolUse.input),
        parsedJson: toolUse.input,
        promptTokens: response.usage?.input_tokens ?? null,
        completionTokens: response.usage?.output_tokens ?? null,
        costUsd: null,
      };
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e instanceof Anthropic.APIError) {
        const wrapped: Error & { status?: number } = new Error(
          `Anthropic ${args.model} -> ${e.status}: ${e.message.slice(0, 400)}`,
        );
        wrapped.status = e.status;
        throw wrapped;
      }
      throw e;
    }
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
