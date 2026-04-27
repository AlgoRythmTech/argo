// Auto-fix loop — the secret weapon. Streams GPT-5.5, parses dyad-* tags
// into a file map, runs the quality gate, and if it fails the gate, RE-PROMPTS
// the model with the structured error report. Up to MAX_CYCLES iterations.
// This is what makes Argo's output production-ready by default.

import { streamBuildWithTools, type Specialist, type ToolEvent } from '@argo/agent';
import type { OperationBundle } from '@argo/workspace-runtime';
import { applyActionsToFileMap, parseDyadResponse, type ParsedAction } from './dyad-tag-parser.js';
import { runQualityGate, type QualityReport } from './quality-gate.js';
import { BundleBuilder } from './bundle-builder.js';
import { runTestingAgent, renderTestingReportAsAutoFixPrompt, type TestingReport } from './testing-agent.js';
import {
  runArchitect,
  runReviewer,
  renderReviewAsAutoFixPrompt,
  type FilePlan,
  type ReviewReport,
} from './multi-agent-build.js';
import { validateDependencies, renderDependencyFailures, type DependencyValidationResult } from './npm-validator.js';

export interface AutoFixArgs {
  specialist: Specialist;
  /** The user's free-text description. */
  userPrompt: string;
  /** Initial file map (e.g. seeded scaffolding). */
  initialFiles?: Map<string, string>;
  /** Operation context for the bundle manifest. */
  manifest: {
    operationId: string;
    operationSlug: string;
    bundleVersion: number;
    workflowMapVersion: number;
    requiredEnv: string[];
  };
  /**
   * Forwarded to streamBuild. When set, the agent picks reference snippets
   * + recalls operator memory and folds them into the system prompt.
   */
  augmentation?: {
    trigger?: string;
    integrations?: readonly string[];
    auth?: string;
    dataClassification?: string;
    ownerId?: string;
  };
  /** Max retry cycles. Default 3 (Section 11 doctrine). */
  maxCycles?: number;
  /**
   * When true, after the static gate passes the auto-fix loop ALSO runs
   * the runtime testing agent (boots the bundle in a child process,
   * exercises /health and a synthetic POST). Failures are folded back
   * into the next cycle's re-prompt. Default true; set false for
   * scenarios where boot would be expensive (e.g. the deterministic
   * generator path that's already proven).
   */
  enableRuntimeTesting?: boolean;
  /**
   * When true, validate every npm dependency declared in package.json
   * against registry.npmjs.org before running the runtime test. Catches
   * hallucinated packages BEFORE pnpm install fails. Default true.
   * Set false for tests / offline runs.
   */
  enableNpmValidation?: boolean;
  /**
   * Spec-as-tests. The deploy route compiles brief.successCriteria into
   * a list of runtime assertions and passes them through here. The
   * testing agent runs them after /health is green and any failure
   * forces another auto-fix cycle.
   */
  specCriteria?: import('./testing-agent.js').RunTestingAgentArgs['specCriteria'];
  /**
   * Multi-agent mode (Cursor 2026 / Replit Agent style):
   *   1. Architect produces a FilePlan from the brief.
   *   2. Builder (the streamBuild loop) consumes the plan and emits files.
   *   3. Reviewer reads the bundle + plan, produces structured findings.
   *   4. Bad findings force another builder cycle.
   *
   * Default false — the single-agent loop is fine for most builds. Flip
   * for fullstack_app / ai_agent_builder where the value of an explicit
   * plan + a reviewer-pass is highest.
   */
  multiAgent?: boolean;
  /** Per-cycle progress callback. */
  onCycle?: (event: AutoFixCycleEvent) => void;
  /**
   * Per-streamed-chunk delta callback (for SSE forwarding).
   * `totalTokens` is the cumulative token count when the provider has
   * reported one (some streams emit it only on the final chunk; others
   * emit it inline). Use it to drive a live cost meter.
   */
  onChunk?: (delta: string, fullText: string, totalTokens: number | null) => void;
  /**
   * Tool-call lifecycle events surfaced from streamBuildWithTools.
   * The build engine fires this when the model emits an <argo-tool>
   * call and again when its result lands. Useful for SSE telemetry
   * and the build UI's "fetching component from 21st.dev…" hint.
   */
  onTool?: (event: ToolEvent) => void;
  /** AbortSignal so the API route can cut the loop. */
  signal?: AbortSignal;
}

export type AutoFixCycleEvent =
  | { kind: 'architect_started' }
  | { kind: 'architect_completed'; plan: FilePlan }
  | { kind: 'cycle_start'; cycle: number; promptLength: number }
  | { kind: 'actions_parsed'; cycle: number; actions: ParsedAction[]; prose: string }
  | { kind: 'gate_run'; cycle: number; report: QualityReport }
  | { kind: 'npm_check'; cycle: number; result: DependencyValidationResult }
  | { kind: 'testing_run'; cycle: number; report: TestingReport }
  | { kind: 'reviewer_run'; cycle: number; report: ReviewReport }
  | { kind: 'cycle_complete'; cycle: number; passed: boolean }
  | { kind: 'aborted' };

export interface AutoFixResult {
  success: boolean;
  cycles: number;
  finalReport: QualityReport;
  files: Map<string, string>;
  bundle: OperationBundle | null;
  prose: string;
  newDependencies: string[];
  /** All cycle events, in order. Useful for replay + telemetry. */
  history: AutoFixCycleEvent[];
}

const DEFAULT_MAX_CYCLES = 3;

export async function runAutoFixLoop(args: AutoFixArgs): Promise<AutoFixResult> {
  const maxCycles = args.maxCycles ?? DEFAULT_MAX_CYCLES;
  const history: AutoFixCycleEvent[] = [];

  let files = args.initialFiles ? new Map(args.initialFiles) : new Map<string, string>();
  let lastReport: QualityReport | null = null;
  let lastProse = '';
  let newDependencies: string[] = [];
  let userPrompt = args.userPrompt;
  let plan: FilePlan | null = null;

  // Multi-agent mode: run the architect first to produce a FilePlan;
  // the builder consumes it as additional context.
  if (args.multiAgent) {
    const architectStarted: AutoFixCycleEvent = { kind: 'architect_started' };
    history.push(architectStarted);
    args.onCycle?.(architectStarted);
    try {
      plan = await runArchitect({
        specialist: args.specialist,
        userPrompt,
        ...(args.augmentation
          ? {
              augmentation: {
                ...(args.augmentation.integrations !== undefined ? { integrations: args.augmentation.integrations } : {}),
                ...(args.augmentation.auth !== undefined ? { auth: args.augmentation.auth } : {}),
                ...(args.augmentation.dataClassification !== undefined ? { dataClassification: args.augmentation.dataClassification } : {}),
              },
            }
          : {}),
        ...(args.signal ? { signal: args.signal } : {}),
      });
      const architectDone: AutoFixCycleEvent = { kind: 'architect_completed', plan };
      history.push(architectDone);
      args.onCycle?.(architectDone);
      // Inject the plan into the builder's user prompt so cycle 1 knows
      // exactly which files to ship.
      userPrompt = composeBuilderPromptWithPlan({ originalPrompt: userPrompt, plan });
    } catch (err) {
      // Architect failure is non-fatal — fall through to single-agent.
      console.warn('[auto-fix-loop] architect failed, continuing single-agent:', String(err).slice(0, 200));
      plan = null;
    }
  }

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (args.signal?.aborted) {
      const evt: AutoFixCycleEvent = { kind: 'aborted' };
      history.push(evt);
      args.onCycle?.(evt);
      break;
    }

    const startEvt: AutoFixCycleEvent = {
      kind: 'cycle_start',
      cycle,
      promptLength: userPrompt.length,
    };
    history.push(startEvt);
    args.onCycle?.(startEvt);

    let fullText = '';
    try {
      for await (const chunk of streamBuildWithTools({
        specialist: args.specialist,
        userPrompt,
        ...(args.augmentation
          ? {
              augmentation: {
                ...(args.augmentation.trigger !== undefined ? { trigger: args.augmentation.trigger } : {}),
                ...(args.augmentation.integrations !== undefined ? { integrations: args.augmentation.integrations } : {}),
                ...(args.augmentation.auth !== undefined ? { auth: args.augmentation.auth } : {}),
                ...(args.augmentation.dataClassification !== undefined ? { dataClassification: args.augmentation.dataClassification } : {}),
                ...(args.augmentation.ownerId !== undefined ? { ownerId: args.augmentation.ownerId } : {}),
                operationId: args.manifest.operationId,
              },
            }
          : {}),
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.onTool ? { onTool: args.onTool } : {}),
        currentFiles: files,
      })) {
        if (chunk.delta && args.onChunk) args.onChunk(chunk.delta, chunk.fullText, chunk.totalTokens);
        fullText = chunk.fullText;
        if (chunk.aborted) break;
        if (chunk.done) break;
      }
    } catch (err) {
      const failedReport: QualityReport = {
        passed: false,
        errorCount: 1,
        warnCount: 0,
        issues: [
          {
            check: 'package_json_valid',
            severity: 'error',
            file: '(stream)',
            line: null,
            message: `Stream failed: ${String(err).slice(0, 200)}`,
          },
        ],
        autoFixPrompt: `The build stream failed: ${String(err).slice(0, 200)}. Re-emit the response.`,
      };
      const completeEvt: AutoFixCycleEvent = { kind: 'cycle_complete', cycle, passed: false };
      history.push(completeEvt);
      args.onCycle?.(completeEvt);
      lastReport = failedReport;
      continue;
    }

    const parsed = parseDyadResponse(fullText);
    const parsedEvt: AutoFixCycleEvent = {
      kind: 'actions_parsed',
      cycle,
      actions: parsed.actions,
      prose: parsed.prose,
    };
    history.push(parsedEvt);
    args.onCycle?.(parsedEvt);
    lastProse = parsed.prose;

    const applied = applyActionsToFileMap(files, parsed.actions);
    files = applied.files;
    newDependencies = [...newDependencies, ...applied.newDependencies];

    const bundle = filesToBundle(files, args.manifest);
    const report = runQualityGate(bundle);

    // Fold any patch failures into the gate's autoFixPrompt so the next
    // cycle re-prompts the model with what went wrong. A patch that
    // couldn't be applied is a real bug — usually the model emitted a
    // <find> string that doesn't exist verbatim in the file.
    if (applied.patchFailures.length > 0) {
      const patchLines = ['', '## Patch failures (from this cycle\'s <dyad-patch> blocks)', ''];
      for (const f of applied.patchFailures) {
        patchLines.push(
          `- ${f.path} → ${f.reason}: "${f.findPreview}${f.findPreview.length >= 120 ? '…' : ''}"`,
        );
      }
      patchLines.push(
        '',
        'find_no_match means the <find> block does not appear verbatim in the file.',
        'find_multi_match means the <find> block matches more than once — add surrounding lines for unique context.',
        'When a patch fails, fall back to a full <dyad-write> for that file.',
      );
      // Mutate the report's autoFixPrompt directly — preserves shape for SSE.
      // (report.passed stays as-is; gate may have separately failed.)
      report.autoFixPrompt = (report.autoFixPrompt || '# Quality gate notes') + '\n' + patchLines.join('\n');
      // If only patches failed and the gate is clean, don't pass the cycle.
      const allErrors = report.issues.filter((i) => i.severity === 'error');
      if (report.passed && allErrors.length === 0) {
        report.passed = false;
        report.errorCount = applied.patchFailures.length;
      }
    }
    lastReport = report;
    const gateEvt: AutoFixCycleEvent = { kind: 'gate_run', cycle, report };
    history.push(gateEvt);
    args.onCycle?.(gateEvt);

    // NPM dependency validation: only run after the static gate is
    // clean. If a package is hallucinated, we re-prompt the model with
    // the exact bad name BEFORE wasting boot time on it.
    let npmResult: DependencyValidationResult | null = null;
    const npmValidationEnabled = args.enableNpmValidation !== false;
    if (report.passed && npmValidationEnabled) {
      try {
        npmResult = await validateDependencies(bundle, {
          ...(args.signal ? { signal: args.signal } : {}),
        });
        const npmEvt: AutoFixCycleEvent = { kind: 'npm_check', cycle, result: npmResult };
        history.push(npmEvt);
        args.onCycle?.(npmEvt);
      } catch (err) {
        // Best-effort — npm registry hiccup never fails the build.
        console.warn('[auto-fix-loop] npm validation crashed:', String(err).slice(0, 200));
      }
    }

    // Runtime testing agent: only after the static gate is clean AND
    // the npm validation didn't find hallucinations. If npm flagged
    // packages we won't waste a boot — re-prompt instead.
    let testingReport: TestingReport | null = null;
    const runtimeTestingEnabled = args.enableRuntimeTesting !== false;
    if (
      report.passed &&
      runtimeTestingEnabled &&
      (npmResult == null || npmResult.allValid)
    ) {
      try {
        testingReport = await runTestingAgent({
          bundle,
          ...(args.specCriteria ? { specCriteria: args.specCriteria } : {}),
        });
      } catch (err) {
        // If the testing agent itself crashes, surface that as a
        // failure but don't block the build — the deploy path will
        // still gate.
        testingReport = {
          passed: false,
          durationMs: 0,
          booted: false,
          routesExercised: [],
          failures: [
            { kind: 'boot_failure', message: 'testing agent crashed', tail: String(err).slice(0, 600) },
          ],
        };
      }
      const testEvt: AutoFixCycleEvent = { kind: 'testing_run', cycle, report: testingReport };
      history.push(testEvt);
      args.onCycle?.(testEvt);
    }

    // Reviewer agent (multi-agent mode only): runs ONLY when the static
    // gate AND the runtime tests are green, since the reviewer is
    // expensive and its job is "did we ship the plan?", not "does
    // the code parse." Reviewer findings can flip cyclePassed to false
    // for one more builder pass.
    let reviewReport: ReviewReport | null = null;
    if (
      args.multiAgent &&
      plan &&
      report.passed &&
      (testingReport == null || testingReport.passed)
    ) {
      try {
        reviewReport = await runReviewer({
          plan,
          files,
          ...(args.signal ? { signal: args.signal } : {}),
        });
        const reviewerEvt: AutoFixCycleEvent = { kind: 'reviewer_run', cycle, report: reviewReport };
        history.push(reviewerEvt);
        args.onCycle?.(reviewerEvt);
      } catch (err) {
        // Reviewer failure: we don't block the build — log + continue.
        console.warn('[auto-fix-loop] reviewer failed:', String(err).slice(0, 200));
      }
    }

    const cyclePassed =
      report.passed &&
      (npmResult == null || npmResult.allValid) &&
      (testingReport == null || testingReport.passed) &&
      (reviewReport == null || reviewReport.passed);
    const completeEvt: AutoFixCycleEvent = {
      kind: 'cycle_complete',
      cycle,
      passed: cyclePassed,
    };
    history.push(completeEvt);
    args.onCycle?.(completeEvt);

    if (cyclePassed) {
      return {
        success: true,
        cycles: cycle,
        finalReport: report,
        files,
        bundle,
        prose: lastProse,
        newDependencies,
        history,
      };
    }

    // Compose the re-prompt for the next cycle. The model receives:
    //   1. The original ask
    //   2. The current file inventory (paths only — keeps tokens low)
    //   3. Static-gate failures
    //   4. Runtime-testing failures (when present)
    userPrompt = composeRetryPrompt({
      originalPrompt: args.userPrompt,
      currentFiles: Array.from(files.keys()),
      report,
      ...(testingReport && !testingReport.passed
        ? { runtimeReport: renderTestingReportAsAutoFixPrompt(testingReport) }
        : {}),
      ...(reviewReport && !reviewReport.passed
        ? { reviewerReport: renderReviewAsAutoFixPrompt(reviewReport) }
        : {}),
      ...(npmResult && !npmResult.allValid
        ? { npmReport: renderDependencyFailures(npmResult.failures) }
        : {}),
    });
  }

  // All cycles exhausted without passing. Return the last attempt — the
  // caller (deploy route) can decide whether to ship it warn-only or fail.
  return {
    success: false,
    cycles: maxCycles,
    finalReport: lastReport ?? emptyReport(),
    files,
    bundle: filesToBundle(files, args.manifest),
    prose: lastProse,
    newDependencies,
    history,
  };
}

function composeRetryPrompt(args: {
  originalPrompt: string;
  currentFiles: string[];
  report: QualityReport;
  /** Optional runtime-test report when the testing agent fired and failed. */
  runtimeReport?: string;
  /** Optional reviewer report when multi-agent mode caught issues. */
  reviewerReport?: string;
  /** Optional npm validation report when packages were hallucinated. */
  npmReport?: string;
}): string {
  const lines: string[] = [
    args.originalPrompt,
    '',
    '# Previous attempt failed. Fix the errors below.',
    '',
    `Current files in the project (${args.currentFiles.length}):`,
    ...args.currentFiles.map((p) => `- ${p}`),
    '',
  ];
  if (!args.report.passed) {
    lines.push('## Static quality gate failures');
    lines.push('');
    lines.push(args.report.autoFixPrompt);
    lines.push('');
  }
  if (args.npmReport) {
    lines.push(args.npmReport);
    lines.push('');
  }
  if (args.runtimeReport) {
    lines.push('## Runtime testing failures');
    lines.push('');
    lines.push(args.runtimeReport);
    lines.push('');
  }
  if (args.reviewerReport) {
    lines.push('## Reviewer findings');
    lines.push('');
    lines.push(args.reviewerReport);
    lines.push('');
  }
  lines.push(
    'Re-emit ONLY the files that need fixing. For small fixes, prefer',
    '<dyad-patch path="..."><find>OLD</find><replace>NEW</replace></dyad-patch>',
    'over a full rewrite. For new files or major rewrites use <dyad-write>.',
    'Each <dyad-write> must contain the FULL new file contents (no partial',
    'diffs). End with one <dyad-chat-summary>.',
  );
  return lines.join('\n');
}

function composeBuilderPromptWithPlan(args: {
  originalPrompt: string;
  plan: FilePlan;
}): string {
  return [
    args.originalPrompt,
    '',
    '# Architect file plan (you are the BUILDER — implement this plan exactly)',
    '',
    `Title: ${args.plan.title}`,
    `Summary: ${args.plan.summary}`,
    '',
    '## Files to ship',
    ...args.plan.files.map((f, i) =>
      `${i + 1}. ${f.path} (${f.size}, argo:generated=${f.argoGenerated})\n` +
      `   Why: ${f.rationale}\n` +
      (f.dependsOn.length ? `   Imports from: ${f.dependsOn.join(', ')}\n` : '') +
      (f.acceptance.length ? `   Acceptance: ${f.acceptance.join(' · ')}` : ''),
    ),
    '',
    `## Dependencies to install: ${args.plan.dependencies.join(', ') || '(none)'}`,
    '',
    'Architecture:',
    '```mermaid',
    args.plan.mermaid,
    '```',
    '',
    'Implement the plan with one <dyad-write> per file. Files should match',
    'the plan paths exactly. Use <argo-tool name="sandbox_exec" command="tsc --noEmit" />',
    'after the backbone files to verify your work, then continue with frontend',
    'and tests. End with one <dyad-chat-summary>.',
  ].join('\n');
}

function filesToBundle(
  files: Map<string, string>,
  manifest: AutoFixArgs['manifest'],
): OperationBundle {
  const builder = new BundleBuilder({
    operationId: manifest.operationId,
    schemaVersion: 1,
    bundleVersion: manifest.bundleVersion,
  });
  for (const [path, contents] of files) {
    if (path === 'package.json' || path.startsWith('config/')) {
      builder.addScaffolding({ path, contents });
    } else {
      builder.addGenerated({ path, contents, sourceStepId: null });
    }
  }
  return builder.build({
    operationId: manifest.operationId,
    operationSlug: manifest.operationSlug,
    bundleVersion: manifest.bundleVersion,
    workflowMapVersion: manifest.workflowMapVersion,
    generatedByModel: process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5',
    requiredEnv: manifest.requiredEnv,
  });
}

function emptyReport(): QualityReport {
  return { passed: false, errorCount: 0, warnCount: 0, issues: [], autoFixPrompt: '' };
}
