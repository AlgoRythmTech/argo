import type { z } from 'zod';
import type { AgentInvocationKind, AgentProvider } from '@argo/shared-types';
import { OpenAiClient } from './openai.js';
import { AnthropicClient } from './anthropic.js';

/**
 * Router that picks the right model + provider for a given invocation kind.
 *
 * Section 13: "Claude Sonnet 4 as primary [...] No multi-model routing in
 * v1. Adding GPT-5.5 or Opus as a fallback is a Phase-7 decision, not a
 * Phase-0 hedge."
 *
 * Founder override (this build): use OpenAI gpt-5.5 as the primary for
 * MAPPING / RUNNING / DIGEST / REPAIR. Use Anthropic Claude Opus 4.7 for
 * BUILDING (heavy code-generation pass). One model per kind. No round-robin.
 */

export type LlmCallArgs<TSchema extends z.ZodTypeAny> = {
  kind: AgentInvocationKind;
  prompt: string;
  schema: TSchema;
  schemaName: string;
};

export type LlmCallResult = {
  provider: AgentProvider;
  model: string;
  rawText: string;
  parsedJson: unknown;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
};

export interface LlmRouter {
  complete<TSchema extends z.ZodTypeAny>(args: LlmCallArgs<TSchema>): Promise<LlmCallResult>;
}

/**
 * Routing table — maps invocation kind to (provider, model). Adding a kind
 * here is the only supported way to introduce a new model in v1.
 */
export const ROUTING_TABLE: Record<
  AgentInvocationKind,
  { provider: AgentProvider; modelEnv: string; defaultModel: string; maxTokens: number; temperature: number }
> = {
  listening_extract_intent: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 1500,
    temperature: 0.1,
  },
  mapping_generate_map: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 4000,
    temperature: 0.2,
  },
  mapping_apply_edit: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 2000,
    temperature: 0.2,
  },
  building_generate_file: {
    provider: 'anthropic',
    modelEnv: 'ANTHROPIC_MODEL_BUILD',
    defaultModel: 'claude-opus-4-7',
    maxTokens: 8000,
    temperature: 0.0,
  },
  testing_diagnose_failure: {
    provider: 'anthropic',
    modelEnv: 'ANTHROPIC_MODEL_BUILD',
    defaultModel: 'claude-opus-4-7',
    maxTokens: 4000,
    temperature: 0.1,
  },
  running_parse_inbound_reply: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 1000,
    temperature: 0.1,
  },
  running_compose_digest: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 1500,
    temperature: 0.5,
  },
  running_classify_submission: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 1500,
    temperature: 0.2,
  },
  running_draft_outbound_email: {
    provider: 'openai',
    modelEnv: 'OPENAI_MODEL_PRIMARY',
    defaultModel: 'gpt-5.5',
    maxTokens: 1500,
    temperature: 0.4,
  },
  repair_propose_patch: {
    provider: 'anthropic',
    modelEnv: 'ANTHROPIC_MODEL_BUILD',
    defaultModel: 'claude-opus-4-7',
    maxTokens: 6000,
    temperature: 0.1,
  },
  repair_propose_smaller_patch: {
    provider: 'anthropic',
    modelEnv: 'ANTHROPIC_MODEL_BUILD',
    defaultModel: 'claude-opus-4-7',
    maxTokens: 4000,
    temperature: 0.0,
  },
};

export class DefaultLlmRouter implements LlmRouter {
  constructor(
    private readonly openai: OpenAiClient,
    private readonly anthropic: AnthropicClient,
  ) {}

  static fromEnv(): DefaultLlmRouter {
    return new DefaultLlmRouter(OpenAiClient.fromEnv(), AnthropicClient.fromEnv());
  }

  async complete<TSchema extends z.ZodTypeAny>(args: LlmCallArgs<TSchema>): Promise<LlmCallResult> {
    const route = ROUTING_TABLE[args.kind];
    const model = process.env[route.modelEnv] ?? route.defaultModel;

    if (route.provider === 'openai') {
      return this.openai.completeJson({
        model,
        prompt: args.prompt,
        schema: args.schema,
        schemaName: args.schemaName,
        maxTokens: route.maxTokens,
        temperature: route.temperature,
      });
    }
    return this.anthropic.completeJson({
      model,
      prompt: args.prompt,
      schema: args.schema,
      schemaName: args.schemaName,
      maxTokens: route.maxTokens,
      temperature: route.temperature,
    });
  }
}
