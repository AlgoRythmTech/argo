// Per-task model router.
//
// Different sub-agents in Argo's multi-agent build benefit from different
// models. The architect needs strong planning + JSON-mode reliability —
// gpt-5.5 or claude-opus-4-6. The reviewer needs structured judgment +
// fast turnaround — gpt-4o is enough. Classifier-style sub-tasks
// (intent extraction, propose-name, brief refinement) are over-served
// by gpt-5.5 — gpt-4o-mini or haiku are 50× cheaper at equal quality
// for short-output structured calls.
//
// Cursor 2.0 routes per-agent. Argo does the same with this module.
//
// Override via env: ARGO_MODEL_ARCHITECT, ARGO_MODEL_BUILDER,
// ARGO_MODEL_REVIEWER, ARGO_MODEL_CLASSIFIER, ARGO_MODEL_CHEAP.
//
// Provider routing:
//   PROVIDER_PREFERENCE = 'openai' | 'anthropic' | 'auto' (default: 'openai')
//   - 'openai'    — all roles default to OpenAI models.
//   - 'anthropic' — all roles default to Anthropic models.
//   - 'auto'      — complex roles (architect, builder, repair) use Anthropic;
//                    simpler roles (reviewer, classifier, cheap) use OpenAI.
//   Cross-provider fallback: if the primary provider fails, the other is tried.

export type ProviderPreference = 'openai' | 'anthropic' | 'auto';

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
  CLAUDE_PRIMARY: process.env.ANTHROPIC_MODEL_PRIMARY ?? 'claude-sonnet-4-6',
  CLAUDE_STRONG: 'claude-opus-4-6',
  CLAUDE_FAST: process.env.ANTHROPIC_MODEL_FALLBACK ?? 'claude-haiku-4-5-20251001',
};

/** Roles considered "complex" for auto-mode provider selection. */
const COMPLEX_ROLES: ReadonlySet<string> = new Set(['architect', 'builder']);

/**
 * Read the operator's provider preference. Validated at call-time so env
 * changes take effect without a restart.
 */
export function getProviderPreference(): ProviderPreference {
  const raw = (process.env.PROVIDER_PREFERENCE ?? 'openai').toLowerCase();
  if (raw === 'anthropic' || raw === 'auto') return raw;
  return 'openai';
}

/**
 * Return true when the given role should use Anthropic as primary under
 * the current PROVIDER_PREFERENCE setting.
 */
export function shouldUseAnthropic(role: ModelRole): boolean {
  const pref = getProviderPreference();
  if (pref === 'anthropic') return true;
  if (pref === 'auto') return COMPLEX_ROLES.has(role);
  return false;
}

/**
 * Build the default routing table at call-time (reads env each time).
 * When the provider preference is 'anthropic' or 'auto', the primary
 * models for relevant roles shift to Anthropic equivalents.
 */
function buildDefaultRouting(): Record<ModelRole, RoleSpec> {
  const useAnthropicFor = (role: ModelRole) => shouldUseAnthropic(role);

  return {
    architect: {
      primary: process.env.ARGO_MODEL_ARCHITECT ??
        (useAnthropicFor('architect') ? FALLBACKS.CLAUDE_STRONG : FALLBACKS.GPT_PRIMARY),
      fallback: useAnthropicFor('architect') ? FALLBACKS.GPT_STRONG : FALLBACKS.CLAUDE_STRONG,
      maxOutputTokens: 4000,
    },
    builder: {
      primary: process.env.ARGO_MODEL_BUILDER ??
        (useAnthropicFor('builder') ? FALLBACKS.CLAUDE_STRONG : FALLBACKS.GPT_PRIMARY),
      fallback: useAnthropicFor('builder') ? FALLBACKS.GPT_STRONG : FALLBACKS.CLAUDE_STRONG,
      maxOutputTokens: 12_000,
    },
    reviewer: {
      primary: process.env.ARGO_MODEL_REVIEWER ??
        (useAnthropicFor('reviewer') ? FALLBACKS.CLAUDE_PRIMARY : FALLBACKS.GPT_STRONG),
      fallback: useAnthropicFor('reviewer') ? FALLBACKS.GPT_FAST : FALLBACKS.CLAUDE_FAST,
      maxOutputTokens: 3000,
    },
    classifier: {
      primary: process.env.ARGO_MODEL_CLASSIFIER ??
        (useAnthropicFor('classifier') ? FALLBACKS.CLAUDE_FAST : FALLBACKS.GPT_FAST),
      fallback: useAnthropicFor('classifier') ? FALLBACKS.GPT_FAST : FALLBACKS.CLAUDE_FAST,
      maxOutputTokens: 1500,
    },
    cheap: {
      primary: process.env.ARGO_MODEL_CHEAP ??
        (useAnthropicFor('cheap') ? FALLBACKS.CLAUDE_FAST : FALLBACKS.GPT_FAST),
      fallback: useAnthropicFor('cheap') ? FALLBACKS.GPT_FAST : FALLBACKS.CLAUDE_FAST,
      maxOutputTokens: 1000,
    },
    default: {
      primary: process.env.OPENAI_MODEL_PRIMARY ??
        (getProviderPreference() === 'anthropic' ? FALLBACKS.CLAUDE_PRIMARY : FALLBACKS.GPT_PRIMARY),
      fallback: process.env.OPENAI_MODEL_FALLBACK ??
        (getProviderPreference() === 'anthropic' ? FALLBACKS.CLAUDE_FAST : FALLBACKS.GPT_STRONG),
      maxOutputTokens: 4000,
    },
  };
}

export interface ModelRouting {
  role: ModelRole;
  primary: string;
  fallback: string;
  candidates: string[];
  maxOutputTokens: number;
}

/**
 * Detect which provider a model string belongs to.
 */
export function detectProvider(model: string): 'openai' | 'anthropic' {
  if (model.includes('claude') || model.includes('haiku') || model.includes('sonnet') || model.includes('opus')) {
    return 'anthropic';
  }
  return 'openai';
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
  const routing = buildDefaultRouting();
  const spec = routing[role] ?? routing.default;
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
  return { ...buildDefaultRouting() };
}

/**
 * Estimate the relative cost of a routing decision in arbitrary units
 * (where gpt-5.5 = 1.0). Useful for the cost ledger to flag spend
 * outliers without re-running estimateCost on every call.
 *
 * Rough mapping:
 *   gpt-5.5             = 1.0
 *   claude-opus-4-6     = 3.0
 *   claude-opus-4-7     = 3.0
 *   gpt-4o              = 0.5
 *   claude-sonnet-4-6   = 0.6
 *   gpt-4o-mini         = 0.03
 *   claude-haiku         = 0.16
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
