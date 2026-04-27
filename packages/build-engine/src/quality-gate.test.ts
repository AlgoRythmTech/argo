import { describe, expect, it } from 'vitest';
import { runQualityGate } from './quality-gate.js';
import { BundleBuilder, sha256OfString } from './bundle-builder.js';
import { generatedHeader } from './header.js';
import type { OperationBundle } from '@argo/workspace-runtime';

function bundleWith(files: Array<{ path: string; contents: string; argoGenerated?: boolean }>): OperationBundle {
  const b = new BundleBuilder({
    operationId: 'op_test',
    schemaVersion: 1,
    bundleVersion: 1,
  });
  for (const f of files) {
    if (f.argoGenerated === false) {
      b.addScaffolding({ path: f.path, contents: f.contents });
    } else {
      b.addGenerated({ path: f.path, contents: f.contents, sourceStepId: null });
    }
  }
  return b.build({
    operationId: 'op_test',
    operationSlug: 'op-test',
    bundleVersion: 1,
    workflowMapVersion: 1,
    generatedByModel: 'unit-test',
    requiredEnv: ['ARGO_OPERATION_ID', 'INTERNAL_API_KEY'],
  });
}

describe('runQualityGate', () => {
  it('flags inlined OpenAI keys', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
const k = "sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaa";
require('http').createServer((q,r)=>{ if(q.url==='/health'){r.end('ok')} }).listen(3000,'0.0.0.0');
process.on('SIGTERM',()=>process.exit(0));`,
          argoGenerated: false,
        },
      ]),
    );
    const inlined = r.issues.find((i) => i.check === 'no_inlined_secrets');
    expect(inlined).toBeDefined();
    expect(r.passed).toBe(false);
  });

  it('flags servers that bind to localhost', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
require('http').createServer((q,r)=>{ if(q.url==='/health'){r.end('ok')} }).listen(3000,'localhost');
process.on('SIGTERM',()=>process.exit(0));`,
          argoGenerated: false,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'binds_to_0_0_0_0')).toBe(true);
    expect(r.passed).toBe(false);
  });

  it('passes a clean minimal bundle', () => {
    const goodServer = `// argo:scaffolding
const http = require('node:http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(404); res.end();
});
server.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module","engines":{"node":">=20"}}', argoGenerated: false },
        { path: 'server.js', contents: goodServer, argoGenerated: false },
      ]),
    );
    if (r.errorCount !== 0) {
      throw new Error('Expected zero errors. Got: ' + JSON.stringify(r.issues, null, 2));
    }
    expect(r.passed).toBe(true);
  });

  it('flags missing argo:generated header on a generated TS file', () => {
    const file = `// just a regular file, no header
export const x = 1;
`;
    const builder = new BundleBuilder({ operationId: 'op_test', schemaVersion: 1, bundleVersion: 1 });
    // Manually push a generated file WITHOUT going through addGenerated (which auto-attaches)
    const bundle: OperationBundle = {
      manifest: {
        operationId: 'op_test',
        operationSlug: 'op-test',
        bundleVersion: 1,
        workflowMapVersion: 1,
        generatedAt: new Date().toISOString(),
        generatedByModel: 'unit-test',
        requiredEnv: ['ARGO_OPERATION_ID', 'INTERNAL_API_KEY'],
        ports: [{ target: 3000, protocol: 'HTTP' as const }],
        image: 'blaxel/nextjs:latest',
        memoryMb: 1024,
        healthCheckPath: '/health',
      },
      files: [
        { path: 'package.json', contents: '{"name":"x","type":"module"}', sha256: sha256OfString('{}'), argoGenerated: false, sourceStepId: null },
        { path: 'server.js', contents: '// argo:scaffolding\nrequire("http").createServer().listen(3000,"0.0.0.0");process.on("SIGTERM",()=>{});', sha256: sha256OfString('s'), argoGenerated: false, sourceStepId: null },
        { path: 'src/handler.ts', contents: file, sha256: sha256OfString(file), argoGenerated: true, sourceStepId: null },
        { path: 'routes/health.js', contents: '// stub', sha256: sha256OfString('h'), argoGenerated: false, sourceStepId: null },
      ],
    };
    void generatedHeader;
    const report = runQualityGate(bundle);
    expect(report.issues.some((i) => i.check === 'argo_generated_header_present')).toBe(true);
  });

  it('flags interpolated SQL strings (no_sql_string_concatenation)', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
require('node:http').createServer().listen(3000,'0.0.0.0');
process.on('SIGTERM',()=>{});`,
          argoGenerated: false,
        },
        {
          path: 'routes/health.js',
          contents: `// argo:scaffolding\nexports.h=()=>0;`,
          argoGenerated: false,
        },
        {
          path: 'routes/items.js',
          contents:
            "/**\n * argo:generated\n */\nconst q = `SELECT * FROM items WHERE id = ${req.params.id}`;",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'no_sql_string_concatenation')).toBe(true);
  });

  it('flags MD5 + Math.random for tokens (no_weak_crypto)', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
require('node:http').createServer().listen(3000,'0.0.0.0');
process.on('SIGTERM',()=>{});`,
          argoGenerated: false,
        },
        {
          path: 'routes/health.js',
          contents: `// argo:scaffolding\nexports.h=()=>0;`,
          argoGenerated: false,
        },
        {
          path: 'auth/tokens.js',
          contents:
            "/**\n * argo:generated\n */\nconst h = createHash('md5').update(x).digest();\nconst token = Math.random().toString(36);",
          argoGenerated: true,
        },
      ]),
    );
    const ids = r.issues.filter((i) => i.check === 'no_weak_crypto');
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it('flags path traversal from req.params (no_path_traversal_from_user_input)', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
require('node:http').createServer().listen(3000,'0.0.0.0');
process.on('SIGTERM',()=>{});`,
          argoGenerated: false,
        },
        {
          path: 'routes/health.js',
          contents: `// argo:scaffolding\nexports.h=()=>0;`,
          argoGenerated: false,
        },
        {
          path: 'routes/files.js',
          contents:
            "/**\n * argo:generated\n */\nconst p = path.join('/data', req.params.filename);",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'no_path_traversal_from_user_input')).toBe(true);
  });

  it('flags secrets interpolated into errors (no_secrets_in_error_messages)', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
require('node:http').createServer().listen(3000,'0.0.0.0');
process.on('SIGTERM',()=>{});`,
          argoGenerated: false,
        },
        {
          path: 'routes/health.js',
          contents: `// argo:scaffolding\nexports.h=()=>0;`,
          argoGenerated: false,
        },
        {
          path: 'routes/debug.js',
          contents:
            '/**\n * argo:generated\n */\nthrow new Error(`could not connect with key ${process.env.OPENAI_API_KEY}`);',
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'no_secrets_in_error_messages')).toBe(true);
  });

  it('flags HTTP outbound URLs (no_http_in_outbound_urls)', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents: `// argo:scaffolding
require('node:http').createServer().listen(3000,'0.0.0.0');
process.on('SIGTERM',()=>{});`,
          argoGenerated: false,
        },
        {
          path: 'routes/health.js',
          contents: `// argo:scaffolding\nexports.h=()=>0;`,
          argoGenerated: false,
        },
        {
          path: 'lib/http.js',
          contents:
            "/**\n * argo:generated\n */\nawait request('http://api.example.com/v1/things');",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'no_http_in_outbound_urls')).toBe(true);
  });

  it('produces an autoFixPrompt that lists every error', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: 'not json', argoGenerated: false },
        { path: 'server.js', contents: '// argo:scaffolding\n', argoGenerated: false },
      ]),
    );
    expect(r.passed).toBe(false);
    expect(r.autoFixPrompt).toContain('# Quality gate failed');
    expect(r.autoFixPrompt).toContain('package.json');
  });

  // ── v4 hardening checks ─────────────────────────────────────────────

  it('flags dotenv import in production code', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents:
            "// argo:scaffolding\nimport 'dotenv/config';\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
          argoGenerated: false,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'no_dotenv_import_in_production_code')).toBe(true);
  });

  it('flags eval-suite missing when an LLM is called', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents:
            "// argo:scaffolding\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
          argoGenerated: false,
        },
        {
          path: 'routes/agent.js',
          contents:
            "// argo:generated\nimport { request } from 'undici';\nawait request('https://api.openai.com/v1/chat/completions', { method: 'POST' });",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'eval_suite_present_when_llm_used')).toBe(true);
  });

  it('does NOT flag eval-suite missing when there is no LLM call', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents:
            "// argo:scaffolding\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
          argoGenerated: false,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'eval_suite_present_when_llm_used')).toBe(false);
  });

  it('flags an unhandled .safeParse() expression statement', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents:
            "// argo:scaffolding\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
          argoGenerated: false,
        },
        {
          path: 'routes/items.js',
          contents:
            "// argo:generated\nimport { Schema } from '../schema/items.js';\nfunction handler(req) {\n  Schema.safeParse(req.body);\n  return { ok: true };\n}",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'no_unhandled_zod_safe_parse')).toBe(true);
  });

  it('flags a mailer template that interpolates without escaping', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents:
            "// argo:scaffolding\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
          argoGenerated: false,
        },
        {
          path: 'mailer/templates.js',
          contents:
            "// argo:generated\nexport function reject(s) { return `<p>Hi ${s.name},</p><p>Sorry: ${s.reason}</p>`; }",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'mailer_uses_escape_for_email')).toBe(true);
  });

  it('does NOT flag a mailer template that calls escapeForEmail', () => {
    const r = runQualityGate(
      bundleWith([
        { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
        {
          path: 'server.js',
          contents:
            "// argo:scaffolding\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
          argoGenerated: false,
        },
        {
          path: 'mailer/templates.js',
          contents:
            "// argo:generated\nimport { escapeForEmail } from '../security/escape.js';\nexport function reject(s) { return `<p>Hi ${escapeForEmail(s.name)},</p>`; }",
          argoGenerated: true,
        },
      ]),
    );
    expect(r.issues.some((i) => i.check === 'mailer_uses_escape_for_email')).toBe(false);
  });

  // ─── v5 hardening: agent-quality checks ───────────────────────────
  describe('v5 agent-quality checks', () => {
    const minimalScaffolding = [
      { path: 'package.json', contents: '{"name":"x","type":"module"}', argoGenerated: false },
      {
        path: 'server.js',
        contents:
          "// argo:scaffolding\nrequire('node:http').createServer().listen(3000,'0.0.0.0');\nprocess.on('SIGTERM',()=>{});",
        argoGenerated: false,
      },
    ];

    it('flags duplicate agent names within a bundle', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'agents/triage.js',
            contents: "// argo:generated\nexport const a = createAgent({ name: 'triage', model: 'gpt-4o', tools: [] });",
            argoGenerated: true,
          },
          {
            path: 'agents/triage2.js',
            contents: "// argo:generated\nexport const b = createAgent({ name: 'triage', model: 'gpt-4o-mini', tools: [] });",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'agent_name_unique_in_bundle')).toBe(true);
    });

    it('does NOT flag uniquely named agents', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'agents/triage.js',
            contents: "// argo:generated\nexport const a = createAgent({ name: 'triage', model: 'gpt-4o', tools: [] });",
            argoGenerated: true,
          },
          {
            path: 'agents/responder.js',
            contents: "// argo:generated\nexport const b = createAgent({ name: 'responder', model: 'gpt-4o-mini', tools: [] });",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'agent_name_unique_in_bundle')).toBe(false);
    });

    it('flags duplicate tool names', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'tools/lookup1.js',
            contents: "// argo:generated\nexport const t1 = defineTool({ name: 'lookup_customer', description: 'x', inputSchema: {}, handler: async () => ({}) });",
            argoGenerated: true,
          },
          {
            path: 'tools/lookup2.js',
            contents: "// argo:generated\nexport const t2 = defineTool({ name: 'lookup_customer', description: 'y', inputSchema: {}, handler: async () => ({}) });",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'tool_name_unique_in_bundle')).toBe(true);
    });

    it('flags an agent missing an outputSchema', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'agents/loose.js',
            contents: "// argo:generated\nexport const a = createAgent({ name: 'loose', model: 'gpt-4o', tools: [], systemPrompt: 'do stuff' });",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'agent_has_output_schema')).toBe(true);
    });

    it('does NOT flag an agent with an outputSchema', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'agents/strict.js',
            contents:
              "// argo:generated\nimport { z } from 'zod';\nexport const a = createAgent({ name: 'strict', model: 'gpt-4o', tools: [], outputSchema: z.object({ verdict: z.string() }) });",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'agent_has_output_schema')).toBe(false);
    });

    it('flags workflows with unnamed steps', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'workflows/onboard.js',
            contents:
              "// argo:generated\ndefineWorkflow('onboard', [{ name: 'verify_email', run: () => undefined }, { run: () => undefined }]);",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'workflow_steps_have_names')).toBe(true);
    });

    it('does NOT flag a workflow whose every step has a name', () => {
      const r = runQualityGate(
        bundleWith([
          ...minimalScaffolding,
          {
            path: 'workflows/onboard.js',
            contents:
              "// argo:generated\ndefineWorkflow('onboard', [{ name: 'verify_email', run: () => undefined }, { name: 'send_welcome', run: () => undefined }]);",
            argoGenerated: true,
          },
        ]),
      );
      expect(r.issues.some((i) => i.check === 'workflow_steps_have_names')).toBe(false);
    });
  });
});
