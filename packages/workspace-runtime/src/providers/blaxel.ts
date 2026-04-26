// argo:upstream blaxel-ai/sdk-typescript@v0.2.80 — uses the official @blaxel/core
// SandboxInstance API (not raw HTTP). Authentication is via env: BL_API_KEY +
// BL_WORKSPACE (set by the Argo control plane before this provider is invoked).
import { settings, SandboxInstance } from '@blaxel/core';
import pino from 'pino';
import type { LogLine } from '@argo/shared-types';
import type {
  DeployArgs,
  DeploymentHandle,
  ExecCommandArgs,
  ExecCommandResult,
  IExecutionProvider,
  LogStreamArgs,
  SwapArgs,
  SwapResult,
} from './execution.js';
import type { OperationBundle } from '../bundle.js';

const log = pino({ name: 'blaxel-execution-provider', level: process.env.LOG_LEVEL ?? 'info' });

export type BlaxelConfig = {
  apiKey: string;
  workspace: string;
  defaultRegion: string;
  defaultImage: string;
  publicHostnameTemplate: string;
};

/**
 * Blaxel execution provider — backed by the official @blaxel/core SDK.
 *
 * Lifecycle for a deploy:
 *   1. SandboxInstance.createIfNotExists(...) — boot the sandbox, attach H2.
 *   2. fs.writeTree(files) — bulk-upload the bundle in one shot.
 *   3. process.exec({ command: 'pnpm install --frozen-lockfile=false' }) — install deps.
 *   4. process.exec({ command: 'node server.js', name: 'argo-runtime', wait_for_ports: [3000] })
 *      — start the runtime in the background and wait for the port.
 *   5. Resolve the public preview URL (sandbox.previews.list() / .create()).
 *   6. Health-poll the preview URL via sandbox.fetch(3000, '/health').
 */
export class BlaxelExecutionProvider implements IExecutionProvider {
  readonly name = 'blaxel' as const;

  constructor(private readonly cfg: BlaxelConfig) {
    if (!cfg.apiKey) throw new Error('BlaxelConfig: apiKey is required');
    if (!cfg.workspace) throw new Error('BlaxelConfig: workspace is required');
    // Inject auth into the SDK's global settings.
    process.env.BL_API_KEY = cfg.apiKey;
    process.env.BL_WORKSPACE = cfg.workspace;
    // settings.* is read on first call; touch it so misconfig surfaces early.
    void settings;
  }

  static fromEnv(): BlaxelExecutionProvider {
    return new BlaxelExecutionProvider({
      apiKey: process.env.BLAXEL_API_KEY ?? process.env.BL_API_KEY ?? '',
      workspace: process.env.BLAXEL_WORKSPACE ?? process.env.BL_WORKSPACE ?? '',
      defaultRegion: process.env.BLAXEL_DEFAULT_REGION ?? 'us-pdx-1',
      defaultImage: process.env.BLAXEL_DEFAULT_IMAGE ?? 'blaxel/nextjs:latest',
      publicHostnameTemplate:
        process.env.BLAXEL_PUBLIC_HOSTNAME_TEMPLATE ??
        'https://{operationId}.argo-ops.run',
    });
  }

  async deploy(args: DeployArgs): Promise<DeploymentHandle> {
    const sandboxName = sandboxNameFor(args.operationId, args.environment);
    args.onProgress?.({ phase: 'creating_sandbox', message: `creating ${sandboxName}` });

    const sandbox = await SandboxInstance.createIfNotExists({
      name: sandboxName,
      image: args.bundle.manifest.image || this.cfg.defaultImage,
      memory: args.bundle.manifest.memoryMb,
      ports: args.bundle.manifest.ports.map((p) => ({
        target: p.target,
        protocol: p.protocol,
      })),
      region: args.bundle.manifest.region ?? this.cfg.defaultRegion,
      envs: this.buildEnv(args),
      labels: {
        argoOperationId: args.operationId,
        argoEnvironment: args.environment,
        argoBundleVersion: String(args.bundle.manifest.bundleVersion),
      },
    });

    await sandbox.wait({ maxWait: 120_000, interval: 1_000 });

    args.onProgress?.({
      phase: 'uploading_files',
      message: `uploading ${args.bundle.files.length} files`,
      filesUploaded: 0,
      filesTotal: args.bundle.files.length,
    });

    await sandbox.fs.writeTree(
      args.bundle.files.map((f) => ({ path: f.path, content: f.contents })),
      '/workspace',
    );

    args.onProgress?.({ phase: 'installing_dependencies', message: 'pnpm install' });
    const installResult = await sandbox.process.exec({
      name: `argo-install-${Date.now()}`,
      command: 'cd /workspace && pnpm install --prod=false --no-frozen-lockfile 2>&1',
      workingDir: '/workspace',
      env: this.envMap(args),
      waitForCompletion: true,
      timeout: 240,
    });
    const installExit =
      'exitCode' in installResult ? Number((installResult as { exitCode: number }).exitCode) : 0;
    if (installExit !== 0) {
      throw new BlaxelDeployError('install_failed', `pnpm install exited ${installExit}`);
    }

    args.onProgress?.({ phase: 'starting_process', message: 'starting runtime' });
    await sandbox.process.exec({
      name: 'argo-runtime',
      command: 'cd /workspace && node server.js',
      workingDir: '/workspace',
      env: { ...this.envMap(args), PORT: String(args.bundle.manifest.ports[0]?.target ?? 3000) },
      waitForCompletion: false,
      waitForPorts: args.bundle.manifest.ports.map((p) => p.target),
    });

    const publicUrl = await this.resolvePublicUrl(
      sandbox,
      args.operationId,
      args.environment,
    );

    args.onProgress?.({ phase: 'health_check', message: `polling ${publicUrl}` });
    await this.waitForHealthy(sandbox, args.bundle.manifest.healthCheckPath, args.bundle.manifest.ports[0]?.target ?? 3000);

    args.onProgress?.({ phase: 'ready', message: 'live', publicUrl });

    return {
      provider: 'blaxel',
      environment: args.environment,
      sandboxName,
      sandboxId: sandbox.metadata.name ?? sandboxName,
      region: args.bundle.manifest.region ?? this.cfg.defaultRegion,
      publicUrl,
      internalEndpoint: null,
      ports: args.bundle.manifest.ports,
      createdAt: new Date().toISOString(),
    };
  }

  async swapStagingToProduction(args: SwapArgs): Promise<SwapResult> {
    // Promote staging by relabeling; demote production. Blaxel's
    // hostname router resolves `{operationId}.argo-ops.run` from labels.
    const { SandboxInstance: SI } = await import('@blaxel/core');
    await SI.updateMetadata(args.staging.sandboxName, {
      labels: { argoEnvironment: 'production' },
    });
    await SI.updateMetadata(args.production.sandboxName, {
      labels: { argoEnvironment: args.retainOldProduction === false ? 'archived' : 'retired' },
    });
    if (args.retainOldProduction === false) {
      await this.teardown(args.production);
    }
    return {
      newProduction: { ...args.staging, environment: 'production' },
      retiredProductionId: args.production.sandboxId,
      swappedAt: new Date().toISOString(),
    };
  }

  async *streamLogs(args: LogStreamArgs): AsyncIterable<LogLine> {
    const sandbox = await SandboxInstance.get(args.handle.sandboxName);
    const tail = args.tail ?? 200;
    let raw: string;
    try {
      raw = await sandbox.process.logs('argo-runtime', 'all');
    } catch (err) {
      log.warn({ err }, 'logs fetch failed');
      return;
    }
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-tail);
    for (const line of lines) {
      yield { timestamp: new Date().toISOString(), level: 'info', message: line, source: 'blaxel' };
    }
    // We intentionally don't follow=true here in v1 — Blaxel logs are
    // long-poll fetched. The repair worker pulls every 30s anyway.
  }

  async execCommand(args: ExecCommandArgs): Promise<ExecCommandResult> {
    const started = Date.now();
    const sandbox = await SandboxInstance.get(args.handle.sandboxName);
    const name = `argo-exec-${Date.now()}`;
    const result = (await sandbox.process.exec({
      name,
      command: args.command,
      workingDir: args.cwd ?? '/workspace',
      env: args.env ?? {},
      waitForCompletion: true,
      timeout: Math.ceil((args.timeoutMs ?? 60_000) / 1000),
    })) as { exitCode?: number; logs?: string };
    const stderr = await sandbox.process.logs(name, 'stderr').catch(() => '');
    return {
      exitCode: Number(result.exitCode ?? 0),
      stdout: result.logs ?? '',
      stderr,
      durationMs: Date.now() - started,
    };
  }

  async teardown(handle: DeploymentHandle): Promise<void> {
    try {
      await SandboxInstance.delete(handle.sandboxName);
    } catch (err) {
      log.warn({ err, sandboxName: handle.sandboxName }, 'teardown failed (idempotent)');
    }
  }

  getPublicUrl(handle: DeploymentHandle): string {
    return handle.publicUrl;
  }

  // ── internals ──────────────────────────────────────────────────────

  private buildEnv(args: DeployArgs): Array<{ name: string; value: string }> {
    const map = this.envMap(args);
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }

  private envMap(args: DeployArgs): Record<string, string> {
    return {
      ARGO_OPERATION_ID: args.operationId,
      ARGO_ENVIRONMENT: args.environment,
      NODE_ENV: 'production',
      ...(args.envOverrides ?? {}),
    };
  }

  private async resolvePublicUrl(
    sandbox: SandboxInstance,
    operationId: string,
    environment: 'staging' | 'production',
  ): Promise<string> {
    // Try the previews API first; fall back to the templated hostname.
    try {
      const previews = await sandbox.previews.list();
      if (previews.length > 0) {
        const preview = previews[0]!;
        const url = (preview.spec as unknown as { url?: string }).url;
        if (typeof url === 'string') return url;
      }
    } catch (err) {
      log.warn({ err }, 'previews.list failed, falling back to template');
    }
    const id = environment === 'production' ? operationId : `${operationId}-staging`;
    return this.cfg.publicHostnameTemplate.replace('{operationId}', id);
  }

  private async waitForHealthy(
    sandbox: SandboxInstance,
    healthPath: string,
    port: number,
  ): Promise<void> {
    const deadline = Date.now() + 90_000;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const res = await sandbox.fetch(port, healthPath, { method: 'GET' });
        if (res.status === 200) return;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new BlaxelDeployError(
      'health_check_failed',
      `health check failed at port ${port}${healthPath}: ${String(lastErr).slice(0, 200)}`,
    );
  }
}

export class BlaxelDeployError extends Error {
  constructor(
    readonly code:
      | 'api_error'
      | 'install_failed'
      | 'start_failed'
      | 'health_check_failed'
      | 'logs_failed',
    message: string,
  ) {
    super(message);
    this.name = 'BlaxelDeployError';
  }
}

function sandboxNameFor(operationId: string, env: 'staging' | 'production'): string {
  const safe = operationId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `argo-${env}-${safe}`.slice(0, 60);
}

function unused(_value: unknown) {
  /* exists so OperationBundle import isn't tree-shaken away */
}
unused({} as OperationBundle);
