// Quality gate — every generated bundle passes through this BEFORE the
// IExecutionProvider deploys it. Catches the "looks fine but won't run"
// class of LLM failure that kills Replit-style platforms.
//
// Five checks run in sequence; first failure short-circuits with a
// structured QualityReport the auto-fix loop reads to re-prompt the model.

import { validateImports, type ImportValidationIssue } from '@argo/security';
import type { OperationBundle, OperationBundleFile } from '@argo/workspace-runtime';
import { hasGeneratedHeader } from './header.js';
import { detectInlinedSecrets } from './validators/secret-validator.js';
import { extractImports } from './validators/import-validator.js';

export type QualityCheckId =
  | 'argo_generated_header_present'
  | 'no_inlined_secrets'
  | 'imports_allow_listed'
  | 'no_console_log'
  | 'no_eval_or_function_constructor'
  | 'no_typescript_any'
  | 'no_unhandled_promise_rejection'
  | 'no_hardcoded_localhost'
  | 'every_route_has_zod_validation'
  | 'health_route_present'
  | 'sigterm_handler_present'
  | 'binds_to_0_0_0_0'
  | 'no_synchronous_fs'
  | 'package_json_valid'
  | 'no_deprecated_apis';

export interface QualityIssue {
  check: QualityCheckId;
  severity: 'error' | 'warn';
  file: string;
  line: number | null;
  message: string;
}

export interface QualityReport {
  passed: boolean;
  errorCount: number;
  warnCount: number;
  issues: QualityIssue[];
  /** Human-readable summary the auto-fix loop feeds back to the model. */
  autoFixPrompt: string;
}

export function runQualityGate(bundle: OperationBundle): QualityReport {
  const issues: QualityIssue[] = [];

  for (const file of bundle.files) {
    issues.push(...checkHeaders(file));
    issues.push(...checkSecrets(file));
    issues.push(...checkImports(file));
    issues.push(...checkConsoleLog(file));
    issues.push(...checkEval(file));
    issues.push(...checkAny(file));
    issues.push(...checkUnhandled(file));
    issues.push(...checkLocalhost(file));
    issues.push(...checkSyncFs(file));
  }

  issues.push(...checkServerBootstrap(bundle));
  issues.push(...checkPackageJson(bundle));
  issues.push(...checkRouteValidation(bundle));

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;

  return {
    passed: errorCount === 0,
    errorCount,
    warnCount,
    issues,
    autoFixPrompt: composeAutoFixPrompt(issues),
  };
}

// ── Per-file checks ────────────────────────────────────────────────────

function checkHeaders(f: OperationBundleFile): QualityIssue[] {
  if (!f.argoGenerated) return [];
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  if (hasGeneratedHeader(f.contents)) return [];
  return [
    {
      check: 'argo_generated_header_present',
      severity: 'error',
      file: f.path,
      line: 1,
      message: 'Generated file is missing the argo:generated header. Add it as the first comment block.',
    },
  ];
}

function checkSecrets(f: OperationBundleFile): QualityIssue[] {
  const matches = detectInlinedSecrets(f.contents);
  return matches.map((m) => ({
    check: 'no_inlined_secrets',
    severity: 'error',
    file: f.path,
    line: null,
    message: `Inlined ${m.kind} detected (${m.preview}). Move to environment variables and read with process.env.`,
  }));
}

function checkImports(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const found = extractImports(f.contents);
  const issues: ImportValidationIssue[] = validateImports(found, { allowRelative: true });
  return issues.map((i) => ({
    check: 'imports_allow_listed',
    severity: 'error',
    file: f.path,
    line: null,
    message: `Import "${i.importPath}" is ${i.reason.replace(/_/g, ' ')}. Use only allow-listed packages.`,
  }));
}

function checkConsoleLog(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/\bconsole\.(log|info|debug|warn|error)\s*\(/.test(line)) {
      // The mock-server fallback in docker-mock is the one allowed exception.
      if (line.includes('// argo:scaffolding') || line.includes('// argo:mock')) return;
      out.push({
        check: 'no_console_log',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Use the pino logger (req.log or app.log), not console.*. Operators replay logs via PII-redacted store.',
      });
    }
  });
  return out;
}

function checkEval(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/\beval\s*\(/.test(line) || /\bnew\s+Function\s*\(/.test(line)) {
      out.push({
        check: 'no_eval_or_function_constructor',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: 'eval() and new Function() are forbidden. Use a real parser or a structured config instead.',
      });
    }
  });
  return out;
}

function checkAny(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/:\s*any\b/.test(line) && !line.trim().startsWith('//')) {
      out.push({
        check: 'no_typescript_any',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Avoid `any`. Use `unknown` and narrow with Zod, or extract a typed interface.',
      });
    }
    if (/@ts-ignore/.test(line) && !line.trim().startsWith('//')) {
      out.push({
        check: 'no_typescript_any',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: '@ts-ignore is forbidden. Fix the underlying type.',
      });
    }
  });
  return out;
}

function checkUnhandled(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    // catch a Promise call that ends with `)` and isn't awaited or chained with .catch
    const m = line.match(/^(?!.*\bawait\b).*\.(then|catch)\s*\(/);
    if (m && !/\.catch\s*\(/.test(line) && !/\.finally\s*\(/.test(line)) {
      // Heuristic only — skip if next line is .catch
      const next = lines[idx + 1] ?? '';
      if (!/\.catch\s*\(/.test(next)) {
        out.push({
          check: 'no_unhandled_promise_rejection',
          severity: 'warn',
          file: f.path,
          line: idx + 1,
          message: 'Promise without .catch — chain a .catch or wrap in try/await.',
        });
      }
    }
  });
  return out;
}

function checkLocalhost(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|json)$/i.test(f.path)) return [];
  if (f.path.startsWith('config/')) return []; // dev configs may legitimately mention localhost
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/['"`]localhost['"`]/.test(line) || /['"`]127\.0\.0\.1['"`]/.test(line)) {
      out.push({
        check: 'no_hardcoded_localhost',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Hardcoded localhost will break inside the Blaxel sandbox. Read the host from env.',
      });
    }
  });
  return out;
}

function checkSyncFs(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/\bfs\.(readFileSync|writeFileSync|readdirSync|statSync|mkdirSync)\s*\(/.test(line)) {
      out.push({
        check: 'no_synchronous_fs',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Synchronous fs blocks the event loop. Use fs/promises with await.',
      });
    }
  });
  return out;
}

// ── Bundle-wide checks ─────────────────────────────────────────────────

function checkServerBootstrap(bundle: OperationBundle): QualityIssue[] {
  const out: QualityIssue[] = [];
  const server = bundle.files.find((f) => f.path === 'server.js' || f.path === 'src/server.ts');
  if (!server) {
    out.push({
      check: 'health_route_present',
      severity: 'error',
      file: '(bundle)',
      line: null,
      message: 'No server entry (server.js or src/server.ts). The Blaxel runtime won\'t boot.',
    });
    return out;
  }

  const health = bundle.files.some(
    (f) =>
      f.path === 'routes/health.js' ||
      f.path === 'src/routes/health.ts' ||
      /\/health/.test(f.contents),
  );
  if (!health) {
    out.push({
      check: 'health_route_present',
      severity: 'error',
      file: server.path,
      line: null,
      message: 'No /health route detected. Blaxel deploy will fail the health gate after 90s.',
    });
  }

  if (!/0\.0\.0\.0/.test(server.contents)) {
    out.push({
      check: 'binds_to_0_0_0_0',
      severity: 'error',
      file: server.path,
      line: null,
      message: 'Server must bind to host "0.0.0.0", not "localhost". The Blaxel preview can\'t reach localhost.',
    });
  }

  if (!/SIGTERM/.test(server.contents)) {
    out.push({
      check: 'sigterm_handler_present',
      severity: 'warn',
      file: server.path,
      line: null,
      message: 'No SIGTERM handler — the staging-swap will kill the process abruptly.',
    });
  }

  return out;
}

function checkPackageJson(bundle: OperationBundle): QualityIssue[] {
  const pkg = bundle.files.find((f) => f.path === 'package.json');
  if (!pkg) {
    return [
      {
        check: 'package_json_valid',
        severity: 'error',
        file: '(bundle)',
        line: null,
        message: 'Missing package.json. Generate it as the first scaffolding file.',
      },
    ];
  }
  try {
    const json = JSON.parse(pkg.contents) as { name?: string; type?: string; engines?: Record<string, string> };
    const issues: QualityIssue[] = [];
    if (!json.name) {
      issues.push({
        check: 'package_json_valid',
        severity: 'warn',
        file: pkg.path,
        line: null,
        message: 'package.json missing "name".',
      });
    }
    if (json.type && json.type !== 'module' && json.type !== 'commonjs') {
      issues.push({
        check: 'package_json_valid',
        severity: 'error',
        file: pkg.path,
        line: null,
        message: `package.json "type" must be "module" or "commonjs"; got "${json.type}".`,
      });
    }
    return issues;
  } catch (err) {
    return [
      {
        check: 'package_json_valid',
        severity: 'error',
        file: pkg.path,
        line: null,
        message: `package.json is not valid JSON: ${String(err).slice(0, 120)}`,
      },
    ];
  }
}

function checkRouteValidation(bundle: OperationBundle): QualityIssue[] {
  const out: QualityIssue[] = [];
  const routes = bundle.files.filter((f) => /^routes\/|^src\/routes\//.test(f.path) && /\.(ts|js)$/i.test(f.path));
  for (const r of routes) {
    if (r.path.endsWith('health.js') || r.path.endsWith('health.ts')) continue; // /health takes no body
    if (r.path.endsWith('approval.js') || r.path.endsWith('approval.ts')) continue; // GET-only by token
    const hasPost = /\.post\s*\(/.test(r.contents);
    const hasZod = /SubmissionSchema|z\.object|safeParse/.test(r.contents);
    if (hasPost && !hasZod) {
      out.push({
        check: 'every_route_has_zod_validation',
        severity: 'error',
        file: r.path,
        line: null,
        message: 'POST route without Zod validation. Every public input MUST go through safeParse before persisting.',
      });
    }
  }
  return out;
}

// ── Auto-fix prompt composer ───────────────────────────────────────────

function composeAutoFixPrompt(issues: QualityIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) return '';
  const lines: string[] = [];
  lines.push('# Quality gate failed — fix these errors before deploying.');
  lines.push('');
  lines.push('Each item below is a hard error. Re-emit the affected files with <dyad-write>');
  lines.push('to fix every one. Do not introduce new files; do not modify untouched files.');
  lines.push('');
  for (const issue of errors) {
    const where = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    lines.push(`- [${issue.check}] ${where} — ${issue.message}`);
  }
  return lines.join('\n');
}
