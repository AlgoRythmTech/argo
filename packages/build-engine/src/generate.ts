import type { WorkflowMap } from '@argo/shared-types';
import type { OperationBundle } from '@argo/workspace-runtime';
import { BundleBuilder } from './bundle-builder.js';
import {
  generateApprovalRoute,
  generateFormRoute,
  generateMongoIndexes,
  generateObservabilitySidecar,
  generateScheduler,
  generateZodSubmissionSchema,
  generateTemplatesSeedJson,
  scaffoldHealthRoute,
  scaffoldInternalRoute,
  scaffoldMongoLib,
  scaffoldPackageJson,
  scaffoldServerEntry,
} from './generators/index.js';
import { validateBundle } from './validators/index.js';

/**
 * Section 10: code generation in this strict order:
 *   database schema → form endpoint → email templates → approval routing
 *   → scheduling jobs → observability sidecar config.
 *
 * The order is load-bearing; downstream files reference upstream ones. The
 * generator is purely deterministic given a WorkflowMap — no LLM calls in
 * this function. (LLM-driven generators for individual file CONTENTS live
 * in /packages/agent under the building_generate_file kind, and are
 * invoked by /apps/api workers when the operator opts into AI-augmented
 * generation per file.)
 */
export type GenerateBundleArgs = {
  operationId: string;
  operationSlug: string;
  bundleVersion: number;
  workflowMapVersion: number;
  generatedByModel: string;
  map: WorkflowMap;
};

export type GenerateBundleResult =
  | { ok: true; bundle: OperationBundle }
  | { ok: false; reason: string; issues: string[] };

export function generateBundle(args: GenerateBundleArgs): GenerateBundleResult {
  const builder = new BundleBuilder({
    operationId: args.operationId,
    schemaVersion: 1,
    bundleVersion: args.bundleVersion,
  });

  // ── Scaffolding (NOT argo:generated) ──────────────────────────────────
  builder.addScaffolding({ path: 'package.json', contents: scaffoldPackageJson(args.map) });
  builder.addScaffolding({ path: 'server.js', contents: scaffoldServerEntry() });
  builder.addScaffolding({ path: 'lib/mongo.js', contents: scaffoldMongoLib() });
  builder.addScaffolding({ path: 'routes/health.js', contents: scaffoldHealthRoute() });
  builder.addScaffolding({ path: 'routes/internal.js', contents: scaffoldInternalRoute() });

  // ── Database schema ───────────────────────────────────────────────────
  builder.addGenerated({
    path: 'schema/submission.js',
    contents: generateZodSubmissionSchema(args.map),
    sourceStepId: 'validate',
  });
  builder.addGenerated({
    path: 'schema/indexes.js',
    contents: generateMongoIndexes(args.map),
    sourceStepId: 'persist',
  });

  // ── Form endpoint ─────────────────────────────────────────────────────
  builder.addGenerated({
    path: 'routes/form.js',
    contents: generateFormRoute(args.map),
    sourceStepId: 'trigger',
  });

  // ── Email templates seed ──────────────────────────────────────────────
  builder.addGenerated({
    path: 'config/templates.seed.json',
    contents: generateTemplatesSeedJson(args.map),
    sourceStepId: 'draft',
  });

  // ── Approval routing ──────────────────────────────────────────────────
  builder.addGenerated({
    path: 'routes/approval.js',
    contents: generateApprovalRoute(args.map),
    sourceStepId: 'approval',
  });

  // ── Scheduling ────────────────────────────────────────────────────────
  builder.addGenerated({
    path: 'jobs/scheduler.js',
    contents: generateScheduler(args.map),
    sourceStepId: 'digest',
  });

  // ── Observability sidecar ─────────────────────────────────────────────
  builder.addGenerated({
    path: 'observability/sidecar.js',
    contents: generateObservabilitySidecar(args.map),
    sourceStepId: null,
  });

  const bundle = builder.build({
    operationId: args.operationId,
    operationSlug: args.operationSlug,
    bundleVersion: args.bundleVersion,
    workflowMapVersion: args.workflowMapVersion,
    generatedByModel: args.generatedByModel,
    requiredEnv: [
      'ARGO_OPERATION_ID',
      'ARGO_CONTROL_PLANE_URL',
      'INTERNAL_API_KEY',
      'MONGODB_URI',
    ],
    image: 'blaxel/nextjs:latest',
    memoryMb: 1024,
    ports: [{ target: 3000, protocol: 'HTTP' }],
  });

  const validation = validateBundle(bundle);
  if (!validation.ok) {
    return { ok: false, reason: 'validation_failed', issues: validation.issues };
  }

  return { ok: true, bundle };
}
