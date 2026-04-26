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
