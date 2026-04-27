// Auto-fix loop — the secret weapon. Streams GPT-5.5, parses dyad-* tags
// into a file map, runs the quality gate, and if it fails the gate, RE-PROMPTS
// the model with the structured error report. Up to MAX_CYCLES iterations.
// This is what makes Argo's output production-ready by default.

import { streamBuildWithTools, type Specialist, type ToolEvent } from '@argo/agent';
import type { OperationBundle } from '@argo/workspace-runtime';
import { applyActionsToFileMap, parseDyadResponse, type ParsedAction } from './dyad-tag-parser.js';
import { runQualityGate, type QualityReport } from './quality-gate.js';
import { BundleBuilder } from './bundle-builder.js';

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
  | { kind: 'cycle_start'; cycle: number; promptLength: number }
  | { kind: 'actions_parsed'; cycle: number; actions: ParsedAction[]; prose: string }
  | { kind: 'gate_run'; cycle: number; report: QualityReport }
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
    lastReport = report;
    const gateEvt: AutoFixCycleEvent = { kind: 'gate_run', cycle, report };
    history.push(gateEvt);
    args.onCycle?.(gateEvt);

    const completeEvt: AutoFixCycleEvent = {
      kind: 'cycle_complete',
      cycle,
      passed: report.passed,
    };
    history.push(completeEvt);
    args.onCycle?.(completeEvt);

    if (report.passed) {
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
    //   2. The current file inventory (paths only, not bodies — keeps tokens low)
    //   3. The structured error report
    userPrompt = composeRetryPrompt({
      originalPrompt: args.userPrompt,
      currentFiles: Array.from(files.keys()),
      report,
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
}): string {
  return [
    args.originalPrompt,
    '',
    '# Previous attempt failed the quality gate. Fix the errors below.',
    '',
    `Current files in the project (${args.currentFiles.length}):`,
    ...args.currentFiles.map((p) => `- ${p}`),
    '',
    args.report.autoFixPrompt,
    '',
    'Re-emit ONLY the files that need fixing using <dyad-write>. Do not',
    'touch unrelated files. Each <dyad-write> must contain the FULL new file',
    'contents (no partial diffs). End with one <dyad-chat-summary>.',
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
