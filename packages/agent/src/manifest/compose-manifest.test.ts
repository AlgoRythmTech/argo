import { describe, it, expect } from 'vitest';
import { buildManifest, renderManifestAsMarkdown } from './compose-manifest.js';

describe('buildManifest', () => {
  it('returns empty manifest for empty bundle', () => {
    const m = buildManifest({ files: [] });
    expect(m.files).toEqual([]);
    expect(m.fileCount).toBe(0);
    expect(m.generatedBytes).toBe(0);
    expect(m.agents).toEqual([]);
    expect(m.routes).toEqual([]);
    expect(m.workflows).toEqual([]);
  });

  it('extracts dependencies from package.json', () => {
    const m = buildManifest({
      files: [
        {
          path: 'package.json',
          contents: JSON.stringify({
            name: 'demo',
            dependencies: { fastify: '^4.0.0', zod: '^3.22.0' },
          }),
          argoGenerated: true,
        },
      ],
    });
    expect(m.dependencies.fastify).toBe('^4.0.0');
    expect(m.dependencies.zod).toBe('^3.22.0');
  });

  it('discovers agents declared via createAgent({ name, model, tools: [...] })', () => {
    const source = `
      import { createAgent } from '@argo/agent';
      const triage = createAgent({
        name: 'triage',
        model: 'gpt-4o-mini',
        tools: [classifyEmail, lookupCustomer],
      });
    `;
    const m = buildManifest({
      files: [{ path: 'agents/triage.js', contents: source, argoGenerated: true }],
    });
    expect(m.agents).toHaveLength(1);
    expect(m.agents[0]?.name).toBe('triage');
    expect(m.agents[0]?.model).toBe('gpt-4o-mini');
    expect(m.agents[0]?.tools).toContain('classifyEmail');
    expect(m.agents[0]?.tools).toContain('lookupCustomer');
  });

  it('discovers HTTP routes', () => {
    const source = `
      app.get('/api/health', () => ({ ok: true }));
      app.post('/api/submissions', handler);
      app.patch('/api/items/:id', updater);
    `;
    const m = buildManifest({
      files: [{ path: 'routes/index.js', contents: source, argoGenerated: true }],
    });
    expect(m.routes).toHaveLength(3);
    expect(m.routes.find((r) => r.method === 'GET')?.pattern).toBe('/api/health');
    expect(m.routes.find((r) => r.method === 'POST')?.pattern).toBe('/api/submissions');
    expect(m.routes.find((r) => r.method === 'PATCH')?.pattern).toBe('/api/items/:id');
  });

  it('discovers workflows + step names', () => {
    const source = `
      defineWorkflow('onboarding', [
        { name: 'verify_email', run: () => undefined },
        { name: 'send_welcome', run: () => undefined },
      ]);
    `;
    const m = buildManifest({
      files: [{ path: 'workflows/onboarding.js', contents: source, argoGenerated: true }],
    });
    expect(m.workflows).toHaveLength(1);
    expect(m.workflows[0]?.name).toBe('onboarding');
    expect(m.workflows[0]?.steps).toEqual(['verify_email', 'send_welcome']);
  });

  it('flags env vars not documented in .env.example', () => {
    const m = buildManifest({
      files: [
        {
          path: 'lib/db.js',
          contents: `const url = process.env.MONGO_URL; const k = process.env.STRIPE_KEY;`,
          argoGenerated: true,
        },
        {
          path: '.env.example',
          contents: `MONGO_URL=mongodb://localhost:27017/argo\n# STRIPE_KEY missing\n`,
          argoGenerated: true,
        },
      ],
    });
    const mongo = m.envVars.find((e) => e.name === 'MONGO_URL');
    const stripe = m.envVars.find((e) => e.name === 'STRIPE_KEY');
    expect(mongo?.documented).toBe(true);
    expect(stripe?.documented).toBe(false);
  });

  it('infers file roles from path conventions', () => {
    const m = buildManifest({
      files: [
        { path: 'server.js', contents: 'app.listen()', argoGenerated: true },
        { path: 'routes/items.js', contents: '', argoGenerated: true },
        { path: 'agents/triage.js', contents: '', argoGenerated: true },
        { path: 'workflows/onboarding.js', contents: '', argoGenerated: true },
        { path: 'web/pages/index.tsx', contents: '', argoGenerated: true },
      ],
    });
    const byPath = Object.fromEntries(m.files.map((f) => [f.path, f.role]));
    expect(byPath['server.js']).toBe('entry');
    expect(byPath['routes/items.js']).toBe('route');
    expect(byPath['agents/triage.js']).toBe('agent');
    expect(byPath['workflows/onboarding.js']).toBe('workflow');
    expect(byPath['web/pages/index.tsx']).toBe('web-page');
  });

  it('runtime-injected env vars (PORT, ARGO_OPERATION_ID) are not flagged', () => {
    const m = buildManifest({
      files: [
        {
          path: 'server.js',
          contents: `app.listen(process.env.PORT); const id = process.env.ARGO_OPERATION_ID;`,
          argoGenerated: true,
        },
      ],
    });
    expect(m.envVars.find((e) => e.name === 'PORT')).toBeUndefined();
    expect(m.envVars.find((e) => e.name === 'ARGO_OPERATION_ID')).toBeUndefined();
  });
});

describe('renderManifestAsMarkdown', () => {
  it('renders a markdown document with key sections', () => {
    const manifest = buildManifest({
      files: [
        {
          path: 'package.json',
          contents: JSON.stringify({ dependencies: { fastify: '^4.0.0' } }),
          argoGenerated: true,
        },
        {
          path: 'server.js',
          contents: `app.get('/api/health', () => ({ ok: true }));`,
          argoGenerated: true,
        },
      ],
    });
    const md = renderManifestAsMarkdown({
      manifest,
      operationName: 'demo-op',
      bundleVersion: 1,
    });
    expect(md).toContain('demo-op');
    expect(md).toContain('build manifest v1');
    expect(md).toContain('fastify');
    expect(md).toContain('/api/health');
    expect(md).toContain('Files');
    expect(md).toContain('Dependencies');
  });
});
