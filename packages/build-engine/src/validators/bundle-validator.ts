import type { OperationBundle } from '@argo/workspace-runtime';
import { hasGeneratedHeader } from '../header.js';
import { extractImports, validateImportsInBundle } from './import-validator.js';
import { detectInlinedSecrets } from './secret-validator.js';

export type BundleValidationResult =
  | { ok: true }
  | { ok: false; issues: string[] };

/**
 * Section 12: "Static analysis in the test phase — Semgrep runs against
 * generated code with a custom ruleset for OWASP Top 10. Findings block the
 * deployment. No exceptions in v1."
 *
 * The full Semgrep step lives in /apps/api/src/jobs/build-test.ts (it shells
 * out to semgrep). The synchronous checks here cover the structural
 * invariants — header presence, import allow-list, no inlined secrets.
 */
export function validateBundle(bundle: OperationBundle): BundleValidationResult {
  const issues: string[] = [];

  // 1. Every argo:generated file must have its header.
  for (const f of bundle.files) {
    if (f.argoGenerated && /\.(ts|tsx|js|mjs|cjs)$/i.test(f.path) && !hasGeneratedHeader(f.contents)) {
      issues.push(`generated file missing argo:generated header: ${f.path}`);
    }
  }

  // 2. Imports must be allow-listed.
  const importIssues = validateImportsInBundle(bundle);
  for (const i of importIssues) {
    issues.push(`disallowed import in ${i.file}: "${i.importPath}" (${i.reason})`);
  }

  // 3. No inlined secrets.
  for (const f of bundle.files) {
    const matches = detectInlinedSecrets(f.contents);
    for (const m of matches) {
      issues.push(`inlined secret in ${f.path}: ${m.kind} (${m.preview})`);
    }
  }

  // 4. Manifest invariants.
  if (bundle.manifest.requiredEnv.length === 0) {
    issues.push('manifest.requiredEnv is empty — at least ARGO_OPERATION_ID is required');
  }
  if (!bundle.manifest.requiredEnv.includes('INTERNAL_API_KEY')) {
    issues.push('manifest.requiredEnv must include INTERNAL_API_KEY');
  }

  // 5. Health check route must exist.
  const hasHealth = bundle.files.some((f) => f.path === 'routes/health.js' || f.path === 'src/routes/health.ts');
  if (!hasHealth) {
    issues.push('bundle must include a health-check route');
  }

  // Just exercises extractImports to keep tree-shake honest.
  void extractImports;

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
