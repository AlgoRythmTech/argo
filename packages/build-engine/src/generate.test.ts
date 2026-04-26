import { describe, expect, it } from 'vitest';
import type { WorkflowMap } from '@argo/shared-types';
import { generateBundle } from './generate.js';
import { hasGeneratedHeader } from './header.js';

const map: WorkflowMap = {
  version: 1,
  operationName: "Maya's Recruiting",
  ownerEmail: 'maya@example.com',
  trigger: {
    type: 'form_submission',
    formTitle: 'Apply for Acme SRE',
    fields: [
      { id: 'name', label: 'Full name', type: 'short_text', required: true },
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'years', label: 'Years', type: 'number', required: true },
      { id: 'why', label: 'Why?', type: 'long_text', required: true },
    ],
  },
  steps: [
    { id: 'trigger', kind: 'trigger', title: 'Form', summary: 'A new submission arrives.', config: {}, position: { x: 0, y: 0 } },
    { id: 'validate', kind: 'validate', title: 'Validate', summary: 'Required fields ok.', config: {}, position: { x: 200, y: 0 } },
    { id: 'classify', kind: 'classify', title: 'Classify', summary: 'Score against criteria.', config: {}, position: { x: 400, y: 0 } },
    { id: 'draft', kind: 'draft_email', title: 'Draft', summary: 'Draft a reply.', config: {}, position: { x: 600, y: 0 } },
    { id: 'approval', kind: 'approval_gate', title: 'Approve', summary: 'Wait for the user.', config: {}, position: { x: 800, y: 0 } },
    { id: 'send', kind: 'send_email', title: 'Send', summary: 'Send the reply.', config: {}, position: { x: 1000, y: 0 } },
    { id: 'persist', kind: 'persist', title: 'Persist', summary: 'Record the decision.', config: {}, position: { x: 1200, y: 0 } },
    { id: 'digest', kind: 'digest', title: 'Digest', summary: 'Weekly summary.', config: { cron: '0 9 * * 1' }, position: { x: 600, y: 200 } },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'validate' },
    { id: 'e2', source: 'validate', target: 'classify' },
    { id: 'e3', source: 'classify', target: 'draft' },
    { id: 'e4', source: 'draft', target: 'approval' },
    { id: 'e5', source: 'approval', target: 'send' },
    { id: 'e6', source: 'send', target: 'persist' },
  ],
  digest: { enabled: true, cron: '0 9 * * 1', timezone: 'America/New_York', audience: ['maya@example.com'] },
};

describe('generateBundle', () => {
  it('produces a bundle that passes validation', () => {
    const result = generateBundle({
      operationId: 'op_test_12345',
      operationSlug: 'mayas-recruiting',
      bundleVersion: 1,
      workflowMapVersion: 1,
      generatedByModel: 'unit-test',
      map,
    });
    if (!result.ok) {
      // Surface the issues directly so the test failure is actionable.
      throw new Error(`bundle invalid: ${result.issues.join('; ')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('attaches argo:generated headers to every generated file', () => {
    const result = generateBundle({
      operationId: 'op_test_12345',
      operationSlug: 'mayas-recruiting',
      bundleVersion: 1,
      workflowMapVersion: 1,
      generatedByModel: 'unit-test',
      map,
    });
    if (!result.ok) throw new Error('expected ok');
    for (const f of result.bundle.files) {
      if (f.argoGenerated && /\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) {
        expect(hasGeneratedHeader(f.contents)).toBe(true);
      }
    }
  });

  it('includes a server entry, health route, and form route', () => {
    const result = generateBundle({
      operationId: 'op_test_12345',
      operationSlug: 'mayas-recruiting',
      bundleVersion: 1,
      workflowMapVersion: 1,
      generatedByModel: 'unit-test',
      map,
    });
    if (!result.ok) throw new Error('expected ok');
    const paths = result.bundle.files.map((f) => f.path);
    expect(paths).toContain('server.js');
    expect(paths).toContain('routes/health.js');
    expect(paths).toContain('routes/form.js');
    expect(paths).toContain('routes/approval.js');
    expect(paths).toContain('jobs/scheduler.js');
    expect(paths).toContain('observability/sidecar.js');
  });
});
