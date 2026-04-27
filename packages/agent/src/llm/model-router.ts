// Per-task model router.
//
// Different sub-agents in Argo's multi-agent build benefit from different
// models. The architect needs strong planning + JSON-mode reliability —
// gpt-5.5 or claude-opus-4-7. The reviewer needs structured judgment +
// fast turnaround — gpt-4o is enough. Classifier-style sub-tasks
// (intent extraction, propose-name, brief refinement) are over-served
// by gpt-5.5 — gpt-4o-mini or haiku are 50× cheaper at equal quality
// for short-output structured calls.
//
// Cursor 2.0 routes per-agent. Argo does the same with this module.
//
// Override via env: ARGO_MODEL_ARCHITECT, ARGO_MODEL_BUILDER,
// ARGO_MODEL_REVIEWER, ARGO_MODEL_CLASSIFIER, ARGO_MODEL_CHEAP.

export type ModelRole =
  | 'architect'    // structured FilePlan synthesis
  | 'builder'      // code generation; the heavy hitter
  | 'reviewer'    // bundle review + structured findings
  | 'classifier'  // short-output structured calls (naming, intent, refinement)
  | 'cheap'       // anything else that's small + cheap (eval judges, etc.)
  | 'default';

interface RoleSpec {
  primary: string;
  fallback: string;
  /** Soft cap on output tokens. The wrapper rejects requests above this. */
  maxOutputTokens: number;
}

const FALLBACKS = {
  GPT_PRIMARY: 'gpt-5.5',
  GPT_STRONG: 'gpt-4o',
  GPT_FAST: 'gpt-4o-mini',
  CLAUDE_STRONG: 'claude-opus-4-7',
  CLAUDE_FAST: 'claude-haiku-4-5-20251001',
};

const DEFAULT_ROUTING: Record<ModelRole, RoleSpec> = {
  // Architect: produces a strict-schema JSON plan. JSON-mode reliability
  // matters more than speed; gpt-5.5 + gpt-4o pairing.
  architect: {
    primary: process.env.ARGO_MODEL_ARCHITECT ?? FALLBACKS.GPT_PRIMARY,
    fallback: FALLBACKS.GPT_STRONG,
    maxOutputTokens: 4000,
  },
  // Builder: streams 25-60 files of code. Use the strongest model the
  // operator's account has access to; we need raw code-gen quality.
  builder: {
    primary: process.env.ARGO_MODEL_BUILDER ?? FALLBACKS.GPT_PRIMARY,
    fallback: FALLBACKS.GPT_STRONG,
    maxOutputTokens: 12_000,
  },
  // Reviewer: short structured judgment. gpt-4o is plenty.
  reviewer: {
    primary: process.env.ARGO_MODEL_REVIEWER ?? FALLBACKS.GPT_STRONG,
    fallback: FALLBACKS.GPT_FAST,
    maxOutputTokens: 3000,
  },
  // Classifier: 100-400 token outputs (questionnaire mint, name propose,
  // intent classify, refinement decisions). gpt-4o-mini is 50× cheaper
  // than gpt-5.5 at near-identical quality on these tasks.
  classifier: {
    primary: process.env.ARGO_MODEL_CLASSIFIER ?? FALLBACKS.GPT_FAST,
    fallback: FALLBACKS.GPT_STRONG,
    maxOutputTokens: 1500,
  },
  // Cheap: judges, simple structured calls, anything where quality
  // sensitivity is low.
  cheap: {
    primary: process.env.ARGO_MODEL_CHEAP ?? FALLBACKS.GPT_FAST,
    fallback: FALLBACKS.CLAUDE_FAST,
    maxOutputTokens: 1000,
  },
  default: {
    primary: process.env.OPENAI_MODEL_PRIMARY ?? FALLBACKS.GPT_PRIMARY,
    fallback: process.env.OPENAI_MODEL_FALLBACK ?? FALLBACKS.GPT_STRONG,
    maxOutputTokens: 4000,
  },
};

export interface ModelRouting {
  role: ModelRole;
  primary: string;
  fallback: string;
  candidates: string[];
  maxOutputTokens: number;
}

/**
 * Resolve the primary + fallback model for a given role. Uses env
 * overrides if set; otherwise uses sensible defaults documented above.
 *
 * The returned candidates list is deduped — if primary and fallback are
 * the same model (because the operator overrode primary to gpt-4o), we
 * don't try it twice.
 */
export function routeModel(role: ModelRole, overrides: { primary?: string; fallback?: string } = {}): ModelRouting {
  const spec = DEFAULT_ROUTING[role] ?? DEFAULT_ROUTING.default;
  const primary = overrides.primary ?? spec.primary;
  const fallback = overrides.fallback ?? spec.fallback;
  const candidates: string[] = [];
  for (const m of [primary, fallback]) {
    if (m && !candidates.includes(m)) candidates.push(m);
  }
  return { role, primary, fallback, candidates, maxOutputTokens: spec.maxOutputTokens };
}

/**
 * For tests + tooling: the full default routing table.
 */
export function getDefaultRouting(): Record<ModelRole, RoleSpec> {
  return { ...DEFAULT_ROUTING };
}

/**
 * Estimate the relative cost of a routing decision in arbitrary units
 * (where gpt-5.5 = 1.0). Useful for the cost ledger to flag spend
 * outliers without re-running estimateCost on every call.
 *
 * Rough mapping:
 *   gpt-5.5         = 1.0
 *   claude-opus-4-7 = 3.0
 *   gpt-4o          = 0.5
 *   claude-sonnet   = 0.6
 *   gpt-4o-mini     = 0.03
 *   claude-haiku    = 0.16
 */
export function relativeCostFactor(model: string): number {
  if (model.includes('gpt-5.5')) return 1.0;
  if (model.includes('opus')) return 3.0;
  if (model.includes('gpt-4o-mini')) return 0.03;
  if (model.includes('gpt-4o')) return 0.5;
  if (model.includes('haiku')) return 0.16;
  if (model.includes('sonnet')) return 0.6;
  return 1.0;
}
