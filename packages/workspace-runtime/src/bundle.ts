import { z } from 'zod';

/**
 * The `OperationBundle` is the unit Argo's build engine emits and the
 * IExecutionProvider deploys. It is a snapshot of the customer's running
 * workflow at one version. The bundle is immutable; staging-swap deploys a
 * new bundle, never mutates an existing one.
 */

export const OperationBundleFile = z.object({
  /** Relative path within the deployment root, e.g. `src/routes/intake.ts`. */
  path: z.string().min(1).max(400),
  /** Raw file contents (utf-8). Binary attachments live in object storage. */
  contents: z.string(),
  /** Sha256 hex of contents — the deployment's content-address. */
  sha256: z.string().length(64),
  /** Whether the file is allowed to be auto-edited by the repair worker. */
  argoGenerated: z.boolean(),
  /** The step from the WorkflowMap that produced this file (null = scaffolding). */
  sourceStepId: z.string().nullable(),
});
export type OperationBundleFile = z.infer<typeof OperationBundleFile>;

export const OperationBundleManifest = z.object({
  operationId: z.string().min(8),
  operationSlug: z.string().min(3),
  bundleVersion: z.number().int().positive(),
  workflowMapVersion: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  generatedByModel: z.string(),
  /** ENV variables the bundle requires; values are injected at deploy. */
  requiredEnv: z.array(z.string()).default([]),
  /** Ports the runtime should expose. */
  ports: z
    .array(z.object({ target: z.number().int().positive(), protocol: z.enum(['HTTP', 'TCP']) }))
    .default([{ target: 3000, protocol: 'HTTP' }]),
  /** Image base — defaults to blaxel/nextjs:latest. */
  image: z.string().default('blaxel/nextjs:latest'),
  /** Memory allocation (MB). */
  memoryMb: z.number().int().positive().default(1024),
  /** Region hint. */
  region: z.string().optional(),
  /** Health-check path the deploy verifier hits. */
  healthCheckPath: z.string().default('/health'),
});
export type OperationBundleManifest = z.infer<typeof OperationBundleManifest>;

export const OperationBundle = z.object({
  manifest: OperationBundleManifest,
  files: z.array(OperationBundleFile).min(1),
});
export type OperationBundle = z.infer<typeof OperationBundle>;

export type DeploymentEnvironment = 'staging' | 'production';
