import { describe, it, expect } from 'vitest';
import { runVerifier, type VerifierReport } from './verifier-agent.js';
import type { OperationBundle } from '@argo/workspace-runtime';

function makeBundle(files: Array<{ path: string; contents: string }>): OperationBundle {
  return {
    manifest: {
      operationId: 'test-op',
      operationSlug: 'test-op',
      bundleVersion: 1,
      workflowMapVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedByModel: 'test',
      requiredEnv: [],
      ports: [{ target: 3000, protocol: 'HTTP' as const }],
      image: 'node:20',
      memoryMb: 512,
      healthCheckPath: '/health',
    },
    files: files.map((f) => ({
      path: f.path,
      contents: f.contents,
      sha256: '',
      argoGenerated: true,
      sourceStepId: null,
    })),
  };
}

describe('verifier-agent', () => {
  it('fails when package.json is missing', () => {
    const bundle = makeBundle([
      { path: 'server.js', contents: 'const app = require("fastify")(); app.get("/health", async () => ({status:"ok"})); app.listen({port:3000});' },
    ]);
    const report = runVerifier(bundle);
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.category === 'missing_file' && f.message.includes('package.json'))).toBe(true);
  });

  it('fails when server entry point is missing', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.message.includes('server entry point'))).toBe(true);
  });

  it('detects hardcoded API keys', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'const key = "sk-1234567890abcdefghijklmno"; app.get("/health", () => ({status:"ok"}));' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'security_violation' && f.message.includes('API key'))).toBe(true);
  });

  it('detects AI slop (TODO comments)', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'import Fastify from "fastify";\nconst app = Fastify();\n// TODO: implement auth\napp.get("/health", async () => ({status:"ok"}));\napp.listen({port:3000});' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'ai_slop' && f.message.includes('TODO'))).toBe(true);
  });

  it('detects incomplete code stubs', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'import Fastify from "fastify";\nconst app = Fastify();\napp.get("/health", async () => ({status:"ok"}));\napp.listen({port:3000});' },
      { path: 'routes/users.js', contents: '// rest of code goes here\nexport function register() {}' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'ai_slop' && f.message.includes('Stub comment'))).toBe(true);
  });

  it('detects eval() usage', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'app.get("/health", async () => ({status:"ok"}));\nconst result = eval(userInput);' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'security_violation' && f.message.includes('eval'))).toBe(true);
  });

  it('detects missing health endpoint', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'import Fastify from "fastify";\nconst app = Fastify();\napp.get("/api/users", async () => []);\napp.listen({port:3000});' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'missing_health_check')).toBe(true);
  });

  it('passes a clean bundle', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test-app', type: 'module', scripts: { start: 'node server.js' }, dependencies: { fastify: '^4.0.0' } }) },
      { path: 'server.js', contents: 'import Fastify from "fastify";\nconst app = Fastify({logger:true});\napp.get("/health", async () => ({status:"ok"}));\napp.listen({host:"0.0.0.0",port:Number(process.env.PORT)||3000});' },
      { path: 'README.md', contents: '# Test App\n\nA test application.' },
      { path: '.env.example', contents: '# Server\nPORT=3000' },
      { path: 'tests/health.test.js', contents: 'import { test } from "node:test";\ntest("health", async () => {});' },
    ]);
    const report = runVerifier(bundle);
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it('detects broken imports', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'import { handler } from "./routes/nonexistent.js";\napp.get("/health", async () => ({status:"ok"}));' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'import_issue')).toBe(true);
  });

  it('detects console.log in production code', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'console.log("starting server");\napp.get("/health", async () => ({status:"ok"}));' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'ai_slop' && f.message.includes('console.log'))).toBe(true);
  });

  it('allows console.log in test files', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'import pino from "pino";\nconst log = pino();\napp.get("/health", async () => ({status:"ok"}));' },
      { path: 'tests/health.test.js', contents: 'console.log("running test");' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    // The console.log is in a test file, should NOT be flagged
    expect(report.findings.filter((f) => f.category === 'ai_slop' && f.message.includes('console.log')).length).toBe(0);
  });

  it('detects innerHTML XSS risk', () => {
    const bundle = makeBundle([
      { path: 'package.json', contents: JSON.stringify({ name: 'test', type: 'module', scripts: { start: 'node server.js' } }) },
      { path: 'server.js', contents: 'app.get("/health", async () => ({status:"ok"}));' },
      { path: 'web/App.tsx', contents: 'export function App() { return <div dangerouslySetInnerHTML={{__html: userInput}} />; }' },
      { path: 'README.md', contents: '# Test' },
      { path: '.env.example', contents: 'PORT=3000' },
    ]);
    const report = runVerifier(bundle);
    expect(report.findings.some((f) => f.category === 'security_violation' && f.message.includes('XSS'))).toBe(true);
  });
});
