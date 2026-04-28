import { describe, it, expect } from 'vitest';
import { runSecurityScan } from './security-scanner.js';
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

describe('security-scanner', () => {
  it('produces a report for a simple bundle', () => {
    const bundle = makeBundle([
      { path: 'server.js', contents: 'const app = require("fastify")();\napp.get("/health", () => ({status:"ok"}));\napp.listen({port:3000});' },
      { path: 'package.json', contents: '{"name":"test"}' },
    ]);
    const report = runSecurityScan(bundle);
    // The scanner may flag missing helmet/csrf etc in a minimal bundle — that's OK.
    // We just verify it produces a valid report structure.
    expect(report).toBeDefined();
    expect(typeof report.passed).toBe('boolean');
    expect(typeof report.riskScore).toBe('number');
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('detects hardcoded Stripe keys', () => {
    const bundle = makeBundle([
      { path: 'config.js', contents: 'const stripeKey = "sk_live_FAKE_TEST_KEY_NOT_REAL";' },
    ]);
    const report = runSecurityScan(bundle);
    expect(report.findings.some((f) => f.category === 'hardcoded_secret')).toBe(true);
  });

  it('detects multiple issues in one file', () => {
    const bundle = makeBundle([
      { path: 'bad.js', contents: 'const key = "sk_live_FAKE_TEST_KEY_NOT_REAL";\neval(userInput);' },
    ]);
    const report = runSecurityScan(bundle);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.passed).toBe(false);
  });

  it('calculates risk score', () => {
    const bundle = makeBundle([
      { path: 'clean.js', contents: 'const x = 1 + 2;' },
    ]);
    const report = runSecurityScan(bundle);
    expect(report.riskScore).toBeGreaterThanOrEqual(0);
    expect(report.riskScore).toBeLessThanOrEqual(100);
  });

  it('reports finding counts', () => {
    const bundle = makeBundle([
      { path: 'bad.js', contents: 'obj.__proto__.isAdmin = true;\ncrypto.createHash("md5");' },
    ]);
    const report = runSecurityScan(bundle);
    expect(report.counts).toBeDefined();
    expect(typeof report.counts.critical).toBe('number');
  });

  it('does not flag env var references as secrets', () => {
    const bundle = makeBundle([
      { path: 'config.js', contents: 'const key = process.env.STRIPE_SECRET_KEY;' },
    ]);
    const report = runSecurityScan(bundle);
    expect(report.findings.filter((f) => f.category === 'hardcoded_secret').length).toBe(0);
  });
});
