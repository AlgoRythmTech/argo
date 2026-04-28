import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  runAutoFixLoop,
  analyzeFileImpact,
  renderImpactAsPromptSection,
  type AutoFixCycleEvent,
} from '@argo/build-engine';
import {
  pickSpecialist,
} from '@argo/agent';
import {
  createExecutionProvider,
  type OperationBundle,
} from '@argo/workspace-runtime';
import { runTestingAgent, type TestingReport } from '@argo/build-engine';
import type { ProjectBrief } from '@argo/shared-types';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { broadcastToOwner } from '../realtime/socket.js';
import { logger } from '../logger.js';

const executionProvider = createExecutionProvider();

const IterateBody = z.object({
  operationId: z.string(),
  /** What the user wants to change. Natural language. */
  instruction: z.string().min(5).max(4000),
  /**
   * Strategy:
   *   - 'surgical'  (default) — patch only the affected files, run regression tests
   *   - 'rebuild'   — regenerate the entire bundle with the instruction as context
   *   - 'auto'      — let Argo decide based on the instruction complexity
   */
  strategy: z.enum(['surgical', 'rebuild', 'auto']).default('auto'),
});

/**
 * POST /api/operations/iterate
 *
 * THE feature that makes Argo different from every other vibe coding tool.
 *
 * When users say "change the email template" or "add a phone field",
 * Replit/Lovable regenerate chunks and pray. Argo:
 *
 *   1. Loads the EXISTING deployed bundle (every file, every byte)
 *   2. Analyzes which files the instruction affects
 *   3. Runs tests BEFORE the change to establish a baseline
 *   4. Makes targeted changes via the auto-fix loop (surgical mode)
 *      or rebuilds with full context (rebuild mode)
 *   5. Runs tests AFTER the change
 *   6. Compares: if any previously-passing test now fails → REGRESSION
 *   7. If regression detected, shows the diff and asks user to confirm
 *   8. If clean, deploys automatically
 *
 * This is why users won't give up after 10 days with Argo.
 */
export async function registerIterateRoutes(app: FastifyInstance) {
  app.post('/api/operations/iterate', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = IterateBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const op = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    if (op.status !== 'running' && op.status !== 'awaiting_user_confirmation') {
      return reply.code(409).send({ error: 'not_editable', status: op.status });
    }

    const { db } = await getMongo();

    // ── 1. Load existing bundle ──────────────────────────────────────
    const bundleDoc = await db
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!bundleDoc) {
      return reply.code(409).send({ error: 'no_bundle', message: 'Deploy the operation first before iterating.' });
    }
    const existingFiles = (bundleDoc.files ?? []) as Array<{
      path: string;
      contents: string;
      sha256: string;
      argoGenerated: boolean;
    }>;
    if (existingFiles.length === 0) {
      return reply.code(409).send({ error: 'empty_bundle' });
    }

    // Build a file map from the existing bundle.
    const existingFileMap = new Map<string, string>();
    for (const f of existingFiles) {
      existingFileMap.set(f.path, f.contents);
    }

    // ── 2. Load the brief for context ─────────────────────────────────
    const briefDoc = await db
      .collection('project_briefs')
      .find({ operationId: op.id })
      .sort({ persistedAt: -1 })
      .limit(1)
      .next();

    // ── 3. Determine strategy ─────────────────────────────────────────
    let strategy = parsed.data.strategy;
    if (strategy === 'auto') {
      strategy = classifyEditComplexity(parsed.data.instruction, existingFiles.length);
    }

    // ── 4. Run baseline tests (before change) ─────────────────────────
    broadcastToOwner(session.userId, {
      type: 'deploy_progress',
      operationId: op.id,
      evt: { phase: 'creating_sandbox', message: 'Running baseline tests before change…' },
    });

    let baselineReport: TestingReport | null = null;
    try {
      const baselineBundle = reconstructBundle(existingFiles, {
        operationId: op.id,
        operationSlug: op.slug,
        bundleVersion: bundleDoc.version as number,
      });
      baselineReport = await runTestingAgent({ bundle: baselineBundle, bootTimeoutMs: 25_000 });
    } catch (err) {
      logger.warn({ err }, 'baseline test run failed — proceeding without regression guard');
    }

    const baselinePassedRoutes = new Set(
      baselineReport?.routesExercised
        .filter((r) => !r.includes('500') && !r.includes('→ 0'))
        .map((r) => r.split('→')[0]!.trim()) ?? [],
    );

    // ── 5. Build the iteration prompt ─────────────────────────────────
    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'building' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'building' });

    const brief = briefDoc as unknown as ProjectBrief | null;
    const specialist = pickSpecialist({
      archetype: 'form_workflow',
      triggerKind: brief?.trigger ?? 'form_submission',
      description: parsed.data.instruction,
    });

    // File impact analysis: predict which files the instruction affects.
    // This dramatically reduces the risk of the AI touching wrong files
    // (pain point #2 from user research across all competitors).
    const impacts = analyzeFileImpact(
      parsed.data.instruction,
      Array.from(existingFileMap.entries()),
    );
    const impactSection = renderImpactAsPromptSection(impacts);

    const iterationPrompt = composeIterationPrompt({
      instruction: parsed.data.instruction,
      existingFiles: Array.from(existingFileMap.entries()),
      brief,
      strategy,
      impactSection,
    });

    const bundleVersion = (op.bundleVersion ?? 0) + 1;

    // ── 6. Run the auto-fix loop with the existing files as seed ──────
    let result;
    try {
      result = await runAutoFixLoop({
        specialist,
        userPrompt: iterationPrompt,
        initialFiles: existingFileMap,
        manifest: {
          operationId: op.id,
          operationSlug: op.slug,
          bundleVersion,
          workflowMapVersion: op.workflowMapVersion ?? 1,
          requiredEnv: ['ARGO_OPERATION_ID', 'ARGO_CONTROL_PLANE_URL', 'INTERNAL_API_KEY', 'MONGODB_URI'],
        },
        augmentation: brief ? {
          trigger: brief.trigger,
          integrations: brief.integrations,
          auth: brief.auth,
          dataClassification: brief.dataClassification,
          ownerId: session.userId,
        } : { ownerId: session.userId },
        multiAgent: false, // Iterations are always single-agent — faster, more targeted.
        maxCycles: 3,
        onCycle: (evt: AutoFixCycleEvent) => {
          broadcastToOwner(session.userId, { type: 'deploy_progress', operationId: op.id, evt });
        },
      });
    } catch (err) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'running' } });
      logger.error({ err }, 'iteration auto-fix loop crashed');
      return reply.code(500).send({ error: 'iteration_failed', detail: String(err).slice(0, 400) });
    }

    if (!result.success || !result.bundle) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'running' } });
      return reply.code(422).send({
        error: 'iteration_failed',
        cycles: result.cycles,
        issues: result.finalReport.issues.slice(0, 25),
      });
    }

    // ── 7. Run post-change tests ──────────────────────────────────────
    broadcastToOwner(session.userId, {
      type: 'deploy_progress',
      operationId: op.id,
      evt: { phase: 'health_check', message: 'Running regression tests…' },
    });

    let postReport: TestingReport | null = null;
    try {
      postReport = await runTestingAgent({ bundle: result.bundle, bootTimeoutMs: 25_000 });
    } catch (err) {
      logger.warn({ err }, 'post-change test run failed');
    }

    // ── 8. Regression detection ───────────────────────────────────────
    const regressions: string[] = [];
    if (baselineReport && postReport) {
      const postPassedRoutes = new Set(
        postReport.routesExercised
          .filter((r) => !r.includes('500') && !r.includes('→ 0'))
          .map((r) => r.split('→')[0]!.trim()),
      );
      for (const route of baselinePassedRoutes) {
        if (!postPassedRoutes.has(route)) {
          regressions.push(route);
        }
      }
    }

    // ── 9. Compute diff ───────────────────────────────────────────────
    const diff = computeBundleDiff(existingFileMap, result.files);

    // ── 10. Deploy or warn ────────────────────────────────────────────
    if (regressions.length > 0) {
      // Regression detected — don't deploy, warn user.
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'running' } });

      const activity = await appendActivity({
        ownerId: session.userId,
        operationId: op.id,
        operationName: op.name,
        kind: 'iteration_regression',
        message: `Iteration blocked — ${regressions.length} regression(s) detected: ${regressions.join(', ')}`,
      });
      broadcastToOwner(session.userId, { type: 'activity', payload: activity });

      return reply.send({
        ok: false,
        regression: true,
        regressions,
        diff,
        cycles: result.cycles,
        message: `${regressions.length} route(s) that were passing before now fail. Review the diff and confirm to force-deploy, or refine your instruction.`,
      });
    }

    // No regression — deploy.
    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'deploying' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'deploying' });

    // Persist the new bundle.
    await db.collection('operation_bundles').insertOne({
      operationId: op.id,
      version: bundleVersion,
      manifest: result.bundle.manifest,
      files: result.bundle.files.map((f) => ({
        path: f.path,
        contents: f.contents,
        sha256: f.sha256,
        argoGenerated: f.argoGenerated,
        sourceStepId: f.sourceStepId,
        size: f.contents.length,
      })),
      filesSummary: result.bundle.files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        argoGenerated: f.argoGenerated,
        size: f.contents.length,
      })),
      generatedByModel: process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5',
      aiCycles: result.cycles,
      iteratedFrom: bundleDoc.version,
      iterationInstruction: parsed.data.instruction,
      createdAt: new Date().toISOString(),
    });

    // Deploy to Blaxel.
    let handle;
    try {
      handle = await executionProvider.deploy({
        operationId: op.id,
        bundle: result.bundle,
        environment: 'production',
        envOverrides: {
          ARGO_CONTROL_PLANE_URL: process.env.API_PUBLIC_URL ?? 'http://host.docker.internal:4000',
          INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? '',
          MONGODB_URI: process.env.MONGODB_URI ?? '',
          MONGODB_DB: `argo_op_${op.id}`,
        },
        onProgress: (evt) => {
          broadcastToOwner(session.userId, { type: 'deploy_progress', operationId: op.id, evt });
        },
      });
    } catch (err) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'running' } });
      return reply.code(502).send({ error: 'deploy_failed', detail: String(err).slice(0, 400) });
    }

    await getPrisma().operation.update({
      where: { id: op.id },
      data: {
        status: 'running',
        publicUrl: handle.publicUrl,
        bundleVersion,
        deploymentProvider: handle.provider,
        deploymentSandboxId: handle.sandboxId,
        deploymentRegion: handle.region,
        lastEventAt: new Date(),
      },
    });

    const activity = await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'iterated',
      message: `Iteration shipped (v${bundleVersion}): "${parsed.data.instruction.slice(0, 80)}" — ${diff.modified} file(s) changed, ${diff.added} added.`,
    });
    broadcastToOwner(session.userId, { type: 'activity', payload: activity });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'running' });

    return reply.send({
      ok: true,
      regression: false,
      regressions: [],
      diff,
      bundleVersion,
      publicUrl: handle.publicUrl,
      cycles: result.cycles,
    });
  });

  /**
   * POST /api/operations/iterate/force
   *
   * Force-deploy an iteration that was blocked by regression detection.
   * The user reviewed the diff and decided to proceed anyway.
   */
  app.post('/api/operations/iterate/force', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = z.object({ operationId: z.string() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

    // The pending iteration bundle is the latest version in operation_bundles.
    const op = await getPrisma().operation.findFirst({
      where: { id: body.data.operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db: mongoDB } = await getMongo();
    const latestBundle = await mongoDB
      .collection('operation_bundles')
      .find({ operationId: op.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!latestBundle) return reply.code(409).send({ error: 'no_bundle' });

    // If the latest bundle version is already deployed, nothing to force.
    if ((latestBundle.version as number) <= (op.bundleVersion ?? 0)) {
      return reply.code(409).send({ error: 'already_deployed' });
    }

    // Reconstruct the bundle and deploy.
    const files = (latestBundle.files ?? []) as Array<{
      path: string;
      contents: string;
      sha256: string;
      argoGenerated: boolean;
    }>;
    const bundle = reconstructBundle(files, {
      operationId: op.id,
      operationSlug: op.slug,
      bundleVersion: latestBundle.version as number,
    });

    await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'deploying' } });
    broadcastToOwner(session.userId, { type: 'operation_status', operationId: op.id, status: 'deploying' });

    let handle;
    try {
      handle = await executionProvider.deploy({
        operationId: op.id,
        bundle,
        environment: 'production',
        envOverrides: {
          ARGO_CONTROL_PLANE_URL: process.env.API_PUBLIC_URL ?? 'http://host.docker.internal:4000',
          INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? '',
          MONGODB_URI: process.env.MONGODB_URI ?? '',
          MONGODB_DB: `argo_op_${op.id}`,
        },
        onProgress: (evt) => {
          broadcastToOwner(session.userId, { type: 'deploy_progress', operationId: op.id, evt });
        },
      });
    } catch (err) {
      await getPrisma().operation.update({ where: { id: op.id }, data: { status: 'running' } });
      return reply.code(502).send({ error: 'deploy_failed', detail: String(err).slice(0, 400) });
    }

    await getPrisma().operation.update({
      where: { id: op.id },
      data: {
        status: 'running',
        publicUrl: handle.publicUrl,
        bundleVersion: latestBundle.version as number,
        deploymentProvider: handle.provider,
        deploymentSandboxId: handle.sandboxId,
        deploymentRegion: handle.region,
        lastEventAt: new Date(),
      },
    });

    const activity = await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'force_deployed',
      message: `Force-deployed v${latestBundle.version} despite regression warning.`,
    });
    broadcastToOwner(session.userId, { type: 'activity', payload: activity });

    return reply.send({
      ok: true,
      bundleVersion: latestBundle.version,
      publicUrl: handle.publicUrl,
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Classify whether an instruction needs surgical patches or a full rebuild.
 * Surgical is faster and safer. Rebuild is necessary for structural changes.
 */
function classifyEditComplexity(
  instruction: string,
  fileCount: number,
): 'surgical' | 'rebuild' {
  const lower = instruction.toLowerCase();

  // Structural changes that need a rebuild.
  const rebuildKeywords = [
    'add authentication', 'add auth', 'add oauth', 'add login',
    'add database', 'add postgres', 'switch to',
    'add billing', 'add stripe', 'add payments',
    'add websocket', 'add real-time', 'add realtime',
    'rewrite', 'rebuild', 'start over', 'from scratch',
    'add admin panel', 'add dashboard',
    'change framework', 'migrate to',
  ];
  if (rebuildKeywords.some((kw) => lower.includes(kw))) return 'rebuild';

  // Small bundles (<12 files) can afford a rebuild.
  if (fileCount < 12) return 'rebuild';

  // Everything else is surgical.
  return 'surgical';
}

/**
 * Compose the prompt for an iteration. The key insight: we give the model
 * the FULL existing codebase as context, then ask it to make TARGETED changes.
 * This prevents the "regenerate everything" trap that ruins other tools.
 */
function composeIterationPrompt(args: {
  instruction: string;
  existingFiles: Array<[string, string]>;
  brief: ProjectBrief | null;
  strategy: 'surgical' | 'rebuild';
  impactSection?: string;
}): string {
  const lines: string[] = [];

  lines.push('# Iteration request');
  lines.push('');
  lines.push('You are modifying an EXISTING, DEPLOYED, WORKING application.');
  lines.push('The user wants a specific change. Your job: make ONLY that change.');
  lines.push('');
  lines.push('## CRITICAL RULES');
  lines.push('');
  lines.push('1. DO NOT regenerate files that don\'t need to change.');
  lines.push('2. DO NOT remove features that already work.');
  lines.push('3. DO NOT change the server entry point, health route, or internal routes.');
  lines.push('4. DO NOT change the database schema unless the instruction requires it.');
  lines.push('5. If you\'re unsure whether a file needs to change, DON\'T change it.');
  lines.push('6. Use <dyad-patch> for small changes (prefer over <dyad-write> when possible).');
  lines.push('7. Every file you emit must be COMPLETE — no "// ... rest of code" stubs.');
  lines.push('');

  if (args.strategy === 'surgical') {
    lines.push('## Strategy: SURGICAL');
    lines.push('Make the smallest possible change. Use <dyad-patch> blocks to modify');
    lines.push('only the lines that need to change. Do NOT re-emit entire files unless');
    lines.push('the change touches >50% of the file.');
    lines.push('');
  } else {
    lines.push('## Strategy: REBUILD WITH CONTEXT');
    lines.push('This change is structural enough to warrant re-emitting affected files.');
    lines.push('But STILL: only re-emit files that actually change. Keep all other files.');
    lines.push('');
  }

  lines.push('## User\'s instruction');
  lines.push('');
  lines.push(args.instruction);
  lines.push('');

  if (args.impactSection) {
    lines.push(args.impactSection);
  }

  if (args.brief) {
    lines.push('## Original brief (for context)');
    lines.push('');
    lines.push(`Name: ${args.brief.name}`);
    lines.push(`Trigger: ${args.brief.trigger}`);
    lines.push(`Audience: ${args.brief.audience}`);
    lines.push(`Outcome: ${args.brief.outcome}`);
    lines.push('');
  }

  lines.push(`## Existing codebase (${args.existingFiles.length} files)`);
  lines.push('');
  lines.push('These files are currently deployed and working. Only modify what the instruction requires.');
  lines.push('');

  for (const [path, contents] of args.existingFiles) {
    // For surgical mode, show full contents of small files and summaries of large ones.
    if (args.strategy === 'surgical' && contents.length > 3000) {
      lines.push(`### ${path} (${contents.length} chars — showing first 1500)`);
      lines.push('```');
      lines.push(contents.slice(0, 1500));
      lines.push('// ... (truncated for context)');
      lines.push('```');
    } else {
      lines.push(`### ${path}`);
      lines.push('```');
      lines.push(contents.slice(0, 6000));
      if (contents.length > 6000) lines.push('// ... (truncated)');
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('## Output');
  lines.push('');
  lines.push('Emit ONLY the files that change. For each:');
  lines.push('- Small change: use <dyad-patch path="..."><find>OLD</find><replace>NEW</replace></dyad-patch>');
  lines.push('- Large change or new file: use <dyad-write path="...">FULL CONTENTS</dyad-write>');
  lines.push('');
  lines.push('End with <dyad-chat-summary> explaining what you changed and why.');

  return lines.join('\n');
}

/**
 * Compute a human-readable diff summary between the old and new file maps.
 */
function computeBundleDiff(
  oldFiles: Map<string, string>,
  newFiles: Map<string, string>,
): { added: number; removed: number; modified: number; unchanged: number; changes: Array<{ path: string; change: 'added' | 'removed' | 'modified' | 'unchanged' }> } {
  const changes: Array<{ path: string; change: 'added' | 'removed' | 'modified' | 'unchanged' }> = [];
  let added = 0, removed = 0, modified = 0, unchanged = 0;

  for (const [path, contents] of newFiles) {
    const old = oldFiles.get(path);
    if (old === undefined) {
      changes.push({ path, change: 'added' });
      added++;
    } else if (old !== contents) {
      changes.push({ path, change: 'modified' });
      modified++;
    } else {
      changes.push({ path, change: 'unchanged' });
      unchanged++;
    }
  }
  for (const path of oldFiles.keys()) {
    if (!newFiles.has(path)) {
      changes.push({ path, change: 'removed' });
      removed++;
    }
  }

  return { added, removed, modified, unchanged, changes };
}

/**
 * Reconstruct an OperationBundle from persisted file data.
 */
function reconstructBundle(
  files: Array<{ path: string; contents: string; sha256: string; argoGenerated: boolean }>,
  manifest: { operationId: string; operationSlug: string; bundleVersion: number },
): OperationBundle {
  return {
    manifest: {
      operationId: manifest.operationId,
      operationSlug: manifest.operationSlug,
      bundleVersion: manifest.bundleVersion,
      workflowMapVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedByModel: 'argo-iteration',
      requiredEnv: ['ARGO_OPERATION_ID', 'ARGO_CONTROL_PLANE_URL', 'INTERNAL_API_KEY', 'MONGODB_URI'],
      ports: [{ target: 3000, protocol: 'HTTP' as const }],
      image: 'blaxel/nextjs:latest',
      memoryMb: 1024,
      healthCheckPath: '/health',
    },
    files: files.map((f) => ({
      path: f.path,
      contents: f.contents,
      sha256: f.sha256,
      argoGenerated: f.argoGenerated,
      sourceStepId: null,
    })),
  };
}
