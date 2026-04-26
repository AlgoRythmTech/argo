import { describe, expect, it } from 'vitest';
import { WorkflowIntent, WorkflowMap } from './workflow.js';

describe('WorkflowIntent', () => {
  it('rejects too-short descriptions', () => {
    const result = WorkflowIntent.safeParse({
      rawDescription: 'too short',
      trigger: 'form_submission',
      audienceDescription: 'candidates',
      outcomeDescription: 'forward to client',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid candidate-intake intent', () => {
    const result = WorkflowIntent.safeParse({
      rawDescription:
        'Candidates apply via Google Form. I tag them by client and either reject, screen, or forward.',
      trigger: 'form_submission',
      audienceDescription: 'engineering candidates for Series A startups',
      outcomeDescription: 'forward strong matches to the hiring client, reject the rest politely',
      archetype: 'candidate_intake',
    });
    expect(result.success).toBe(true);
  });
});

describe('WorkflowMap', () => {
  it('requires at least 2 steps and 1 edge', () => {
    const minimal = {
      version: 1 as const,
      operationName: "Maya's Recruiting",
      ownerEmail: 'maya@example.com',
      trigger: {
        type: 'form_submission' as const,
        formTitle: 'Apply',
        fields: [{ id: 'name', label: 'Name', type: 'short_text' as const, required: true }],
      },
      steps: [
        { id: 'trigger', kind: 'trigger' as const, title: 'Form', summary: 'Receive submission' },
      ],
      edges: [],
    };
    expect(WorkflowMap.safeParse(minimal).success).toBe(false);
  });
});
