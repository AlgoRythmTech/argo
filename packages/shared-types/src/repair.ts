import { z } from 'zod';
import { IsoDateString, ShortId } from './common.js';

/**
 * Repair classification taxonomy. The repair agent picks one of these,
 * which then constrains the prompt template selected in
 * /packages/agent/src/repair/repair-prompts.ts.
 */
export const RepairFailureKind = z.enum([
  'application_error',
  'dependency_failure',
  'data_validation_error',
  'configuration_error',
]);
export type RepairFailureKind = z.infer<typeof RepairFailureKind>;

export const RepairStatus = z.enum([
  'detected',
  'diagnosing',
  'patch_proposed',
  'patch_smaller_proposed',
  'staged',
  'tests_passed',
  'tests_failed',
  'awaiting_approval',
  'approved',
  'deployed',
  'rolled_back',
  'escalated',
  'expired',
]);
export type RepairStatus = z.infer<typeof RepairStatus>;

export const PatchedFile = z.object({
  path: z.string().min(1).max(400),
  beforeSha256: z.string().length(64),
  afterSha256: z.string().length(64),
  diffUnified: z.string(),
  reason: z.string().max(800),
});
export type PatchedFile = z.infer<typeof PatchedFile>;

/**
 * The single most important compliance artifact in the system. Never delete
 * a row, never overwrite a column. Append-only.
 */
export const OperationRepair = z.object({
  id: ShortId,
  operationId: ShortId,
  triggerEventIds: z.array(ShortId).min(1),
  failureKind: RepairFailureKind,
  status: RepairStatus,
  cycleNumber: z.number().int().min(1).max(3),
  smallerChangeForced: z.boolean().default(false),
  diagnosis: z.string().max(4000),
  plainEnglishSummary: z.string().min(1).max(800),
  whatBroke: z.string().min(1).max(400),
  whatChanged: z.string().min(1).max(800),
  whatWeTested: z.string().min(1).max(400),
  patchedFiles: z.array(PatchedFile).min(1).max(40),
  testReport: z
    .object({
      submissionPassed: z.boolean(),
      databasePassed: z.boolean(),
      emailContentPassed: z.boolean(),
      approvalSimulationPassed: z.boolean(),
      downstreamPassed: z.boolean(),
      durationMs: z.number().int().nonnegative(),
    })
    .nullable(),
  approvalToken: z.string().nullable(),
  approvalEmailedAt: IsoDateString.nullable(),
  approvedAt: IsoDateString.nullable(),
  deployedAt: IsoDateString.nullable(),
  rolledBackAt: IsoDateString.nullable(),
  createdAt: IsoDateString,
});
export type OperationRepair = z.infer<typeof OperationRepair>;
