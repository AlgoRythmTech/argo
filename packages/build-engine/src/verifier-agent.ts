/**
 * Verifier Agent — the "second pair of eyes" that catches what the builder missed.
 *
 * Inspired by:
 *   - Replit Agent 4's Verifier: validates via screenshots + static checks
 *   - Emergent's Testing Agent: runs automated backend + frontend tests
 *   - Devin's self-debugging: reads errors, reasons about cause, tries alternatives
 *
 * Argo's Verifier is BETTER because:
 *   1. It runs INSIDE the quality gate pipeline (not optional)
 *   2. It checks against the FilePlan's acceptance criteria
 *   3. It can invoke sandbox_exec to run tsc, vitest, and eval-suite
 *   4. It produces structured findings the auto-fix loop consumes
 *   5. It catches "AI slop" patterns (TODO stubs, console.log, hardcoded keys)
 *
 * The Verifier is NOT the Reviewer (multi-agent-build.ts). The Reviewer
 * checks "did we ship the plan?" The Verifier checks "does the code
 * actually work and is it production-grade?"
 */

import type { OperationBundle } from '@argo/workspace-runtime';

// ── Types ─────────────────────────────────────────────────────────────

export interface VerifierFinding {
  severity: 'critical' | 'error' | 'warning' | 'info';
  category: VerifierCategory;
  file: string | null;
  line: number | null;
  message: string;
  suggestion: string | null;
}

export type VerifierCategory =
  | 'missing_file'           // Expected file not in bundle
  | 'incomplete_code'        // TODO/stub/placeholder detected
  | 'security_violation'     // Hardcoded secret, SQL injection, XSS
  | 'missing_validation'     // Route without Zod validation
  | 'missing_error_handling' // Async without try/catch or error boundary
  | 'missing_health_check'   // No /health endpoint
  | 'missing_tests'          // No test files
  | 'missing_readme'         // No README.md
  | 'missing_env_example'    // No .env.example
  | 'import_issue'           // Import of non-existent file or package
  | 'type_error'             // TypeScript type error (from sandbox_exec)
  | 'test_failure'           // Test failure (from sandbox_exec)
  | 'ai_slop'               // Generic/copy-paste code, console.log, etc.
  | 'accessibility'          // Missing aria labels, alt text, etc.
  | 'performance'            // N+1 queries, missing indexes, etc.
  | 'naming'                 // Unclear or inconsistent naming
  ;

export interface VerifierReport {
  passed: boolean;
  score: number; // 0-100
  totalChecks: number;
  passedChecks: number;
  findings: VerifierFinding[];
  summary: string;
}

// ── Pattern Matchers ──────────────────────────────────────────────────

interface PatternCheck {
  category: VerifierCategory;
  severity: VerifierFinding['severity'];
  /** Regex to match against file contents */
  pattern: RegExp;
  /** File path patterns this check applies to (glob-like) */
  fileFilter?: RegExp;
  /** Files to EXCLUDE from this check */
  excludeFilter?: RegExp;
  message: string;
  suggestion: string;
}

const PATTERNS: PatternCheck[] = [
  // ── Security ────────────────────────────────────────────────────
  {
    category: 'security_violation',
    severity: 'critical',
    pattern: /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/,
    message: 'Hardcoded API key or private key detected',
    suggestion: 'Move to environment variable. Never commit secrets.',
  },
  {
    category: 'security_violation',
    severity: 'error',
    pattern: /eval\s*\(|new\s+Function\s*\(/,
    excludeFilter: /test|spec|\.test\./,
    message: 'eval() or new Function() — code injection risk',
    suggestion: 'Remove eval/Function. Use safe alternatives.',
  },
  {
    category: 'security_violation',
    severity: 'error',
    pattern: /innerHTML\s*=|dangerouslySetInnerHTML/,
    message: 'Direct HTML injection — XSS risk',
    suggestion: 'Use textContent or a sanitizer like DOMPurify.',
  },
  {
    category: 'security_violation',
    severity: 'error',
    pattern: /`[^`]*\$\{[^}]+\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i,
    message: 'SQL query with string interpolation — injection risk',
    suggestion: 'Use parameterized queries.',
  },
  {
    category: 'security_violation',
    severity: 'warning',
    pattern: /cors\(\s*\{?\s*origin\s*:\s*(?:true|'\*'|"\*"|`\*`)/,
    message: 'CORS allows all origins',
    suggestion: 'Restrict to specific origins in production.',
  },

  // ── AI Slop Detection ──────────────────────────────────────────
  {
    category: 'ai_slop',
    severity: 'error',
    pattern: /\/\/\s*(?:rest of|remaining|existing|other|more)\s+(?:code|implementation|logic|functions)/i,
    message: 'Stub comment — file is incomplete',
    suggestion: 'Write the complete implementation. No stubs.',
  },
  {
    category: 'ai_slop',
    severity: 'error',
    pattern: /\/\/\s*TODO|\/\/\s*FIXME|\/\/\s*HACK|\/\/\s*XXX/,
    excludeFilter: /test|spec/,
    message: 'TODO/FIXME comment — incomplete implementation',
    suggestion: 'Implement the TODO or remove the dead code.',
  },
  {
    category: 'ai_slop',
    severity: 'warning',
    pattern: /console\.log\s*\(/,
    excludeFilter: /test|spec|\.test\.|debug/,
    message: 'console.log in production code',
    suggestion: 'Use a proper logger (pino). console.log is for debugging only.',
  },
  {
    category: 'ai_slop',
    severity: 'warning',
    pattern: /Lorem ipsum|placeholder|sample text|example\.com/i,
    excludeFilter: /test|spec|\.test\.|README|\.example/,
    message: 'Placeholder content in production code',
    suggestion: 'Replace with real content or make it configurable.',
  },

  // ── Missing Patterns ───────────────────────────────────────────
  {
    category: 'missing_validation',
    severity: 'warning',
    pattern: /app\.(?:post|put|patch)\s*\([^)]*,\s*(?:async\s+)?\(?(?:req|request)/,
    fileFilter: /route|api|server/,
    message: 'POST/PUT/PATCH route without visible validation',
    suggestion: 'Add Zod schema validation for request body.',
  },

  // ── Accessibility ──────────────────────────────────────────────
  {
    category: 'accessibility',
    severity: 'warning',
    pattern: /<img\b(?![^>]*\balt\b)/,
    fileFilter: /\.tsx$|\.jsx$/,
    message: 'Image without alt attribute',
    suggestion: 'Add descriptive alt text for accessibility.',
  },
  {
    category: 'accessibility',
    severity: 'warning',
    pattern: /<button\b(?![^>]*(?:aria-label|title|children))/,
    fileFilter: /\.tsx$|\.jsx$/,
    message: 'Button without accessible label',
    suggestion: 'Add aria-label or visible text content.',
  },

  // ── Performance ────────────────────────────────────────────────
  {
    category: 'performance',
    severity: 'info',
    pattern: /await\s+.*\.find\(\s*\{[^}]*\}\s*\)(?!.*\.limit)/,
    fileFilter: /route|handler|service/,
    message: 'Database query without limit — could return unbounded results',
    suggestion: 'Add .limit() to prevent large result sets.',
  },
];

// ── Core Verification ─────────────────────────────────────────────────

/**
 * Run the full verifier against a bundle.
 * Returns a structured report the auto-fix loop can consume.
 */
export function runVerifier(bundle: OperationBundle): VerifierReport {
  const findings: VerifierFinding[] = [];
  let totalChecks = 0;
  let passedChecks = 0;

  const files = new Map(bundle.files.map((f) => [f.path, f.contents]));

  // ── Structural checks ──────────────────────────────────────────

  // Check required files
  const requiredFiles = ['package.json', 'README.md', '.env.example'];
  for (const req of requiredFiles) {
    totalChecks++;
    if (!files.has(req)) {
      findings.push({
        severity: 'error',
        category: req === 'package.json' ? 'missing_file' : req === 'README.md' ? 'missing_readme' : 'missing_env_example',
        file: null,
        line: null,
        message: `Required file missing: ${req}`,
        suggestion: `Add ${req} to the bundle.`,
      });
    } else {
      passedChecks++;
    }
  }

  // Check for server/entry point
  totalChecks++;
  const hasServer = files.has('server.js') || files.has('src/server.ts') || files.has('src/index.ts') || files.has('index.js');
  if (!hasServer) {
    findings.push({
      severity: 'critical',
      category: 'missing_file',
      file: null,
      line: null,
      message: 'No server entry point found (server.js, src/server.ts, src/index.ts)',
      suggestion: 'Create a server entry point.',
    });
  } else {
    passedChecks++;
  }

  // Check for health endpoint
  totalChecks++;
  let hasHealth = false;
  for (const [, contents] of files) {
    if (contents.includes('/health') || contents.includes("'/health'") || contents.includes('"/health"')) {
      hasHealth = true;
      break;
    }
  }
  if (!hasHealth) {
    findings.push({
      severity: 'error',
      category: 'missing_health_check',
      file: null,
      line: null,
      message: 'No /health endpoint found — required for Blaxel deploy',
      suggestion: 'Add a /health route that returns {status:"ok"}.',
    });
  } else {
    passedChecks++;
  }

  // Check for test files
  totalChecks++;
  const hasTests = Array.from(files.keys()).some((p) =>
    p.includes('test') || p.includes('spec') || p.includes('eval-suite'),
  );
  if (!hasTests) {
    findings.push({
      severity: 'warning',
      category: 'missing_tests',
      file: null,
      line: null,
      message: 'No test files found',
      suggestion: 'Add tests/ directory with at least a happy-path test.',
    });
  } else {
    passedChecks++;
  }

  // ── Pattern-based checks ───────────────────────────────────────

  for (const [path, contents] of files) {
    for (const check of PATTERNS) {
      // Apply file filter
      if (check.fileFilter && !check.fileFilter.test(path)) continue;
      if (check.excludeFilter && check.excludeFilter.test(path)) continue;

      totalChecks++;
      const match = check.pattern.exec(contents);
      if (match) {
        // Estimate line number
        const beforeMatch = contents.slice(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

        findings.push({
          severity: check.severity,
          category: check.category,
          file: path,
          line: lineNumber,
          message: check.message,
          suggestion: check.suggestion,
        });
      } else {
        passedChecks++;
      }
    }
  }

  // ── Package.json validation ────────────────────────────────────

  const pkg = files.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      totalChecks += 4;

      if (!parsed.name) {
        findings.push({ severity: 'warning', category: 'naming', file: 'package.json', line: null, message: 'Missing name field', suggestion: 'Add a name field.' });
      } else { passedChecks++; }

      if (parsed.type !== 'module') {
        findings.push({ severity: 'warning', category: 'ai_slop', file: 'package.json', line: null, message: 'Missing type:"module" — needed for ESM', suggestion: 'Add "type": "module".' });
      } else { passedChecks++; }

      if (!parsed.scripts?.start) {
        findings.push({ severity: 'error', category: 'missing_file', file: 'package.json', line: null, message: 'Missing start script', suggestion: 'Add "start": "node server.js" to scripts.' });
      } else { passedChecks++; }

      // Check for hallucinated dependencies (common AI slop)
      const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      const suspiciousDeps = Object.keys(deps).filter((d) =>
        d.includes('argo-') || d.includes('magic-') || d.startsWith('@internal/'),
      );
      if (suspiciousDeps.length > 0) {
        findings.push({
          severity: 'error',
          category: 'ai_slop',
          file: 'package.json',
          line: null,
          message: `Potentially hallucinated dependencies: ${suspiciousDeps.join(', ')}`,
          suggestion: 'Verify these packages exist on npm.',
        });
      } else { passedChecks++; }
    } catch {
      findings.push({
        severity: 'critical',
        category: 'missing_file',
        file: 'package.json',
        line: null,
        message: 'package.json is invalid JSON',
        suggestion: 'Fix the JSON syntax.',
      });
    }
  }

  // ── Import resolution check ────────────────────────────────────

  const fileSet = new Set(files.keys());
  for (const [path, contents] of files) {
    if (!path.endsWith('.ts') && !path.endsWith('.tsx') && !path.endsWith('.js') && !path.endsWith('.jsx')) continue;

    // Find relative imports
    const importRegex = /(?:import|from)\s+['"]\.\.?\/([^'"]+)['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(contents)) !== null) {
      totalChecks++;
      const importPath = importMatch[1]!;
      // Resolve relative to current file's directory
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const resolved = dir ? `${dir}/${importPath}` : importPath;

      // Check if the imported file exists (with common extensions)
      const candidates = [
        resolved,
        `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`,
        `${resolved}/index.ts`, `${resolved}/index.tsx`, `${resolved}/index.js`,
      ];

      if (!candidates.some((c) => fileSet.has(c))) {
        findings.push({
          severity: 'error',
          category: 'import_issue',
          file: path,
          line: null,
          message: `Import '${importPath}' does not resolve to any file in the bundle`,
          suggestion: `Check the import path. Available files: ${Array.from(fileSet).filter((f) => f.includes(importPath.split('/').pop() ?? '')).join(', ') || 'none matching'}`,
        });
      } else {
        passedChecks++;
      }
    }
  }

  // ── Compute score ──────────────────────────────────────────────

  const criticals = findings.filter((f) => f.severity === 'critical').length;
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  const score = Math.max(0, Math.min(100, Math.round(
    100 - (criticals * 25) - (errors * 10) - (warnings * 3),
  )));

  const passed = criticals === 0 && errors === 0;

  const summary = passed
    ? `Verifier passed with score ${score}/100. ${warnings} warning(s), ${findings.filter((f) => f.severity === 'info').length} info.`
    : `Verifier FAILED with score ${score}/100. ${criticals} critical, ${errors} error(s), ${warnings} warning(s). Fix all critical and error findings before deploy.`;

  return {
    passed,
    score,
    totalChecks,
    passedChecks,
    findings,
    summary,
  };
}

/**
 * Format verifier report for the auto-fix loop re-prompt.
 */
export function renderVerifierAsAutoFixPrompt(report: VerifierReport): string {
  if (report.passed) return '';

  const blocking = report.findings.filter((f) => f.severity === 'critical' || f.severity === 'error');
  const lines: string[] = [
    `# Verifier Report — score: ${report.score}/100. Fix ${blocking.length} blocking issue(s).`,
    '',
  ];

  for (const f of blocking) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.category}${f.file ? ` in ${f.file}` : ''}${f.line ? `:${f.line}` : ''}`);
    lines.push(`  ${f.message}`);
    if (f.suggestion) lines.push(`  → ${f.suggestion}`);
    lines.push('');
  }

  lines.push('Re-emit ONLY the affected files. End with <dyad-chat-summary>.');
  return lines.join('\n');
}
