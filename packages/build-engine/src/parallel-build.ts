/**
 * Parallel Build Orchestrator — Argo's answer to Replit Agent 4.
 *
 * Replit Agent 4 uses a Kanban-style task system where parallel sub-agents
 * build Backend, Frontend, Database, and Auth simultaneously, then merge.
 * Their conflict resolution handles 90% of cases automatically.
 *
 * Argo's approach is BETTER because we add:
 *   1. Quality gate BETWEEN merge and deploy (they don't)
 *   2. Regression testing on merged output (they don't)
 *   3. Security scanning before deploy (they don't)
 *   4. Self-verification via sandbox_exec mid-stream (they do, we match)
 *
 * Architecture:
 *   1. DECOMPOSE — Break the brief into parallel tasks (backend, frontend, db, auth, tests)
 *   2. PARALLEL BUILD — Each task gets its own streamBuild call with scoped context
 *   3. MERGE — Combine all file outputs, detect conflicts
 *   4. VERIFY — Run quality gate + security scan + tests on merged output
 *   5. RESOLVE — If conflicts exist, run a resolver agent
 *   6. SHIP — Pass to the deploy pipeline
 */

import { z } from 'zod';

// ── Task Types ────────────────────────────────────────────────────────

export type TaskCategory = 'backend' | 'frontend' | 'database' | 'auth' | 'testing' | 'config';

export const BuildTask = z.object({
  id: z.string(),
  category: z.enum(['backend', 'frontend', 'database', 'auth', 'testing', 'config']),
  title: z.string(),
  description: z.string(),
  /** Files this task is expected to produce */
  expectedFiles: z.array(z.string()),
  /** Tasks this depends on (by id) */
  dependsOn: z.array(z.string()).default([]),
  /** Priority: higher = build first */
  priority: z.number().default(0),
  status: z.enum(['pending', 'building', 'complete', 'failed', 'blocked']).default('pending'),
});
export type BuildTask = z.infer<typeof BuildTask>;

export const TaskDecomposition = z.object({
  tasks: z.array(BuildTask).min(2).max(12),
  /** Which tasks can run in parallel (groups of task IDs) */
  parallelGroups: z.array(z.array(z.string())),
  /** Architecture summary for the merge agent */
  architectureSummary: z.string(),
  /** Shared conventions (naming, patterns) all tasks must follow */
  conventions: z.array(z.string()),
});
export type TaskDecomposition = z.infer<typeof TaskDecomposition>;

// ── Decomposition Prompt ──────────────────────────────────────────────

export const DECOMPOSE_SYSTEM_PROMPT = `
You are Argo's task decomposer. Given an app description, break it into
parallel build tasks that different sub-agents can work on simultaneously.

# Rules

- Output ONLY a JSON object matching the TaskDecomposition schema.
- Each task must have a clear scope and list of expected files.
- Tasks that can run independently go in the same parallelGroup.
- Tasks that depend on others (e.g., frontend depends on API contracts
  from backend) must declare dependsOn.
- ALWAYS include these base tasks:
    1. "config" — package.json, tsconfig, .env.example, README skeleton
    2. "database" — schema, indexes, connection, migrations
    3. "backend" — server, routes, middleware, validation
    4. "frontend" — pages, components, hooks, styles (if UI needed)
    5. "auth" — authentication, sessions, RBAC (if needed)
    6. "testing" — test suite, eval cases
- Config has no dependencies and runs first.
- Database depends on config.
- Backend depends on config + database.
- Frontend depends on config + backend (needs API contracts).
- Auth can run parallel with backend.
- Testing depends on everything.

# Conventions (ALWAYS include these)

- "All API routes must be documented in a routes.md file"
- "All Zod schemas live in schema/ directory, shared between frontend and backend"
- "All environment variables documented in .env.example"
- "Server listens on PORT env var, defaults to 3000"
- "Health endpoint at /health returns {status:'ok'}"

# Quality bar

A senior engineer should look at this decomposition and say:
"Yes, these tasks are independent enough to build in parallel,
and the merge will be clean because the conventions are clear."
`.trim();

// ── Merge Logic ───────────────────────────────────────────────────────

export interface MergeResult {
  /** Combined file map from all tasks */
  files: Map<string, string>;
  /** Files that were produced by multiple tasks (potential conflicts) */
  conflicts: Array<{
    path: string;
    sources: Array<{ taskId: string; contents: string }>;
  }>;
  /** Summary of what was merged */
  summary: {
    totalFiles: number;
    fromBackend: number;
    fromFrontend: number;
    fromDatabase: number;
    fromAuth: number;
    fromTesting: number;
    fromConfig: number;
    conflictCount: number;
  };
}

/**
 * Merge file outputs from parallel tasks.
 * When two tasks produce the same file path, it's flagged as a conflict.
 * The resolver agent handles conflicts after merge.
 */
export function mergeTaskOutputs(
  taskOutputs: Array<{ taskId: string; category: TaskCategory; files: Map<string, string> }>,
): MergeResult {
  const merged = new Map<string, string>();
  const fileOwners = new Map<string, Array<{ taskId: string; contents: string }>>();

  for (const output of taskOutputs) {
    for (const [path, contents] of output.files) {
      if (!fileOwners.has(path)) {
        fileOwners.set(path, []);
      }
      fileOwners.get(path)!.push({ taskId: output.taskId, contents });
    }
  }

  const conflicts: MergeResult['conflicts'] = [];

  for (const [path, owners] of fileOwners) {
    if (owners.length === 1) {
      // No conflict — single owner
      merged.set(path, owners[0]!.contents);
    } else {
      // Conflict — multiple tasks produced this file
      // Strategy: take the LONGEST version (most complete) and flag it
      const sorted = [...owners].sort((a, b) => b.contents.length - a.contents.length);
      merged.set(path, sorted[0]!.contents);
      conflicts.push({ path, sources: owners });
    }
  }

  // Count files per category
  const counts: Record<TaskCategory, number> = {
    backend: 0, frontend: 0, database: 0, auth: 0, testing: 0, config: 0,
  };
  for (const output of taskOutputs) {
    counts[output.category] += output.files.size;
  }

  return {
    files: merged,
    conflicts,
    summary: {
      totalFiles: merged.size,
      fromBackend: counts.backend,
      fromFrontend: counts.frontend,
      fromDatabase: counts.database,
      fromAuth: counts.auth,
      fromTesting: counts.testing,
      fromConfig: counts.config,
      conflictCount: conflicts.length,
    },
  };
}

// ── Conflict Resolution Prompt ────────────────────────────────────────

export const CONFLICT_RESOLVER_SYSTEM_PROMPT = `
You are Argo's conflict resolver. Multiple build agents produced different
versions of the same file. Your job: merge them into one correct version.

# Rules

- Output the MERGED file contents using <dyad-write path="...">
- Take the best parts from each version
- Ensure imports are consistent
- Ensure no duplicate exports
- If one version is clearly more complete, prefer it
- If versions have genuinely different functionality, merge both

# Hard constraints

- The merged file must be valid TypeScript/JavaScript
- No duplicate function/variable names
- All imports must resolve to files in the bundle
- Follow the project conventions provided
`.trim();

// ── Verifier Agent ────────────────────────────────────────────────────

/**
 * The Verifier — Argo's answer to Replit's Verifier agent.
 *
 * After merge, the verifier:
 *   1. Checks every file in the plan exists in the output
 *   2. Runs tsc --noEmit via sandbox_exec
 *   3. Runs tests via sandbox_exec
 *   4. Checks for common issues (missing imports, unused vars, etc.)
 *   5. Reports a structured pass/fail
 */
export interface VerifyResult {
  passed: boolean;
  missingFiles: string[];
  typeErrors: string[];
  testFailures: string[];
  securityIssues: string[];
  suggestions: string[];
}

export function verifyMergedBundle(
  expectedFiles: string[],
  actualFiles: Map<string, string>,
): VerifyResult {
  const missing = expectedFiles.filter((f) => !actualFiles.has(f));

  // Check for common code quality issues
  const suggestions: string[] = [];
  const securityIssues: string[] = [];

  for (const [path, contents] of actualFiles) {
    // Check for console.log (should use logger)
    if (contents.includes('console.log') && !path.includes('test') && !path.includes('.test.')) {
      suggestions.push(`${path}: uses console.log — should use pino logger`);
    }

    // Check for hardcoded secrets
    if (/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}/.test(contents)) {
      securityIssues.push(`${path}: contains hardcoded API key or secret`);
    }

    // Check for raw SQL concatenation
    if (/\$\{.*\}.*SELECT|INSERT.*\$\{|UPDATE.*\$\{|DELETE.*\$\{/i.test(contents)) {
      securityIssues.push(`${path}: possible SQL injection via string interpolation`);
    }

    // Check for missing error handling in route handlers
    if (path.includes('route') && !contents.includes('catch') && !contents.includes('try')) {
      suggestions.push(`${path}: route handler has no error handling`);
    }

    // Check for incomplete implementations
    if (contents.includes('// TODO') || contents.includes('// FIXME') || contents.includes('// HACK')) {
      suggestions.push(`${path}: contains TODO/FIXME — needs completion`);
    }

    // Check for "rest of code" stubs
    if (contents.includes('// rest of') || contents.includes('// ...existing') || contents.includes('// remaining')) {
      securityIssues.push(`${path}: contains stub comment — file is incomplete`);
    }
  }

  // Check package.json exists and is valid
  const pkg = actualFiles.get('package.json');
  if (!pkg) {
    securityIssues.push('Missing package.json');
  } else {
    try {
      const parsed = JSON.parse(pkg);
      if (!parsed.name) suggestions.push('package.json: missing name field');
      if (!parsed.scripts?.start) suggestions.push('package.json: missing start script');
      if (parsed.type !== 'module') suggestions.push('package.json: should have type:"module" for ESM');
    } catch {
      securityIssues.push('package.json: invalid JSON');
    }
  }

  // Check for health endpoint
  const serverFile = actualFiles.get('server.js') ?? actualFiles.get('src/server.ts') ?? actualFiles.get('src/index.ts');
  if (serverFile && !serverFile.includes('/health')) {
    suggestions.push('Server file: missing /health endpoint — required for Blaxel deploy');
  }

  return {
    passed: missing.length === 0 && securityIssues.length === 0,
    missingFiles: missing,
    typeErrors: [], // Populated by sandbox_exec tsc --noEmit
    testFailures: [], // Populated by sandbox_exec vitest run
    securityIssues,
    suggestions,
  };
}

/**
 * Format verification results as a prompt for the builder to fix issues.
 */
export function renderVerifyResultAsPrompt(result: VerifyResult): string {
  if (result.passed && result.suggestions.length === 0) {
    return '# Verification passed — all checks green.';
  }

  const lines: string[] = ['# Verification Report — fix the issues below.\n'];

  if (result.missingFiles.length > 0) {
    lines.push('## Missing Files (BLOCKING)');
    for (const f of result.missingFiles) lines.push(`- ${f}`);
    lines.push('');
  }

  if (result.securityIssues.length > 0) {
    lines.push('## Security Issues (BLOCKING)');
    for (const issue of result.securityIssues) lines.push(`- ${issue}`);
    lines.push('');
  }

  if (result.typeErrors.length > 0) {
    lines.push('## Type Errors (BLOCKING)');
    for (const err of result.typeErrors) lines.push(`- ${err}`);
    lines.push('');
  }

  if (result.testFailures.length > 0) {
    lines.push('## Test Failures (BLOCKING)');
    for (const fail of result.testFailures) lines.push(`- ${fail}`);
    lines.push('');
  }

  if (result.suggestions.length > 0) {
    lines.push('## Suggestions (non-blocking)');
    for (const s of result.suggestions) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push('Re-emit ONLY the affected files via <dyad-write>. End with <dyad-chat-summary>.');
  return lines.join('\n');
}
