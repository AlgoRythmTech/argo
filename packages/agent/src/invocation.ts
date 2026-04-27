import { z } from 'zod';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { redactPiiObject } from '@argo/security';
import {
  AgentInvocation,
  type AgentInvocationKind,
  type AgentProvider,
  type AgentState,
  type ContextEnvelope,
} from '@argo/shared-types';
import { renderEnvelopeAsPrompt } from './envelope.js';
import type { LlmRouter, LlmCallResult } from './llm/router.js';
import { estimateCost } from './cost/pricing.js';

const log = pino({ name: 'agent-invocation', level: process.env.LOG_LEVEL ?? 'info' });

export type InvocationStore = {
  /** Append-only persistence. The repair worker replays from this. */
  insert(invocation: z.infer<typeof AgentInvocation>): Promise<void>;
};

export type RunInvocationArgs<TSchema extends z.ZodTypeAny> = {
  state: AgentState;
  kind: AgentInvocationKind;
  operationId: string | null;
  ownerId: string;
  envelope: ContextEnvelope;
  schema: TSchema;
  /**
   * Whether to retry once with the parse error appended on a parse failure.
   * Section 10: "If parsing fails, retry once with a correction prompt that
   * includes the parse error."
   */
  allowOneCorrection?: boolean;
};

export type RunInvocationResult<TSchema extends z.ZodTypeAny> =
  | { ok: true; data: z.infer<TSchema>; invocationId: string }
  | { ok: false; reason: 'parse_failed' | 'provider_failed' | 'validation_failed'; invocationId: string; errorMessage: string };

/**
 * Single entry point for any LLM call. Constructs the prompt from the
 * envelope, executes via the router, parses against the schema, persists
 * the invocation, and returns a typed result.
 */
export async function runInvocation<TSchema extends z.ZodTypeAny>(
  router: LlmRouter,
  store: InvocationStore,
  args: RunInvocationArgs<TSchema>,
): Promise<RunInvocationResult<TSchema>> {
  const id = `inv_${nanoid(16)}`;
  const startedAt = Date.now();
  const allowCorrection = args.allowOneCorrection ?? true;

  const prompt = renderEnvelopeAsPrompt(args.envelope);

  let llmResult: LlmCallResult;
  try {
    llmResult = await router.complete({
      kind: args.kind,
      prompt,
      schema: args.schema,
      schemaName: args.envelope.instruction.schemaName,
    });
  } catch (err) {
    await persist(store, {
      id,
      operationId: args.operationId,
      ownerId: args.ownerId,
      state: args.state,
      kind: args.kind,
      status: 'failed_provider',
      provider: 'openai',
      model: 'unknown',
      envelope: args.envelope,
      rawResponse: null,
      parsedResponse: null,
      errorMessage: redactErr(err),
      durationMs: Date.now() - startedAt,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      createdAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
    });
    return { ok: false, reason: 'provider_failed', invocationId: id, errorMessage: redactErr(err) };
  }

  let parsed = args.schema.safeParse(llmResult.parsedJson);
  if (!parsed.success && allowCorrection) {
    const correctionPrompt = `${prompt}\n\n# Previous attempt FAILED schema validation\n${parsed.error.message.slice(0, 1500)}\n\nReturn ONLY a JSON object that satisfies ${args.envelope.instruction.schemaName}. Do not wrap in prose.`;
    try {
      llmResult = await router.complete({
        kind: args.kind,
        prompt: correctionPrompt,
        schema: args.schema,
        schemaName: args.envelope.instruction.schemaName,
      });
      parsed = args.schema.safeParse(llmResult.parsedJson);
    } catch (err) {
      await persist(store, {
        id,
        operationId: args.operationId,
        ownerId: args.ownerId,
        state: args.state,
        kind: args.kind,
        status: 'failed_provider',
        provider: llmResult.provider,
        model: llmResult.model,
        envelope: args.envelope,
        rawResponse: llmResult.rawText,
        parsedResponse: null,
        errorMessage: redactErr(err),
        durationMs: Date.now() - startedAt,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        costUsd: llmResult.costUsd,
        createdAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      });
      return { ok: false, reason: 'provider_failed', invocationId: id, errorMessage: redactErr(err) };
    }
  }

  if (!parsed.success) {
    log.warn({ id, error: parsed.error.message }, 'invocation parse failed after correction');
    await persist(store, {
      id,
      operationId: args.operationId,
      ownerId: args.ownerId,
      state: args.state,
      kind: args.kind,
      status: 'failed_parse',
      provider: llmResult.provider,
      model: llmResult.model,
      envelope: args.envelope,
      rawResponse: llmResult.rawText,
      parsedResponse: null,
      errorMessage: parsed.error.message.slice(0, 2000),
      durationMs: Date.now() - startedAt,
      promptTokens: llmResult.promptTokens,
      completionTokens: llmResult.completionTokens,
      costUsd: llmResult.costUsd,
      createdAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
    });
    return { ok: false, reason: 'parse_failed', invocationId: id, errorMessage: parsed.error.message };
  }

  await persist(store, {
    id,
    operationId: args.operationId,
    ownerId: args.ownerId,
    state: args.state,
    kind: args.kind,
    status: 'succeeded',
    provider: llmResult.provider,
    model: llmResult.model,
    envelope: args.envelope,
    rawResponse: llmResult.rawText,
    parsedResponse: parsed.data,
    errorMessage: null,
    durationMs: Date.now() - startedAt,
    promptTokens: llmResult.promptTokens,
    completionTokens: llmResult.completionTokens,
    costUsd: llmResult.costUsd,
    createdAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
  });

  return { ok: true, data: parsed.data, invocationId: id };
}

async function persist(
  store: InvocationStore,
  raw: {
    id: string;
    operationId: string | null;
    ownerId: string;
    state: AgentState;
    kind: AgentInvocationKind;
    status: 'succeeded' | 'failed_parse' | 'failed_provider' | 'fallback_template' | 'rejected_validation';
    provider: AgentProvider;
    model: string;
    envelope: ContextEnvelope;
    rawResponse: string | null;
    parsedResponse: unknown;
    errorMessage: string | null;
    durationMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    costUsd: number | null;
    createdAt: string;
    completedAt: string;
  },
): Promise<void> {
  // Compute cost from token counts when the provider didn't tell us upfront.
  if (raw.costUsd === null && raw.promptTokens !== null && raw.completionTokens !== null) {
    const breakdown = estimateCost({
      model: raw.model,
      promptTokens: raw.promptTokens,
      completionTokens: raw.completionTokens,
    });
    raw.costUsd = breakdown.totalUsd;
  }
  const safe = AgentInvocation.parse(raw);
  await store.insert({
    ...safe,
    envelope: redactPiiObject(safe.envelope),
    rawResponse: safe.rawResponse ? safe.rawResponse.slice(0, 200_000) : null,
  });
}

function redactErr(err: unknown): string {
  return String(err).slice(0, 500);
}
