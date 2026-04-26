import { z } from 'zod';
import { EmailAddress, IsoDateString, ShortId, Slug, TimeZone, Url } from './common.js';

export const OperationStatus = z.enum([
  'draft',
  'mapping',
  'awaiting_user_confirmation',
  'building',
  'testing',
  'deploying',
  'running',
  'paused',
  'failed_build',
  'archived',
]);
export type OperationStatus = z.infer<typeof OperationStatus>;

export const OperationSummary = z.object({
  id: ShortId,
  slug: Slug,
  name: z.string().min(3).max(80),
  ownerId: ShortId,
  ownerEmail: EmailAddress,
  status: OperationStatus,
  publicUrl: Url.nullable(),
  pendingApprovals: z.number().int().nonnegative().default(0),
  submissionsToday: z.number().int().nonnegative().default(0),
  lastEventAt: IsoDateString.nullable(),
  timezone: TimeZone,
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type OperationSummary = z.infer<typeof OperationSummary>;

export const OperationBundleVersion = z.object({
  id: ShortId,
  operationId: ShortId,
  version: z.number().int().positive(),
  workflowMapVersion: z.number().int().positive(),
  files: z.array(
    z.object({
      path: z.string(),
      sha256: z.string().length(64),
      size: z.number().int().nonnegative(),
      kind: z.enum([
        'schema',
        'route',
        'template',
        'job',
        'sidecar',
        'config',
        'package',
      ]),
      sourceStepId: z.string().nullable(),
    }),
  ),
  generatedAt: IsoDateString,
  generatedByModel: z.string(),
  testReportPath: z.string().nullable(),
});
export type OperationBundleVersion = z.infer<typeof OperationBundleVersion>;

export const ActivityFeedEntry = z.object({
  id: ShortId,
  operationId: ShortId.nullable(),
  operationName: z.string().nullable(),
  kind: z.string(),
  message: z.string(),
  occurredAt: IsoDateString,
});
export type ActivityFeedEntry = z.infer<typeof ActivityFeedEntry>;

export const Submission = z.object({
  id: ShortId,
  operationId: ShortId,
  receivedAt: IsoDateString,
  source: z.enum(['form', 'email', 'scheduled']),
  payload: z.record(z.string(), z.unknown()),
  classification: z
    .object({
      label: z.string(),
      confidence: z.number().min(0).max(1),
      criteriaMatched: z.array(z.string()),
      criteriaMissed: z.array(z.string()),
    })
    .nullable(),
  approvalId: ShortId.nullable(),
  status: z.enum(['received', 'classified', 'awaiting_approval', 'approved', 'declined', 'sent']),
});
export type Submission = z.infer<typeof Submission>;
