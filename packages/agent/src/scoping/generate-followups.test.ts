// Schema-shape tests for the multi-round scoping refinement parser.
// We don't hit the network here — these tests pin down what the LLM is
// allowed to return so a future "the model returned weird JSON"
// regression fails loudly inside the test suite, not in production.

import { describe, expect, it } from 'vitest';
import { RefinementResponse } from './generate-followups.js';

describe('RefinementResponse', () => {
  it('parses a zero-question response (brief is already crisp)', () => {
    const ok = RefinementResponse.safeParse({
      questions: [],
      refinementSummary: 'No refinement needed — every brief field is concrete.',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.questions).toHaveLength(0);
    }
  });

  it('parses a one-question follow-up with a rationale', () => {
    const ok = RefinementResponse.safeParse({
      questions: [
        {
          id: 'compliance-pii',
          kind: 'single_choice',
          briefField: 'compliance_notes',
          prompt: 'Are any of these fields personal identifiers (PII)?',
          options: [
            { id: 'yes', label: 'Yes — at least one', recommended: true },
            { id: 'no', label: 'No' },
          ],
          rationale: 'Audience implies regulated data but compliance_notes is empty.',
        },
      ],
      refinementSummary: 'Clarifying PII handling for the compliance constraints.',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.questions).toHaveLength(1);
      expect(ok.data.questions[0]!.rationale).toMatch(/PII|compliance/);
    }
  });

  it('rejects more than 3 follow-up questions', () => {
    const tooMany = RefinementResponse.safeParse({
      questions: Array.from({ length: 4 }, (_, i) => ({
        id: `q-${i}`,
        kind: 'short_text' as const,
        briefField: 'free_form' as const,
        prompt: `Question ${i}`,
        options: [],
        rationale: 'Some reason',
      })),
      refinementSummary: 'too many',
    });
    expect(tooMany.success).toBe(false);
  });

  it('rejects an unknown briefField (typo guard)', () => {
    const bad = RefinementResponse.safeParse({
      questions: [
        {
          id: 'q1',
          kind: 'short_text',
          briefField: 'nameOfClient', // not in the enum
          prompt: 'Who is this for?',
          options: [],
          rationale: 'Audience unclear.',
        },
      ],
      refinementSummary: 'oops',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a question kind that is not in the enum', () => {
    const bad = RefinementResponse.safeParse({
      questions: [
        {
          id: 'q1',
          kind: 'multiple_choice', // typo for multi_choice
          briefField: 'audience',
          prompt: 'Who is this for?',
          options: [],
          rationale: 'Audience unclear.',
        },
      ],
      refinementSummary: 'oops',
    });
    expect(bad.success).toBe(false);
  });

  it('requires a non-empty rationale per question', () => {
    const bad = RefinementResponse.safeParse({
      questions: [
        {
          id: 'q1',
          kind: 'short_text',
          briefField: 'audience',
          prompt: 'Who is this for?',
          options: [],
          rationale: '',
        },
      ],
      refinementSummary: 'oops',
    });
    expect(bad.success).toBe(false);
  });

  it('caps option count per question at 6', () => {
    const bad = RefinementResponse.safeParse({
      questions: [
        {
          id: 'q1',
          kind: 'single_choice',
          briefField: 'integrations',
          prompt: 'Pick one',
          options: Array.from({ length: 7 }, (_, i) => ({
            id: `opt-${i}`,
            label: `Option ${i}`,
          })),
          rationale: 'too many options',
        },
      ],
      refinementSummary: 'oops',
    });
    expect(bad.success).toBe(false);
  });
});
