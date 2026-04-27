// NPM validator tests — exercise the deterministic parts (name parsing,
// failure rendering, package.json extraction) without hitting the real
// registry. Network-touching paths are exercised by integration tests.

import { describe, expect, it } from 'vitest';
import { renderDependencyFailures, validateDependencies } from './npm-validator.js';
import { BundleBuilder } from './bundle-builder.js';
import type { OperationBundle } from '@argo/workspace-runtime';

function bundleWith(packageJson: string): OperationBundle {
  const b = new BundleBuilder({ operationId: 'op_test', schemaVersion: 1, bundleVersion: 1 });
  b.addScaffolding({ path: 'package.json', contents: packageJson });
  b.addScaffolding({
    path: 'server.js',
    contents:
      '// argo:scaffolding\nrequire("node:http").createServer().listen(3000,"0.0.0.0");process.on("SIGTERM",()=>{});',
  });
  return b.build({
    operationId: 'op_test',
    operationSlug: 'op-test',
    bundleVersion: 1,
    workflowMapVersion: 1,
    generatedByModel: 'unit-test',
    requiredEnv: ['ARGO_OPERATION_ID', 'INTERNAL_API_KEY'],
  });
}

describe('renderDependencyFailures', () => {
  it('returns empty string for an empty failure list', () => {
    expect(renderDependencyFailures([])).toBe('');
  });

  it('renders failures with the package name + reason + detail', () => {
    const out = renderDependencyFailures([
      {
        packageName: 'fake-pkg-that-does-not-exist',
        source: 'package.json',
        reason: 'not_found',
        detail: '"fake-pkg-that-does-not-exist" does not exist on npm.',
      },
    ]);
    expect(out).toContain('## NPM dependency failures');
    expect(out).toContain('fake-pkg-that-does-not-exist');
    expect(out).toContain('not_found');
    expect(out).toContain('package.json');
    expect(out).toContain('<dyad-write>');
  });
});

describe('validateDependencies (offline / invalid-name path)', () => {
  it('rejects an invalid-shaped package name without hitting the network', async () => {
    const bundle = bundleWith(
      '{"name":"x","type":"module","dependencies":{"NOT_A_VALID_NAME!!!":"^1.0.0"}}',
    );
    const r = await validateDependencies(bundle);
    expect(r.allValid).toBe(false);
    expect(r.failures.some((f) => f.reason === 'invalid_name')).toBe(true);
  });

  it('skips workspace + node-builtin names without a network call', async () => {
    const bundle = bundleWith(
      '{"name":"x","type":"module","dependencies":{"@argo/agent":"workspace:*","node":"builtin"}}',
    );
    const r = await validateDependencies(bundle);
    // Both are skipped; nothing validated, nothing failed.
    expect(r.validated).toBe(0);
    expect(r.failures).toHaveLength(0);
    expect(r.allValid).toBe(true);
  });

  it('returns allValid:true for an empty dependencies object', async () => {
    const bundle = bundleWith('{"name":"x","type":"module","dependencies":{}}');
    const r = await validateDependencies(bundle);
    expect(r.allValid).toBe(true);
    expect(r.validated).toBe(0);
  });

  it('handles a malformed package.json by collecting zero candidates', async () => {
    const bundle = bundleWith('this is not json');
    const r = await validateDependencies(bundle);
    // Invalid JSON → no candidates → trivially valid (the package_json_valid
    // gate elsewhere catches this).
    expect(r.allValid).toBe(true);
    expect(r.validated).toBe(0);
  });
});
