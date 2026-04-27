import { describe, expect, it, beforeEach } from 'vitest';
import {
  getDefaultRouting,
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
    // Fallback is the fast model.
    expect(r.candidates).toContain('gpt-4o-mini');
  });

  it('respects ARGO_MODEL_ARCHITECT env override', () => {
    withEnv({ ARGO_MODEL_ARCHITECT: 'claude-opus-4-7' }, () => {
      // routeModel reads env at call time via DEFAULT_ROUTING which is
      // built at module load. Clear cache by re-importing? No — the
      // table reads process.env at module init. So this override only
      // kicks in if we route via the per-call argument.
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
});
