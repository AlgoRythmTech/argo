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

  it('picks all three agent snippets when specialist=agent_runtime', () => {
    const picked = selectSnippets({
      trigger: 'webhook',
      integrations: [],
      auth: 'none',
      dataClassification: 'internal',
      specialist: 'agent_runtime',
    });
    const ids = picked.map((s) => s.id);
    expect(ids).toContain('agent-loop');
    expect(ids).toContain('agent-tool-registry');
    expect(ids).toContain('agent-bounded-memory');
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

  it('picks SSE + websocket-auth-handshake when specialist is internal_tool', () => {
    const picked = selectSnippets({
      trigger: 'webhook',
      integrations: [],
      auth: 'magic_link',
      dataClassification: 'internal',
      specialist: 'internal_tool',
    });
    const ids = picked.map((s) => s.id);
    expect(ids).toContain('sse-streaming');
    expect(ids).toContain('websocket-auth-handshake');
  });

  it('picks idempotency-key-table for crud_app + form_workflow + rest_api builds', () => {
    for (const specialist of ['crud_app', 'rest_api', 'webhook_bridge']) {
      const picked = selectSnippets({
        trigger: 'form_submission',
        integrations: [],
        auth: 'none',
        dataClassification: 'internal',
        specialist,
      });
      const ids = picked.map((s) => s.id);
      expect(ids, `specialist=${specialist}`).toContain('idempotency-key-table');
    }
  });

  it('picks multi-tenant-rls when specialist is multi_tenant_saas', () => {
    const picked = selectSnippets({
      trigger: 'form_submission',
      integrations: [],
      auth: 'magic_link',
      dataClassification: 'pii',
      specialist: 'multi_tenant_saas',
    });
    const ids = picked.map((s) => s.id);
    expect(ids).toContain('multi-tenant-rls');
  });

  it('picks oauth2-pkce-callback only when auth=oauth2', () => {
    const withOauth = selectSnippets({
      trigger: 'webhook',
      integrations: [],
      auth: 'oauth2',
      dataClassification: 'internal',
      specialist: 'multi_tenant_saas',
    });
    const without = selectSnippets({
      trigger: 'webhook',
      integrations: [],
      auth: 'magic_link',
      dataClassification: 'internal',
      specialist: 'crud_app',
    });
    expect(withOauth.some((s) => s.id === 'oauth2-pkce-callback')).toBe(true);
    expect(without.some((s) => s.id === 'oauth2-pkce-callback')).toBe(false);
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
