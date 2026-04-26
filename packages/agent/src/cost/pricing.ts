// Per-1K-token prices in USD for every model Argo can call. Source: provider
// pricing pages as of 2026-04. Update quarterly. The model router calls
// estimateCost() after every completion so the billing layer can debit
// the operation's monthly budget.

export interface ModelPricing {
  /** Dollars per 1,000 input tokens. */
  inputPer1K: number;
  /** Dollars per 1,000 output tokens. */
  outputPer1K: number;
  /** Optional cached-input rate (Anthropic + OpenAI both offer this). */
  cachedInputPer1K?: number;
  /** Provider-side context window in tokens. */
  contextWindow: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI (2026-04 estimates; gpt-5.5 marked PREVIEW until announcement).
  'gpt-5.5': { inputPer1K: 0.005, outputPer1K: 0.02, contextWindow: 256_000 },
  'gpt-4o': { inputPer1K: 0.0025, outputPer1K: 0.01, cachedInputPer1K: 0.00125, contextWindow: 128_000 },
  'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006, contextWindow: 128_000 },
  'o1': { inputPer1K: 0.015, outputPer1K: 0.06, contextWindow: 200_000 },
  'o1-mini': { inputPer1K: 0.003, outputPer1K: 0.012, contextWindow: 128_000 },
  'o3-mini': { inputPer1K: 0.0011, outputPer1K: 0.0044, contextWindow: 200_000 },

  // Anthropic
  'claude-opus-4-7': { inputPer1K: 0.015, outputPer1K: 0.075, cachedInputPer1K: 0.0015, contextWindow: 1_000_000 },
  'claude-sonnet-4-6': { inputPer1K: 0.003, outputPer1K: 0.015, cachedInputPer1K: 0.0003, contextWindow: 1_000_000 },
  'claude-sonnet-4-5': { inputPer1K: 0.003, outputPer1K: 0.015, contextWindow: 1_000_000 },
  'claude-sonnet-4-20250514': { inputPer1K: 0.003, outputPer1K: 0.015, contextWindow: 200_000 },
  'claude-haiku-4-5-20251001': { inputPer1K: 0.0008, outputPer1K: 0.004, contextWindow: 200_000 },

  // Emergent proxy — pass-through to whatever model it routed to. We
  // optimistically charge the Sonnet rate; the actual bill arrives via
  // their reconciliation webhook (TODO).
  'emergent-default': { inputPer1K: 0.003, outputPer1K: 0.015, contextWindow: 200_000 },
};

export interface CostBreakdown {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  inputUsd: number;
  outputUsd: number;
  cachedUsd: number;
  totalUsd: number;
}

export function estimateCost(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}): CostBreakdown {
  const pricing = MODEL_PRICING[args.model] ?? MODEL_PRICING['emergent-default']!;
  const cached = args.cachedTokens ?? 0;
  const billablePrompt = Math.max(0, args.promptTokens - cached);
  const inputUsd = (billablePrompt / 1000) * pricing.inputPer1K;
  const outputUsd = (args.completionTokens / 1000) * pricing.outputPer1K;
  const cachedUsd = (cached / 1000) * (pricing.cachedInputPer1K ?? pricing.inputPer1K);
  return {
    model: args.model,
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
    cachedTokens: cached,
    inputUsd,
    outputUsd,
    cachedUsd,
    totalUsd: inputUsd + outputUsd + cachedUsd,
  };
}

/**
 * Aggregate a pile of breakdowns. Used by the billing dashboard and the
 * monthly $30 budget alarm.
 */
export function sumCosts(breakdowns: readonly CostBreakdown[]): CostBreakdown {
  const out: CostBreakdown = {
    model: 'aggregate',
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    inputUsd: 0,
    outputUsd: 0,
    cachedUsd: 0,
    totalUsd: 0,
  };
  for (const b of breakdowns) {
    out.promptTokens += b.promptTokens;
    out.completionTokens += b.completionTokens;
    out.cachedTokens += b.cachedTokens;
    out.inputUsd += b.inputUsd;
    out.outputUsd += b.outputUsd;
    out.cachedUsd += b.cachedUsd;
    out.totalUsd += b.totalUsd;
  }
  return out;
}

/**
 * Argo's hard margin promise (master prompt §14): if a single operation
 * costs >$30/month in LLM + Blaxel compute, that's a margin problem we fix
 * on our side, not by passing complexity to Maya.
 */
export const MONTHLY_OPERATION_BUDGET_USD = 30;

export function isOverBudget(monthSpend: number): boolean {
  return monthSpend >= MONTHLY_OPERATION_BUDGET_USD;
}
