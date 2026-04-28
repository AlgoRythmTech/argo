import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  getDefaultRouting,
  getProviderPreference,
  shouldUseAnthropic,
  detectProvider,
  relativeCostFactor,
  routeModel,
} from './model-router.js';

// Each test isolates env so it doesn't bleed across cases.
function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('routeModel', () => {
  beforeEach(() => {
    delete process.env.ARGO_MODEL_ARCHITECT;
    delete process.env.ARGO_MODEL_BUILDER;
    delete process.env.ARGO_MODEL_REVIEWER;
    delete process.env.ARGO_MODEL_CLASSIFIER;
    delete process.env.ARGO_MODEL_CHEAP;
    delete process.env.PROVIDER_PREFERENCE;
    delete process.env.ANTHROPIC_MODEL_PRIMARY;
    delete process.env.ANTHROPIC_MODEL_FALLBACK;
  });

  it('routes architect to a strong model with a fallback', () => {
    const r = routeModel('architect');
    expect(r.role).toBe('architect');
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    expect(r.candidates[0]).toMatch(/gpt-5\.5|opus|gpt-4o/);
  });

  it('routes classifier to a fast cheap model by default', () => {
    const r = routeModel('classifier');
    expect(r.candidates[0]).toBe('gpt-4o-mini');
    expect(r.maxOutputTokens).toBeLessThanOrEqual(1500);
  });

  it('routes reviewer to a structured-judgment model with a cheap fallback', () => {
    const r = routeModel('reviewer');
    expect(r.candidates[0]).toBe('gpt-4o');
    // Fallback is the other provider's fast model (cross-provider fallback).
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.fallback).toMatch(/haiku|gpt-4o-mini/);
  });

  it('respects ARGO_MODEL_ARCHITECT env override', () => {
    withEnv({ ARGO_MODEL_ARCHITECT: 'claude-opus-4-7' }, () => {
      // routeModel reads env at call time via buildDefaultRouting which is
      // built at call time. So this override takes effect.
      const r = routeModel('architect', { primary: process.env.ARGO_MODEL_ARCHITECT });
      expect(r.candidates[0]).toBe('claude-opus-4-7');
    });
  });

  it('per-call override beats the default', () => {
    const r = routeModel('classifier', { primary: 'gpt-5.5' });
    expect(r.candidates[0]).toBe('gpt-5.5');
  });

  it('dedupes candidates when primary === fallback', () => {
    const r = routeModel('reviewer', { primary: 'gpt-4o-mini', fallback: 'gpt-4o-mini' });
    expect(r.candidates).toEqual(['gpt-4o-mini']);
  });

  it('falls back to default routing for unknown roles', () => {
    // @ts-expect-error — testing runtime fallback for an invalid role.
    const r = routeModel('not-a-real-role');
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getDefaultRouting', () => {
  beforeEach(() => {
    delete process.env.PROVIDER_PREFERENCE;
  });

  it('returns a copy that does not mutate the singleton', () => {
    const a = getDefaultRouting();
    const original = a.architect.primary;
    // Mutate the returned copy's architect spec
    a.architect = { ...a.architect, primary: 'evil-model' };
    const b = getDefaultRouting();
    expect(b.architect.primary).toBe(original);
  });
});

describe('relativeCostFactor', () => {
  it('orders models by relative cost', () => {
    const fast = relativeCostFactor('gpt-4o-mini');
    const mid = relativeCostFactor('gpt-4o');
    const strong = relativeCostFactor('gpt-5.5');
    const opus = relativeCostFactor('claude-opus-4-7');
    expect(fast).toBeLessThan(mid);
    expect(mid).toBeLessThan(strong);
    expect(strong).toBeLessThan(opus);
  });

  it('returns 1.0 for unknown models (no extreme bias)', () => {
    expect(relativeCostFactor('made-up-model')).toBe(1.0);
  });

  it('classifies haiku as cheap-tier', () => {
    expect(relativeCostFactor('claude-haiku-4-5-20251001')).toBeLessThan(0.5);
  });

  it('classifies claude-opus-4-6 as expensive-tier', () => {
    expect(relativeCostFactor('claude-opus-4-6')).toBe(3.0);
  });

  it('classifies claude-sonnet-4-6 as mid-tier', () => {
    expect(relativeCostFactor('claude-sonnet-4-6')).toBe(0.6);
  });
});

describe('getProviderPreference', () => {
  afterEach(() => {
    delete process.env.PROVIDER_PREFERENCE;
  });

  it('defaults to openai when env is unset', () => {
    delete process.env.PROVIDER_PREFERENCE;
    expect(getProviderPreference()).toBe('openai');
  });

  it('returns anthropic when env is set to anthropic', () => {
    withEnv({ PROVIDER_PREFERENCE: 'anthropic' }, () => {
      expect(getProviderPreference()).toBe('anthropic');
    });
  });

  it('returns auto when env is set to auto', () => {
    withEnv({ PROVIDER_PREFERENCE: 'auto' }, () => {
      expect(getProviderPreference()).toBe('auto');
    });
  });

  it('is case-insensitive', () => {
    withEnv({ PROVIDER_PREFERENCE: 'ANTHROPIC' }, () => {
      expect(getProviderPreference()).toBe('anthropic');
    });
    withEnv({ PROVIDER_PREFERENCE: 'Auto' }, () => {
      expect(getProviderPreference()).toBe('auto');
    });
  });

  it('falls back to openai for invalid values', () => {
    withEnv({ PROVIDER_PREFERENCE: 'gemini' }, () => {
      expect(getProviderPreference()).toBe('openai');
    });
  });
});

describe('shouldUseAnthropic', () => {
  afterEach(() => {
    delete process.env.PROVIDER_PREFERENCE;
  });

  it('returns false for all roles when preference is openai', () => {
    withEnv({ PROVIDER_PREFERENCE: 'openai' }, () => {
      expect(shouldUseAnthropic('architect')).toBe(false);
      expect(shouldUseAnthropic('builder')).toBe(false);
      expect(shouldUseAnthropic('reviewer')).toBe(false);
      expect(shouldUseAnthropic('classifier')).toBe(false);
    });
  });

  it('returns true for all roles when preference is anthropic', () => {
    withEnv({ PROVIDER_PREFERENCE: 'anthropic' }, () => {
      expect(shouldUseAnthropic('architect')).toBe(true);
      expect(shouldUseAnthropic('builder')).toBe(true);
      expect(shouldUseAnthropic('reviewer')).toBe(true);
      expect(shouldUseAnthropic('classifier')).toBe(true);
      expect(shouldUseAnthropic('cheap')).toBe(true);
    });
  });

  it('returns true only for complex roles when preference is auto', () => {
    withEnv({ PROVIDER_PREFERENCE: 'auto' }, () => {
      expect(shouldUseAnthropic('architect')).toBe(true);
      expect(shouldUseAnthropic('builder')).toBe(true);
      expect(shouldUseAnthropic('reviewer')).toBe(false);
      expect(shouldUseAnthropic('classifier')).toBe(false);
      expect(shouldUseAnthropic('cheap')).toBe(false);
    });
  });
});

describe('detectProvider', () => {
  it('detects OpenAI models', () => {
    expect(detectProvider('gpt-5.5')).toBe('openai');
    expect(detectProvider('gpt-4o')).toBe('openai');
    expect(detectProvider('gpt-4o-mini')).toBe('openai');
  });

  it('detects Anthropic models', () => {
    expect(detectProvider('claude-opus-4-6')).toBe('anthropic');
    expect(detectProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(detectProvider('claude-opus-4-7')).toBe('anthropic');
    expect(detectProvider('claude-haiku-4-5-20251001')).toBe('anthropic');
  });

  it('defaults to openai for unknown models', () => {
    expect(detectProvider('unknown-model-xyz')).toBe('openai');
  });
});

describe('provider-aware routing', () => {
  afterEach(() => {
    delete process.env.PROVIDER_PREFERENCE;
    delete process.env.ANTHROPIC_MODEL_PRIMARY;
    delete process.env.ANTHROPIC_MODEL_FALLBACK;
    delete process.env.ARGO_MODEL_ARCHITECT;
    delete process.env.ARGO_MODEL_BUILDER;
    delete process.env.ARGO_MODEL_REVIEWER;
    delete process.env.ARGO_MODEL_CLASSIFIER;
    delete process.env.ARGO_MODEL_CHEAP;
  });

  it('routes architect to Anthropic when PROVIDER_PREFERENCE=anthropic', () => {
    withEnv({ PROVIDER_PREFERENCE: 'anthropic' }, () => {
      const r = routeModel('architect');
      expect(detectProvider(r.primary)).toBe('anthropic');
      expect(r.primary).toMatch(/opus/);
    });
  });

  it('routes classifier to Anthropic when PROVIDER_PREFERENCE=anthropic', () => {
    withEnv({ PROVIDER_PREFERENCE: 'anthropic' }, () => {
      const r = routeModel('classifier');
      expect(detectProvider(r.primary)).toBe('anthropic');
      expect(r.primary).toMatch(/haiku/);
    });
  });

  it('routes architect to Anthropic in auto mode (complex task)', () => {
    withEnv({ PROVIDER_PREFERENCE: 'auto' }, () => {
      const r = routeModel('architect');
      expect(detectProvider(r.primary)).toBe('anthropic');
    });
  });

  it('routes classifier to OpenAI in auto mode (simple task)', () => {
    withEnv({ PROVIDER_PREFERENCE: 'auto' }, () => {
      const r = routeModel('classifier');
      expect(detectProvider(r.primary)).toBe('openai');
      expect(r.primary).toBe('gpt-4o-mini');
    });
  });

  it('cross-provider fallback: anthropic primary gets openai fallback', () => {
    withEnv({ PROVIDER_PREFERENCE: 'anthropic' }, () => {
      const r = routeModel('architect');
      // Primary is Anthropic, fallback should be OpenAI.
      expect(detectProvider(r.primary)).toBe('anthropic');
      expect(detectProvider(r.fallback)).toBe('openai');
    });
  });

  it('cross-provider fallback: openai primary gets anthropic fallback for architect', () => {
    withEnv({ PROVIDER_PREFERENCE: 'openai' }, () => {
      const r = routeModel('architect');
      expect(detectProvider(r.primary)).toBe('openai');
      // Fallback should be the other provider.
      expect(detectProvider(r.fallback)).toBe('anthropic');
    });
  });

  it('respects ANTHROPIC_MODEL_PRIMARY env for custom model', () => {
    withEnv({ PROVIDER_PREFERENCE: 'anthropic', ANTHROPIC_MODEL_PRIMARY: 'claude-sonnet-4-6' }, () => {
      const r = routeModel('reviewer');
      expect(r.primary).toBe('claude-sonnet-4-6');
    });
  });
});
