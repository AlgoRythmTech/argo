import { z } from 'zod';
import { IsoDateString, ShortId, Url } from './common.js';

export const DeploymentEnvironment = z.enum(['staging', 'production']);
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironment>;

export const DeploymentHandle = z.object({
  provider: z.enum(['blaxel', 'docker_mock']),
  environment: DeploymentEnvironment,
  sandboxName: z.string().min(1).max(120),
  sandboxId: z.string().min(1).max(120),
  region: z.string().max(40).optional(),
  publicUrl: Url,
  internalEndpoint: Url.optional(),
  ports: z.array(
    z.object({ target: z.number().int().positive(), protocol: z.enum(['HTTP', 'TCP']) }),
  ),
  createdAt: IsoDateString,
});
export type DeploymentHandle = z.infer<typeof DeploymentHandle>;

export const RuntimeEventSeverity = z.enum(['info', 'warn', 'error', 'critical']);
export type RuntimeEventSeverity = z.infer<typeof RuntimeEventSeverity>;

export const RuntimeEventKind = z.enum([
  'http_request',
  'http_5xx',
  'unhandled_exception',
  'memory_threshold',
  'process_restart',
  'job_start',
  'job_complete',
  'job_failed',
  'email_sent',
  'email_bounced',
  'submission_received',
  'approval_granted',
  'approval_declined',
  'approval_expired',
  'self_heal_proposed',
  'self_heal_approved',
  'self_heal_deployed',
  'self_heal_rolled_back',
]);
export type RuntimeEventKind = z.infer<typeof RuntimeEventKind>;

export const RuntimeEvent = z.object({
  id: ShortId,
  operationId: ShortId,
  deploymentId: ShortId,
  kind: RuntimeEventKind,
  severity: RuntimeEventSeverity,
  message: z.string().min(1).max(2000),
  context: z.record(z.string(), z.unknown()).default({}),
  stackTrace: z.string().nullable(),
  stepId: z.string().nullable(),
  occurredAt: IsoDateString,
  ingestedAt: IsoDateString,
  processedAt: IsoDateString.nullable(),
});
export type RuntimeEvent = z.infer<typeof RuntimeEvent>;

export const LogLine = z.object({
  timestamp: IsoDateString,
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  source: z.string(),
});
export type LogLine = z.infer<typeof LogLine>;
