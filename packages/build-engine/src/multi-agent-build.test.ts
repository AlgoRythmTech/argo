// Schema-shape tests for the multi-agent orchestrator parsers.
// We don't hit OpenAI here — the goal is to lock the contract the
// model has to honour for the architect + reviewer to be useful.

import { describe, expect, it } from 'vitest';
import {
  FilePlan,
  FilePlanEntry,
  ReviewFinding,
  ReviewReport,
  renderReviewAsAutoFixPrompt,
} from './multi-agent-build.js';

const VALID_PLAN_FILES = Array.from({ length: 12 }, (_, i) => ({
  path: `routes/file${i}.js`,
  rationale: `Owns concern ${i}. Split out so route handlers stay focused on validation + handler logic, and helpers live elsewhere.`,
  dependsOn: i === 0 ? [] : [`routes/file${i - 1}.js`],
  acceptance: [`Returns 200 on happy path with shape /api/${i}`],
  size: 'medium' as const,
  argoGenerated: true,
}));

describe('FilePlan parser', () => {
  it('parses a minimal valid plan', () => {
    const r = FilePlan.safeParse({
      title: 'Candidate Intake',
      summary:
        'A workflow that receives applications, classifies fit, and emails approvals. The architect plan is the explicit contract the builder agent must satisfy.',
      mermaid: 'flowchart LR\n  A[Form] --> B[Validate]\n  B --> C[Classify]\n  C --> D[Mailer]',
      files: VALID_PLAN_FILES,
      dependencies: ['fastify', 'zod', 'mongodb'],
      openQuestions: [],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a plan with fewer than 8 files', () => {
    const tooFew = FilePlan.safeParse({
      title: 'Tiny',
      summary: 'too few files for a real production stack to ship — sub-8 plans get bounced',
      mermaid: 'flowchart LR\n  A --> B',
      files: VALID_PLAN_FILES.slice(0, 5),
    });
    expect(tooFew.success).toBe(false);
  });

  it('rejects a file entry with too-short rationale', () => {
    const r = FilePlanEntry.safeParse({
      path: 'server.js',
      rationale: 'too short',
      dependsOn: [],
      acceptance: ['boots'],
      size: 'medium',
      argoGenerated: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown size value', () => {
    const r = FilePlanEntry.safeParse({
      path: 'server.js',
      rationale: 'A real production-grade rationale that explains why this file exists separately.',
      dependsOn: [],
      acceptance: ['boots'],
      size: 'gigantic',
      argoGenerated: true,
    });
    expect(r.success).toBe(false);
  });

  it('defaults dependsOn / acceptance / argoGenerated when omitted', () => {
    const r = FilePlanEntry.safeParse({
      path: 'server.js',
      rationale: 'Boot entry; mounts middleware and registers routes — the canonical Fastify setup.',
      size: 'medium',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dependsOn).toEqual([]);
      expect(r.data.acceptance).toEqual([]);
      expect(r.data.argoGenerated).toBe(true);
    }
  });
});

describe('ReviewReport parser', () => {
  const validFinding = ReviewFinding.parse({
    severity: 'bad',
    category: 'incomplete_implementation',
    file: 'routes/form.js',
    message: 'The handler stops at validation — never persists or replies. Implement the full happy path.',
  });

  it('parses a passed report with no findings', () => {
    const r = ReviewReport.safeParse({
      passed: true,
      findings: [],
      summary: 'All planned files exist; the static gate and the runtime tests are green; ship it.',
    });
    expect(r.success).toBe(true);
  });

  it('parses a failing report with findings', () => {
    const r = ReviewReport.safeParse({
      passed: false,
      findings: [validFinding],
      summary: 'Two of the planned files are stubs. Bouncing back for fixes.',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown severity value', () => {
    const r = ReviewFinding.safeParse({
      severity: 'critical',
      category: 'unsafe_code',
      file: 'server.js',
      message: 'critical SQL injection risk',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown category value', () => {
    const r = ReviewFinding.safeParse({
      severity: 'bad',
      category: 'made_up_category',
      file: 'server.js',
      message: 'something is wrong',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty summary', () => {
    const r = ReviewReport.safeParse({
      passed: true,
      findings: [],
      summary: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('renderReviewAsAutoFixPrompt', () => {
  it('returns empty string when the review passed', () => {
    const out = renderReviewAsAutoFixPrompt({
      passed: true,
      findings: [],
      summary: 'Looks great — no findings, ship it.',
    });
    expect(out).toBe('');
  });

  it('separates BLOCKING from warning findings', () => {
    const out = renderReviewAsAutoFixPrompt({
      passed: false,
      findings: [
        {
          severity: 'bad',
          category: 'missing_file',
          file: 'tests/eval-suite.js',
          message: 'The plan called for tests/eval-suite.js but the bundle does not include it.',
        },
        {
          severity: 'warn',
          category: 'naming',
          file: 'routes/handler.js',
          message: 'consider renaming to routes/submissions.js for clarity',
        },
      ],
      summary: 'One missing file plus one naming nit.',
    });
    expect(out).toContain('BLOCKING');
    expect(out).toContain('missing_file');
    expect(out).toContain('Warnings');
    expect(out).toContain('naming');
    expect(out).toContain('<dyad-write>');
    expect(out).toContain('<dyad-chat-summary>');
  });
});
