import type { OperationBundle } from '../bundle.js';

/**
 * IBuildSandbox — the test-time sandbox interface, separate from
 * IExecutionProvider.
 *
 * Section 13.5: "Argo's runtime executes in Blaxel — that's locked from v3
 * and remains correct. But when the BUILDING-phase forked code (lifted from
 * Open Lovable) needs to test a generated workflow before deploying it to
 * Blaxel, you need a fast ephemeral sandbox to run the synthetic submission
 * test. Use E2B for this [...] Two sandboxes — one for testing during BUILD,
 * one for production execution during RUN — and they are different products
 * solving different problems. Don't conflate them."
 *
 * The build sandbox boots quickly, runs synthetic-submission tests, returns
 * a TestReport, and is destroyed. Nothing about the build sandbox is
 * load-bearing in production.
 */

export type SyntheticSubmission = {
  /** The name of the assertion this submission exercises. */
  name: string;
  /** The HTTP path inside the sandbox to POST to. */
  path: string;
  /** The submission body. */
  payload: Record<string, unknown>;
  /** Optional headers (signed webhooks, etc.). */
  headers?: Record<string, string>;
};

export type TestAssertion =
  | { kind: 'http_status'; expected: number }
  | { kind: 'response_body_contains'; expected: string }
  | { kind: 'mongo_document_exists'; collection: string; query: Record<string, unknown> }
  | { kind: 'email_drafted'; toContains?: string; subjectContains?: string }
  | { kind: 'approval_token_created' };

export type TestCase = {
  name: string;
  submission: SyntheticSubmission;
  assertions: TestAssertion[];
};

export type AssertionResult = {
  assertion: TestAssertion;
  passed: boolean;
  message: string;
};

export type TestCaseResult = {
  name: string;
  passed: boolean;
  durationMs: number;
  assertions: AssertionResult[];
};

export type TestReport = {
  passed: boolean;
  durationMs: number;
  cases: TestCaseResult[];
};

export type BuildSandboxArgs = {
  bundle: OperationBundle;
  cases: TestCase[];
  /** Timeout for the entire test run. Default 120s. */
  timeoutMs?: number;
};

export interface IBuildSandbox {
  readonly name: 'e2b' | 'in_process_mock';
  runTests(args: BuildSandboxArgs): Promise<TestReport>;
}
