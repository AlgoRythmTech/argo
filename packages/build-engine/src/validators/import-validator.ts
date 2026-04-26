import { validateImports, type ImportValidationIssue } from '@argo/security';
import type { OperationBundle } from '@argo/workspace-runtime';

const IMPORT_REGEX = /(?:^|\n)\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_REGEX = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_REGEX = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractImports(source: string): string[] {
  const imports = new Set<string>();
  for (const re of [IMPORT_REGEX, REQUIRE_REGEX, DYNAMIC_IMPORT_REGEX]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (m[1]) imports.add(m[1]);
    }
  }
  return Array.from(imports);
}

export function validateImportsInBundle(
  bundle: OperationBundle,
): Array<ImportValidationIssue & { file: string }> {
  const issues: Array<ImportValidationIssue & { file: string }> = [];
  for (const f of bundle.files) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) continue;
    const imports = extractImports(f.contents);
    const fileIssues = validateImports(imports, { allowRelative: true });
    for (const i of fileIssues) {
      issues.push({ ...i, file: f.path });
    }
  }
  return issues;
}
