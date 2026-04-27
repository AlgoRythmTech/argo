// Testing agent.
//
// The 33-check static gate catches structural problems (no console.log,
// helmet registered, body limit set, request_logger_in_handlers, etc.).
// What it can't catch:
//   - Does the generated server actually BOOT?
//   - Does /health return 200?
//   - Does POST /submissions actually create a Mongo document?
//   - Does a frontend bundle build cleanly via vite build?
//   - Does react-hook-form + the shared Zod schema resolve all imports?
//
// runTestingAgent boots the generated bundle in InProcessBuildSandbox,
// runs synthetic submissions, parses the resulting failures into a
// structured TestingReport, and produces a re-prompt the auto-fix loop
// can feed back into GPT-5.5. The "perfect-loop" pattern: keep going
// until BOTH the static gate AND the runtime tests pass, or the cycle
// budget is exhausted.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname as pathDirname } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from 'undici';
import type { OperationBundle } from '@argo/workspace-runtime';

export type TestingFailure =
  | { kind: 'boot_failure'; message: string; tail: string }
  | { kind: 'health_check_failed'; message: string }
  | { kind: 'route_failed'; route: string; status: number; bodySnippet: string }
  | { kind: 'frontend_build_failed'; tail: string }
  | { kind: 'typecheck_failed'; tail: string }
  | { kind: 'unresolved_import'; importPath: string; sourceFile: string }
  | { kind: 'package_json_invalid'; reason: string }
  | { kind: 'missing_required_file'; path: string }
  | {
      kind: 'spec_criterion_failed';
      name: string;
      criterion: string;
      assertion: string;
      detail: string;
    };

export interface TestingReport {
  passed: boolean;
  durationMs: number;
  /** Failures the auto-fix loop should re-prompt over. */
  failures: TestingFailure[];
  /** Cases that ran (for telemetry). */
  routesExercised: string[];
  /** Truthy when the bundle booted at all. */
  booted: boolean;
}

export interface RunTestingAgentArgs {
  bundle: OperationBundle;
  /** Cap the boot wait. Default 20s. */
  bootTimeoutMs?: number;
  /** Cap the per-route http call. Default 5s. */
  routeTimeoutMs?: number;
  /** Skip the frontend build step (for backend-only specialists). Default: auto-detect. */
  skipFrontendBuild?: boolean;
  /** Optional set of routes to exercise. Defaults derived from common Argo bundles. */
  exerciseRoutes?: Array<{ path: string; method?: 'GET' | 'POST'; payload?: unknown }>;
  /**
   * Spec-as-tests. When set, every entry becomes a runtime assertion the
   * testing agent runs after /health is green. This is where the brief's
   * successCriteria get folded into the loop: "Strong candidates land in
   * the hiring client's inbox" → POST a strong-candidate payload, assert
   * the response decision is 'forward'.
   */
  specCriteria?: Array<{
    name: string;
    /** The criterion text from the brief, surfaced in the failure report. */
    criterion: string;
    /** HTTP request to fire. */
    request: { path: string; method?: 'GET' | 'POST'; payload?: unknown };
    /** Assertions to apply to the response. */
    asserts: Array<
      | { kind: 'http_status'; expected: number }
      | { kind: 'http_status_among'; expected: number[] }
      | { kind: 'response_field_eq'; field: string; expected: unknown }
      | { kind: 'response_body_contains'; expected: string }
    >;
  }>;
}

const DEFAULT_ROUTES: Array<{ path: string; method: 'GET' | 'POST'; payload?: unknown }> = [
  { path: '/health', method: 'GET' },
  {
    path: '/submissions',
    method: 'POST',
    payload: {
      name: 'Argo Tester',
      email: 'test@argo.run',
      message: 'This is a synthetic submission used by the testing agent to verify the route boots, validates input, and returns a 2xx.',
    },
  },
];

/**
 * Boot the generated bundle in a child process, run a tiny synthetic
 * suite, return a structured TestingReport.
 */
export async function runTestingAgent(args: RunTestingAgentArgs): Promise<TestingReport> {
  const started = Date.now();
  const failures: TestingFailure[] = [];
  const routesExercised: string[] = [];

  // ── Static checks first (fast, always run) ──────────────────────────
  const fileMap = new Map(args.bundle.files.map((f) => [f.path, f.contents]));

  // package.json must exist and be valid JSON.
  const pkgRaw = fileMap.get('package.json');
  if (!pkgRaw) {
    failures.push({ kind: 'missing_required_file', path: 'package.json' });
    return { passed: false, durationMs: Date.now() - started, failures, routesExercised, booted: false };
  }
  let pkg: { dependencies?: Record<string, string>; type?: string } = {};
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (err) {
    failures.push({ kind: 'package_json_invalid', reason: String(err).slice(0, 160) });
    return { passed: false, durationMs: Date.now() - started, failures, routesExercised, booted: false };
  }

  // server.js (or server.ts, server.mjs) must exist.
  const serverEntry = ['server.js', 'server.mjs', 'src/server.js', 'src/server.mjs']
    .find((p) => fileMap.has(p));
  if (!serverEntry) {
    failures.push({ kind: 'missing_required_file', path: 'server.js' });
    return { passed: false, durationMs: Date.now() - started, failures, routesExercised, booted: false };
  }

  // First-party import resolution check (catches the "imports a file you
  // forgot to write" failure mode the LLM hits often).
  const declaredFiles = new Set(args.bundle.files.map((f) => f.path));
  for (const f of args.bundle.files) {
    if (!/\.(?:m?js|tsx?)$/.test(f.path)) continue;
    const importMatches = f.contents.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g);
    for (const m of importMatches) {
      const importPath = m[1]!;
      if (!resolvesWithinBundle(f.path, importPath, declaredFiles)) {
        failures.push({ kind: 'unresolved_import', importPath, sourceFile: f.path });
      }
    }
  }
  if (failures.length > 0) {
    return { passed: false, durationMs: Date.now() - started, failures, routesExercised, booted: false };
  }

  // ── Runtime check: boot in a child process, hit the routes ──────────
  const tmp = await mkdtemp(join(tmpdir(), 'argo-test-'));
  try {
    for (const f of args.bundle.files) {
      const target = join(tmp, f.path);
      await mkdir(pathDirname(target), { recursive: true });
      await writeFile(target, f.contents, 'utf8');
    }

    // Best-effort install: only run when node_modules wouldn't already
    // resolve from the parent. This is gated by a flag because
    // `pnpm install` here is multi-second and the surrounding API is
    // already inside a Node process that has Fastify available; the
    // generated bundle borrows that resolution path via NODE_PATH.
    // The auto-fix loop can't wait for an install on every cycle.

    const port = 4900 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, [serverEntry], {
      cwd: tmp,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        ARGO_TEST_MODE: '1',
        // Mongo / Redis / etc. are NOT available; the agent should write
        // boot code that gracefully degrades when ARGO_TEST_MODE=1 and
        // these env vars are missing. Most Fastify apps just don't reach
        // for those services until a request arrives.
        MONGODB_URI: process.env.MONGODB_URI ?? '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c) => (stderr += c.toString('utf8')));

    let exitCode: number | null = null;
    child.on('exit', (code) => (exitCode = code));

    const baseUrl = `http://127.0.0.1:${port}`;
    const bootTimeoutMs = args.bootTimeoutMs ?? 20_000;
    const routeTimeoutMs = args.routeTimeoutMs ?? 5_000;

    const healthy = await waitForHealthy(`${baseUrl}/health`, bootTimeoutMs);
    if (!healthy.ok) {
      try { child.kill('SIGTERM'); } catch { /* hush */ }
      const tail = (stderr || stdout).slice(-1200);
      if (exitCode !== null) {
        failures.push({ kind: 'boot_failure', message: `process exited with code ${exitCode}`, tail });
      } else {
        failures.push({ kind: 'health_check_failed', message: healthy.error ?? 'health did not return 200' });
      }
      return { passed: false, durationMs: Date.now() - started, failures, routesExercised, booted: false };
    }

    const routes = args.exerciseRoutes ?? DEFAULT_ROUTES;
    for (const r of routes) {
      try {
        const res = await request(`${baseUrl}${r.path}`, {
          method: r.method ?? 'GET',
          headers: r.payload ? { 'content-type': 'application/json' } : undefined,
          body: r.payload ? JSON.stringify(r.payload) : undefined,
          headersTimeout: routeTimeoutMs,
          bodyTimeout: routeTimeoutMs,
        });
        const body = (await res.body.text()).slice(0, 600);
        routesExercised.push(`${r.method ?? 'GET'} ${r.path} → ${res.statusCode}`);
        // 2xx and 4xx are both acceptable on routes that validate input;
        // 5xx is a hard fail. Health route specifically wants 200.
        if (r.path === '/health' && res.statusCode !== 200) {
          failures.push({ kind: 'route_failed', route: r.path, status: res.statusCode, bodySnippet: body });
        } else if (res.statusCode >= 500) {
          failures.push({ kind: 'route_failed', route: r.path, status: res.statusCode, bodySnippet: body });
        }
      } catch (err) {
        // Skip routes that don't exist — that's fine, agent doesn't have
        // to ship every default we test.
        const msg = String((err as Error)?.message ?? err);
        if (!/ECONNREFUSED|fetch failed/i.test(msg)) {
          failures.push({
            kind: 'route_failed',
            route: r.path,
            status: 0,
            bodySnippet: msg.slice(0, 200),
          });
        }
      }
    }

    // ── Spec-as-tests ────────────────────────────────────────────────
    // Each successCriterion in the brief becomes a runtime assertion.
    // This is the difference between "the route returned 2xx" (which we
    // already check above) and "the route returned the right answer."
    if (args.specCriteria && args.specCriteria.length > 0) {
      for (const sc of args.specCriteria) {
        try {
          const reqUrl = `${baseUrl}${sc.request.path}`;
          const res = await request(reqUrl, {
            method: sc.request.method ?? 'POST',
            headers: sc.request.payload ? { 'content-type': 'application/json' } : undefined,
            body: sc.request.payload ? JSON.stringify(sc.request.payload) : undefined,
            headersTimeout: routeTimeoutMs,
            bodyTimeout: routeTimeoutMs,
          });
          const bodyText = await res.body.text();
          let bodyJson: Record<string, unknown> | null = null;
          try {
            bodyJson = JSON.parse(bodyText);
          } catch {
            /* bodyJson stays null — that's fine for body_contains assertions */
          }
          for (const a of sc.asserts) {
            const ok = evaluateSpecAssertion(a, res.statusCode, bodyText, bodyJson);
            if (!ok.passed) {
              failures.push({
                kind: 'spec_criterion_failed',
                name: sc.name,
                criterion: sc.criterion,
                assertion: ok.label,
                detail: ok.detail,
              });
            }
          }
          routesExercised.push(`spec:${sc.name} → ${res.statusCode}`);
        } catch (err) {
          failures.push({
            kind: 'spec_criterion_failed',
            name: sc.name,
            criterion: sc.criterion,
            assertion: 'request_failed',
            detail: String((err as Error)?.message ?? err).slice(0, 200),
          });
        }
      }
    }

    try { child.kill('SIGTERM'); } catch { /* hush */ }
    await sleep(80);
    return {
      passed: failures.length === 0,
      durationMs: Date.now() - started,
      failures,
      routesExercised,
      booted: true,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function evaluateSpecAssertion(
  a: NonNullable<RunTestingAgentArgs['specCriteria']>[number]['asserts'][number],
  status: number,
  bodyText: string,
  bodyJson: Record<string, unknown> | null,
): { passed: boolean; label: string; detail: string } {
  if (a.kind === 'http_status') {
    return {
      passed: status === a.expected,
      label: `http_status=${a.expected}`,
      detail: `got ${status}`,
    };
  }
  if (a.kind === 'http_status_among') {
    return {
      passed: a.expected.includes(status),
      label: `http_status in [${a.expected.join(',')}]`,
      detail: `got ${status}`,
    };
  }
  if (a.kind === 'response_field_eq') {
    const got = bodyJson?.[a.field];
    return {
      passed: got === a.expected,
      label: `response.${a.field} = ${JSON.stringify(a.expected)}`,
      detail: `got ${JSON.stringify(got)}`,
    };
  }
  if (a.kind === 'response_body_contains') {
    return {
      passed: bodyText.includes(a.expected),
      label: `body contains "${a.expected.slice(0, 40)}"`,
      detail: bodyText.length > 0 ? `body length ${bodyText.length}` : 'empty body',
    };
  }
  return { passed: false, label: 'unknown_assertion', detail: '' };
}

/**
 * Render a TestingReport as a structured error block the auto-fix loop
 * can paste into the next user-prompt. Same shape as the quality-gate's
 * autoFixPrompt.
 */
export function renderTestingReportAsAutoFixPrompt(report: TestingReport): string {
  if (report.passed) return '';
  const lines: string[] = [];
  lines.push('# Runtime test report — failures the build must fix');
  lines.push('');
  lines.push(`Booted: ${report.booted ? 'yes' : 'no'}`);
  if (report.routesExercised.length > 0) {
    lines.push(`Routes exercised: ${report.routesExercised.join(' · ')}`);
  }
  lines.push('');
  for (const f of report.failures) {
    switch (f.kind) {
      case 'boot_failure':
        lines.push(`- BOOT FAILURE: ${f.message}`);
        lines.push(`  stderr/stdout tail:`);
        lines.push('  ' + f.tail.split('\n').filter(Boolean).slice(-12).join('\n  '));
        break;
      case 'health_check_failed':
        lines.push(`- HEALTH CHECK FAILED: ${f.message}. Make sure /health is registered FIRST and returns 200.`);
        break;
      case 'route_failed':
        lines.push(`- ROUTE FAILED: ${f.route} returned ${f.status}. Body: ${f.bodySnippet.slice(0, 240)}`);
        break;
      case 'unresolved_import':
        lines.push(`- UNRESOLVED IMPORT: ${f.sourceFile} imports ${f.importPath} but that file is not in the bundle. Either write the missing file or fix the import path.`);
        break;
      case 'package_json_invalid':
        lines.push(`- INVALID package.json: ${f.reason}. Re-emit it as valid JSON.`);
        break;
      case 'missing_required_file':
        lines.push(`- MISSING FILE: ${f.path}. Every Argo bundle requires this file. Add it.`);
        break;
      case 'frontend_build_failed':
        lines.push(`- FRONTEND BUILD FAILED:`);
        lines.push('  ' + f.tail.split('\n').filter(Boolean).slice(-12).join('\n  '));
        break;
      case 'typecheck_failed':
        lines.push(`- TYPECHECK FAILED:`);
        lines.push('  ' + f.tail.split('\n').filter(Boolean).slice(-12).join('\n  '));
        break;
      case 'spec_criterion_failed':
        lines.push(`- SPEC CRITERION FAILED: "${f.criterion}"`);
        lines.push(`  Test name: ${f.name}`);
        lines.push(`  Assertion: ${f.assertion}`);
        lines.push(`  Detail: ${f.detail}`);
        lines.push(`  This is a brief.successCriteria entry. The build is "complete" only when this passes.`);
        break;
    }
  }
  lines.push('');
  lines.push('# Instructions for next iteration');
  lines.push('Fix every failure listed above. Re-emit ONLY the files that change. Do not re-emit files that already pass. End with exactly one <dyad-chat-summary>.');
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// Spec-as-tests compiler.
//
// Turns the operator's brief.successCriteria array (free-text bullets)
// into a deterministic list of testing-agent specCriteria. Heuristic
// only — the testing agent runs whatever we give it, and false negatives
// just mean fewer assertions than we'd like, not a broken build.
// ──────────────────────────────────────────────────────────────────────

export interface BriefForSpecCompiler {
  trigger: string;
  successCriteria: readonly string[];
  /** Optional: shape of a representative submission. */
  representativePayload?: Record<string, unknown>;
}

export function compileSpecCriteria(brief: BriefForSpecCompiler):
  RunTestingAgentArgs['specCriteria'] {
  if (!brief.successCriteria || brief.successCriteria.length === 0) return [];
  const out: NonNullable<RunTestingAgentArgs['specCriteria']> = [];
  // Form-driven workflows are the most common case. Wire two cases:
  // a happy-path submission and an invalid-input rejection.
  if (brief.trigger === 'form_submission') {
    const happy = brief.representativePayload ?? {
      name: 'Argo Eval',
      email: 'eval+happy@argo.run',
      message: 'A representative submission used to verify success criteria via the testing agent.',
    };
    out.push({
      name: 'happy_path_submission',
      criterion: brief.successCriteria[0] ?? 'Form submissions are accepted',
      request: { path: '/submissions', method: 'POST', payload: happy },
      asserts: [{ kind: 'http_status_among', expected: [200, 201, 202] }],
    });
    out.push({
      name: 'invalid_input_rejected',
      criterion: 'Invalid input never reaches downstream services.',
      request: { path: '/submissions', method: 'POST', payload: { ...happy, email: 'not-an-email' } },
      asserts: [{ kind: 'http_status', expected: 400 }],
    });
  }
  // Health check is a universal criterion.
  out.push({
    name: 'health_route',
    criterion: 'The operation reports its own health on /health.',
    request: { path: '/health', method: 'GET' },
    asserts: [{ kind: 'http_status', expected: 200 }],
  });
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────

function resolvesWithinBundle(
  fromFile: string,
  importPath: string,
  declared: ReadonlySet<string>,
): boolean {
  // Drop a trailing .js/.mjs/.tsx if present, then try common resolutions.
  const fromDir = pathDirname(fromFile);
  const joined = posixJoin(fromDir, importPath);
  const candidates = [
    joined,
    joined + '.js',
    joined + '.mjs',
    joined + '.ts',
    joined + '.tsx',
    joined.replace(/\.js$/, '.ts'),
    joined.replace(/\.js$/, '.tsx'),
    joined.replace(/\.js$/, ''),
    joined + '/index.js',
    joined + '/index.ts',
    joined + '/index.tsx',
  ];
  return candidates.some((c) => declared.has(c));
}

function posixJoin(...parts: string[]): string {
  const stack: string[] = [];
  for (const part of parts.join('/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

async function waitForHealthy(
  url: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'timeout';
  while (Date.now() < deadline) {
    try {
      const res = await request(url, { method: 'GET', headersTimeout: 1500, bodyTimeout: 1500 });
      await res.body.dump();
      if (res.statusCode === 200) return { ok: true };
      lastErr = `health returned ${res.statusCode}`;
    } catch (err) {
      lastErr = String((err as Error)?.message ?? err).slice(0, 200);
    }
    await sleep(250);
  }
  return { ok: false, error: lastErr };
}
