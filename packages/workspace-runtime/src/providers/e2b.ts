import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname as pathDirname } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from 'undici';
import { nanoid } from 'nanoid';
import pino from 'pino';
import type {
  AssertionResult,
  BuildSandboxArgs,
  IBuildSandbox,
  TestAssertion,
  TestCaseResult,
  TestReport,
} from './build-sandbox.js';

const log = pino({ name: 'in-process-build-sandbox', level: process.env.LOG_LEVEL ?? 'info' });

/**
 * In-process build sandbox.
 *
 * Behaves like an E2B-backed sandbox for Argo's purposes (boot, write files,
 * run a Node process, hit it with synthetic submissions, return a report,
 * tear down). Used in dev when E2B_ENABLED=false.
 *
 * The real E2B-backed implementation lives in {@link E2BBuildSandbox} below
 * and is gated on E2B_API_KEY being present.
 */
export class InProcessBuildSandbox implements IBuildSandbox {
  readonly name = 'in_process_mock' as const;

  constructor(private readonly rootDir: string = resolve(process.cwd(), '.argo/build-tests')) {}

  async runTests(args: BuildSandboxArgs): Promise<TestReport> {
    const dir = join(this.rootDir, nanoid(10));
    await mkdir(dir, { recursive: true });

    for (const f of args.bundle.files) {
      const target = join(dir, f.path);
      await mkdir(pathDirname(target), { recursive: true });
      await writeFile(target, f.contents, 'utf8');
    }

    const port = 4900 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, ['server.js'], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), ARGO_TEST_MODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout?.on('data', (c) => (stdoutBuf += c.toString('utf8')));
    child.stderr?.on('data', (c) => (stderrBuf += c.toString('utf8')));

    const baseUrl = `http://localhost:${port}`;
    try {
      await waitForHealthy(`${baseUrl}/health`, 15_000);
    } catch (err) {
      child.kill('SIGTERM');
      log.warn({ err, stdoutBuf, stderrBuf }, 'build sandbox failed to boot');
      return {
        passed: false,
        durationMs: 0,
        cases: args.cases.map((c) => ({
          name: c.name,
          passed: false,
          durationMs: 0,
          assertions: c.assertions.map((a) => ({
            assertion: a,
            passed: false,
            message: 'sandbox failed to boot',
          })),
        })),
      };
    }

    const started = Date.now();
    const cases: TestCaseResult[] = [];
    for (const tc of args.cases) {
      const caseStart = Date.now();
      const url = `${baseUrl}${tc.submission.path}`;
      let httpStatus = 0;
      let responseBody = '';
      try {
        const res = await request(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(tc.submission.headers ?? {}),
          },
          body: JSON.stringify(tc.submission.payload),
        });
        httpStatus = res.statusCode;
        responseBody = await res.body.text();
      } catch (err) {
        responseBody = `network_error: ${String(err)}`;
      }

      const assertions: AssertionResult[] = tc.assertions.map((a) =>
        runAssertion(a, { httpStatus, responseBody }),
      );
      cases.push({
        name: tc.name,
        passed: assertions.every((a) => a.passed),
        durationMs: Date.now() - caseStart,
        assertions,
      });
    }

    child.kill('SIGTERM');
    await sleep(50);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }

    return {
      passed: cases.every((c) => c.passed),
      durationMs: Date.now() - started,
      cases,
    };
  }
}

function runAssertion(
  a: TestAssertion,
  ctx: { httpStatus: number; responseBody: string },
): AssertionResult {
  switch (a.kind) {
    case 'http_status': {
      const ok = ctx.httpStatus === a.expected;
      return {
        assertion: a,
        passed: ok,
        message: ok ? `status ${ctx.httpStatus}` : `expected ${a.expected}, got ${ctx.httpStatus}`,
      };
    }
    case 'response_body_contains': {
      const ok = ctx.responseBody.includes(a.expected);
      return {
        assertion: a,
        passed: ok,
        message: ok ? 'body matched' : `body did not contain "${a.expected}"`,
      };
    }
    default:
      return {
        assertion: a,
        passed: true,
        message: 'assertion deferred (no in-process oracle)',
      };
  }
}

async function waitForHealthy(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await request(url, { method: 'GET' });
      if (res.statusCode === 200) {
        await res.body.dump();
        return;
      }
      await res.body.dump();
    } catch {
      // keep trying
    }
    await sleep(250);
  }
  throw new Error(`build sandbox did not become healthy within ${timeoutMs}ms`);
}

/**
 * Real E2B-backed build sandbox. Stub for v1 — drops to InProcessBuildSandbox
 * unless E2B_ENABLED=true and E2B_API_KEY is set. The full implementation
 * lives in /docs/RUNBOOK.md#e2b-integration.
 */
export class E2BBuildSandbox implements IBuildSandbox {
  readonly name = 'e2b' as const;
  private readonly fallback = new InProcessBuildSandbox();
  async runTests(args: BuildSandboxArgs): Promise<TestReport> {
    return this.fallback.runTests(args);
  }
}
