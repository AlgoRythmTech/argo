import { z } from 'zod';
import { buildContextEnvelope } from '../envelope.js';
import { runInvocation, type InvocationStore } from '../invocation.js';
import type { LlmRouter } from '../llm/router.js';
import type { RepairFailureKind } from '@argo/shared-types';
import { constraintsFor } from './repair-prompts.js';

export const RepairPatch = z.object({
  failureKind: z.enum([
    'application_error',
    'dependency_failure',
    'data_validation_error',
    'configuration_error',
  ]),
  diagnosis: z.string().min(20).max(4000),
  whatBroke: z.string().min(5).max(400),
  whatChanged: z.string().min(5).max(800),
  whatWeTested: z.string().min(5).max(400),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        replacement: z.string(),
        reason: z.string().min(5).max(400),
      }),
    )
    .min(1)
    .max(20),
});
export type RepairPatch = z.infer<typeof RepairPatch>;

/**
 * Asks the model to propose a patch given the failing files, stack trace,
 * and the request payload that triggered the failure.
 */
export async function proposeRepairPatch(
  router: LlmRouter,
  store: InvocationStore,
  args: {
    operationId: string;
    ownerId: string;
    operationName: string;
    triggerKind: string;
    audience: string;
    outcome: string;
    failureKind: RepairFailureKind;
    failingFiles: Array<{ path: string; contents: string }>;
    stackTrace: string;
    requestPayload: unknown;
    smallerChange: boolean;
    recentEvents: Array<{ timestamp: string; kind: string; summary: string }>;
  },
) {
  const envelope = buildContextEnvelope({
    operationId: args.operationId,
    operationName: args.operationName,
    triggerKind: args.triggerKind,
    audience: args.audience,
    outcome: args.outcome,
    recentEvents: args.recentEvents,
    triggerPayload: {
      failureKind: args.failureKind,
      stackTrace: args.stackTrace.slice(0, 2000),
      requestPayload: args.requestPayload,
      failingFiles: args.failingFiles.map((f) => ({
        path: f.path,
        contents: f.contents.slice(0, 8000),
      })),
    },
    relevantTemplate: null,
    voiceCorpus: [],
    task: `Diagnose the failure and propose a patch. Return one entry in files[] per file you change. The replacement is the FULL new file contents — not a diff. Plain English in whatBroke / whatChanged / whatWeTested for the user-facing email.`,
    schemaName: 'RepairPatch',
    constraints: constraintsFor(args.failureKind, args.smallerChange),
  });

  return runInvocation(router, store, {
    state: 'TESTING',
    kind: args.smallerChange ? 'repair_propose_smaller_patch' : 'repair_propose_patch',
    operationId: args.operationId,
    ownerId: args.ownerId,
    envelope,
    schema: RepairPatch,
  });
}
