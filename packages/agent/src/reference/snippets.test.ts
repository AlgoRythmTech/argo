import { describe, expect, it } from 'vitest';
import {
  REFERENCE_SNIPPETS,
  renderSnippetsAsPromptSection,
  selectSnippets,
} from './snippets.js';

describe('REFERENCE_SNIPPETS', () => {
  it('every snippet has a purpose, hint path, body, and at least one tag', () => {
    for (const s of REFERENCE_SNIPPETS) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.title.length).toBeGreaterThan(8);
      expect(s.purpose.length).toBeGreaterThan(20);
      expect(s.hintedPath.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(80);
      expect(s.tags.length).toBeGreaterThan(0);
    }
  });

  it('selectSnippets always returns the every-build baseline', () => {
    const picked = selectSnippets({
      trigger: 'form_submission',
      integrations: [],
      auth: 'none',
      dataClassification: 'public',
      specialist: 'form_workflow',
    });
    const ids = picked.map((s) => s.id);
    expect(ids).toContain('fastify-bootstrap');
    expect(ids).toContain('observability-sidecar');
    expect(ids).toContain('zod-validated-route');
  });

  it('picks slack snippet when slack integration is set', () => {
    const picked = selectSnippets({
      trigger: 'webhook',
      integrations: ['slack'],
      auth: 'none',
      dataClassification: 'internal',
      specialist: 'slack_bot',
    });
    expect(picked.some((s) => s.id === 'slack-bolt-app')).toBe(true);
  });

  it('picks stripe snippet when stripe integration is set', () => {
    const picked = selectSnippets({
      trigger: 'webhook',
      integrations: ['stripe'],
      auth: 'magic_link',
      dataClassification: 'pii',
      specialist: 'crud_app',
    });
    expect(picked.some((s) => s.id === 'stripe-checkout-and-webhook')).toBe(true);
    expect(picked.some((s) => s.id === 'magic-link-auth')).toBe(true);
  });

  it('renderSnippetsAsPromptSection produces the expected header and code fences', () => {
    const picked = selectSnippets({
      trigger: 'form_submission',
      integrations: [],
      auth: 'none',
      dataClassification: 'pii',
      specialist: 'form_workflow',
    });
    const out = renderSnippetsAsPromptSection(picked);
    expect(out).toContain('# Reference patterns');
    expect(out).toContain('```js');
    expect(out).toContain('Hint path:');
  });
});
