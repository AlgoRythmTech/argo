import { describe, expect, it } from 'vitest';
import {
  estimateCost,
  isOverBudget,
  MODEL_PRICING,
  MONTHLY_OPERATION_BUDGET_USD,
  sumCosts,
} from './pricing.js';

describe('estimateCost', () => {
  it('charges gpt-4o input + output correctly', () => {
    const cost = estimateCost({
      model: 'gpt-4o',
      promptTokens: 1000,
      completionTokens: 500,
    });
    expect(cost.inputUsd).toBeCloseTo(0.0025, 6);
    expect(cost.outputUsd).toBeCloseTo(0.005, 6);
    expect(cost.totalUsd).toBeCloseTo(0.0075, 6);
  });

  it('discounts cached input tokens for Anthropic', () => {
    const cost = estimateCost({
      model: 'claude-opus-4-7',
      promptTokens: 1000,
      completionTokens: 1000,
      cachedTokens: 500,
    });
    // 500 billable input @ 0.015 + 500 cached @ 0.0015 + 1000 output @ 0.075
    expect(cost.inputUsd).toBeCloseTo((500 / 1000) * 0.015, 6);
    expect(cost.cachedUsd).toBeCloseTo((500 / 1000) * 0.0015, 6);
    expect(cost.outputUsd).toBeCloseTo((1000 / 1000) * 0.075, 6);
  });

  it('falls back to emergent-default for unknown models', () => {
    const cost = estimateCost({
      model: 'an-unknown-model',
      promptTokens: 1000,
      completionTokens: 500,
    });
    const expected =
      (1000 / 1000) * MODEL_PRICING['emergent-default']!.inputPer1K +
      (500 / 1000) * MODEL_PRICING['emergent-default']!.outputPer1K;
    expect(cost.totalUsd).toBeCloseTo(expected, 6);
  });
});

describe('sumCosts', () => {
  it('aggregates costs across many invocations', () => {
    const a = estimateCost({ model: 'gpt-4o', promptTokens: 100, completionTokens: 50 });
    const b = estimateCost({ model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 500 });
    const total = sumCosts([a, b]);
    expect(total.totalUsd).toBeCloseTo(a.totalUsd + b.totalUsd, 6);
    expect(total.promptTokens).toBe(1100);
    expect(total.completionTokens).toBe(550);
  });
});

describe('isOverBudget', () => {
  it('respects the $30 ceiling from master prompt §14', () => {
    expect(MONTHLY_OPERATION_BUDGET_USD).toBe(30);
    expect(isOverBudget(29.99)).toBe(false);
    expect(isOverBudget(30)).toBe(true);
    expect(isOverBudget(45.5)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// $30/op-month budget sanity tests.
//
// The master prompt promises $30/operation/month for LLM spend. These
// tests lock in that promise by computing realistic-shape build / repair
// / digest costs and asserting we stay well under the ceiling. If a
// pricing change breaks them, we hear about it BEFORE a customer does.
// ──────────────────────────────────────────────────────────────────────

describe('$30 monthly operation budget — scenario costs', () => {
  it('a single gpt-5.5 build costs the right shape (5K in, 8K out)', () => {
    const cost = estimateCost({
      model: 'gpt-5.5',
      promptTokens: 5000,
      completionTokens: 8000,
    });
    // 5 * 0.005 input + 8 * 0.02 output = 0.025 + 0.16 = $0.185
    expect(cost.inputUsd).toBeCloseTo(0.025, 6);
    expect(cost.outputUsd).toBeCloseTo(0.16, 6);
    expect(cost.totalUsd).toBeCloseTo(0.185, 6);
    expect(cost.totalUsd).toBeLessThan(0.5);
  });

  it('worst-case 3-cycle auto-fix loop stays under $1', () => {
    // Cycle 1: 5K in / 8K out (initial generation)
    // Cycle 2: 7K in (priors + errors) / 8K out (regen)
    // Cycle 3: 8K in / 8K out (final regen)
    const cycles = [
      estimateCost({ model: 'gpt-5.5', promptTokens: 5000, completionTokens: 8000 }),
      estimateCost({ model: 'gpt-5.5', promptTokens: 7000, completionTokens: 8000 }),
      estimateCost({ model: 'gpt-5.5', promptTokens: 8000, completionTokens: 8000 }),
    ];
    const total = sumCosts(cycles);
    expect(total.totalUsd).toBeLessThan(1.0);
    // And, more importantly, comfortably under the budget on its own.
    expect(total.totalUsd).toBeLessThan(MONTHLY_OPERATION_BUDGET_USD / 30);
  });

  it('a typical repair invocation (claude opus, 2K in, 3K out) stays under $0.30', () => {
    const cost = estimateCost({
      model: 'claude-opus-4-7',
      promptTokens: 2000,
      completionTokens: 3000,
    });
    // 2 * 0.015 + 3 * 0.075 = 0.03 + 0.225 = $0.255
    expect(cost.totalUsd).toBeCloseTo(0.255, 5);
    expect(cost.totalUsd).toBeLessThan(0.3);
  });

  it('a Monday digest (gpt-4o, 2K in, 1K out) stays under $0.02', () => {
    const cost = estimateCost({
      model: 'gpt-4o',
      promptTokens: 2000,
      completionTokens: 1000,
    });
    // 2 * 0.0025 + 1 * 0.01 = 0.005 + 0.01 = $0.015
    expect(cost.totalUsd).toBeCloseTo(0.015, 6);
    expect(cost.totalUsd).toBeLessThan(0.02);
  });

  it('a typical month-mix lands well under the $30 ceiling', () => {
    // Month-shape we model:
    //   - 4 builds (gpt-5.5, with auto-fix avg = ~2 cycles)
    //   - 30 repair invocations (claude-opus, 2K/3K each)
    //   - 4 weekly digests (gpt-4o, 2K/1K each)
    //   - 200 inbound classifications (gpt-4o-mini, 800/200 each)
    const builds = Array.from({ length: 4 * 2 }, () =>
      estimateCost({ model: 'gpt-5.5', promptTokens: 6000, completionTokens: 8000 }),
    );
    const repairs = Array.from({ length: 30 }, () =>
      estimateCost({ model: 'claude-opus-4-7', promptTokens: 2000, completionTokens: 3000 }),
    );
    const digests = Array.from({ length: 4 }, () =>
      estimateCost({ model: 'gpt-4o', promptTokens: 2000, completionTokens: 1000 }),
    );
    const classifications = Array.from({ length: 200 }, () =>
      estimateCost({ model: 'gpt-4o-mini', promptTokens: 800, completionTokens: 200 }),
    );
    const total = sumCosts([...builds, ...repairs, ...digests, ...classifications]);
    expect(total.totalUsd).toBeLessThan(MONTHLY_OPERATION_BUDGET_USD);
    // Headroom check: we want the typical month to leave at least $5
    // of margin so a busy operator doesn't bump the ceiling.
    expect(total.totalUsd).toBeLessThan(MONTHLY_OPERATION_BUDGET_USD - 5);
  });

  it('cached input is cheaper than billable input on every cache-supporting model', () => {
    for (const [name, m] of Object.entries(MODEL_PRICING)) {
      if (m.cachedInputPer1K == null) continue;
      expect(m.cachedInputPer1K, `${name} cached must be cheaper than uncached`).toBeLessThan(
        m.inputPer1K,
      );
    }
  });
});

describe('estimateCost edge cases', () => {
  it('handles cachedTokens > promptTokens by clamping billable to zero (no negative cost)', () => {
    const cost = estimateCost({
      model: 'claude-opus-4-7',
      promptTokens: 100,
      completionTokens: 100,
      cachedTokens: 500, // pathological — cache claims more than total.
    });
    expect(cost.inputUsd).toBeGreaterThanOrEqual(0);
    expect(cost.totalUsd).toBeGreaterThanOrEqual(cost.outputUsd);
  });

  it('zero tokens in and out yields zero cost', () => {
    const cost = estimateCost({
      model: 'gpt-5.5',
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(cost.totalUsd).toBe(0);
    expect(cost.inputUsd).toBe(0);
    expect(cost.outputUsd).toBe(0);
  });

  it('all known models have positive prices', () => {
    for (const [name, m] of Object.entries(MODEL_PRICING)) {
      expect(m.inputPer1K, `${name} input must be positive`).toBeGreaterThan(0);
      expect(m.outputPer1K, `${name} output must be positive`).toBeGreaterThan(0);
      expect(m.contextWindow, `${name} context window must be positive`).toBeGreaterThan(0);
    }
  });

  it('output is always more expensive than input for every model', () => {
    for (const [name, m] of Object.entries(MODEL_PRICING)) {
      expect(m.outputPer1K, `${name}: output should cost more than input`).toBeGreaterThan(
        m.inputPer1K,
      );
    }
  });
});
