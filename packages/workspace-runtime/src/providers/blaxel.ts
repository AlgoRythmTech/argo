import { setTimeout as sleep } from 'node:timers/promises';
import { request } from 'undici';
import pino from 'pino';
import { redactPii } from '@argo/security';
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
  apiBase: string;
  workspace: string;
  defaultRegion: string;
  defaultImage: string;
  publicHostnameTemplate: string;
};

/**
 * Blaxel execution provider.
 *
 * What it does:
 *   1. Creates a sandbox per operation (image: blaxel/nextjs:latest by default)
 *      with the requested memory and ports.
 *   2. Uploads the bundle file-by-file via the sandbox file API.
 *   3. Installs dependencies (pnpm install).
 *   4. Starts the deterministic runtime process (`node dist/server.js`).
 *   5. Polls the health endpoint until it returns 200.
 *   6. Returns the Blaxel-managed public URL.
 *
 * Failure modes are surfaced as typed errors. Retries are NOT implemented in
 * this layer — they are the caller's responsibility (the repair worker
 * already implements 3-cycle retries with smaller-change escalation).
 */
export class BlaxelExecutionProvider implements IExecutionProvider {
  readonly name = 'blaxel' as const;

  constructor(private readonly cfg: BlaxelConfig) {
    if (!cfg.apiKey) throw new Error('BlaxelConfig: apiKey is required');
    if (!cfg.workspace) throw new Error('BlaxelConfig: workspace is required');
  }

  static fromEnv(): BlaxelExecutionProvider {
    const apiKey = process.env.BLAXEL_API_KEY ?? '';
    const apiBase = process.env.BLAXEL_API_BASE ?? 'https://api.blaxel.ai';
    const workspace = process.env.BLAXEL_WORKSPACE ?? '';
    const defaultRegion = process.env.BLAXEL_DEFAULT_REGION ?? 'us-pdx-1';
    const defaultImage = process.env.BLAXEL_DEFAULT_IMAGE ?? 'blaxel/nextjs:latest';
    const publicHostnameTemplate =
      process.env.BLAXEL_PUBLIC_HOSTNAME_TEMPLATE ?? 'https://{operationId}.argo-ops.run';
    return new BlaxelExecutionProvider({
      apiKey,
      apiBase,
      workspace,
      defaultRegion,
      defaultImage,
      publicHostnameTemplate,
    });
  }

  async deploy(args: DeployArgs): Promise<DeploymentHandle> {
    const sandboxName = this.sandboxNameFor(args.operationId, args.environment);
    args.onProgress?.({
      phase: 'creating_sandbox',
      message: `creating sandbox ${sandboxName}`,
    });

    const createBody = {
      name: sandboxName,
      image: args.bundle.manifest.image || this.cfg.defaultImage,
      memory: args.bundle.manifest.memoryMb,
      ports: args.bundle.manifest.ports.map((p) => ({
        target: p.target,
        protocol: p.protocol,
      })),
      region: args.bundle.manifest.region ?? this.cfg.defaultRegion,
      env: this.buildEnv(args),
      labels: {
        argoOperationId: args.operationId,
        argoEnvironment: args.environment,
        argoBundleVersion: String(args.bundle.manifest.bundleVersion),
      },
    };

    const created = await this.api<{ id: string; publicUrl?: string }>(
      'POST',
      `/v1/sandboxes`,
      createBody,
    );

    const sandboxId = created.id;
    log.info({ sandboxId, operationId: args.operationId }, 'blaxel sandbox created');

    await this.uploadBundle(sandboxId, args.bundle, args.onProgress);

    args.onProgress?.({
      phase: 'installing_dependencies',
      message: 'pnpm install',
    });
    const install = await this.execCommand({
      handle: this.handleStub(sandboxId, sandboxName, args.environment),
      command: 'pnpm install --prod=false --frozen-lockfile',
      timeoutMs: 240_000,
    });
    if (install.exitCode !== 0) {
      throw new BlaxelDeployError(
        'install_failed',
        `pnpm install exited ${install.exitCode}: ${install.stderr.slice(0, 400)}`,
      );
    }

    args.onProgress?.({ phase: 'starting_process', message: 'starting runtime' });
    const start = await this.execCommand({
      handle: this.handleStub(sandboxId, sandboxName, args.environment),
      command: 'pnpm start &',
      timeoutMs: 30_000,
    });
    if (start.exitCode !== 0 && start.exitCode !== 130) {
      throw new BlaxelDeployError(
        'start_failed',
        `start exited ${start.exitCode}: ${start.stderr.slice(0, 400)}`,
      );
    }

    const publicUrl = this.publicUrlFor(args.operationId, args.environment, created.publicUrl);

    args.onProgress?.({ phase: 'health_check', message: `polling ${publicUrl}` });
    await this.waitForHealthy(publicUrl, args.bundle.manifest.healthCheckPath);

    args.onProgress?.({ phase: 'ready', message: 'live', publicUrl });

    return {
      provider: 'blaxel',
      environment: args.environment,
      sandboxName,
      sandboxId,
      region: args.bundle.manifest.region ?? this.cfg.defaultRegion,
      publicUrl,
      internalEndpoint: `${this.cfg.apiBase}/v1/sandboxes/${sandboxId}`,
      ports: args.bundle.manifest.ports,
      createdAt: new Date().toISOString(),
    };
  }

  async swapStagingToProduction(args: SwapArgs): Promise<SwapResult> {
    // Blaxel doesn't expose a true atomic-swap primitive at the sandbox
    // layer in v1; we simulate it via DNS swap on the public-hostname-router.
    // For the local mock and for the v1 implementation we:
    //   1. Promote the staging sandbox by setting its label `argoEnvironment=production`
    //   2. Demote the old production sandbox to label `argoEnvironment=retired`
    //   3. The hostname router uses labels to resolve `{operationId}.argo-ops.run`
    await this.api('PATCH', `/v1/sandboxes/${args.staging.sandboxId}`, {
      labels: { argoEnvironment: 'production' },
    });
    await this.api('PATCH', `/v1/sandboxes/${args.production.sandboxId}`, {
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
    const tail = args.tail ?? 200;
    const follow = args.follow ?? true;
    const url = `${this.cfg.apiBase}/v1/sandboxes/${args.handle.sandboxId}/logs?tail=${tail}&follow=${follow}`;
    const res = await request(url, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (res.statusCode >= 400) {
      throw new BlaxelDeployError('logs_failed', `logs HTTP ${res.statusCode}`);
    }
    const reader = res.body;
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true });
      let nlIdx = buffer.indexOf('\n');
      while (nlIdx >= 0) {
        const raw = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        const parsed = parseBlaxelLogLine(raw);
        if (parsed) yield parsed;
        nlIdx = buffer.indexOf('\n');
      }
    }
  }

  async execCommand(args: ExecCommandArgs): Promise<ExecCommandResult> {
    const started = Date.now();
    const res = await this.api<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>('POST', `/v1/sandboxes/${args.handle.sandboxId}/exec`, {
      command: args.command,
      cwd: args.cwd ?? '/workspace',
      timeoutMs: args.timeoutMs ?? 60_000,
      env: args.env ?? {},
    });
    return {
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      durationMs: Date.now() - started,
    };
  }

  async teardown(handle: DeploymentHandle): Promise<void> {
    try {
      await this.api('DELETE', `/v1/sandboxes/${handle.sandboxId}`, undefined);
    } catch (err) {
      log.warn({ err, sandboxId: handle.sandboxId }, 'teardown failed (idempotent, ignoring)');
    }
  }

  getPublicUrl(handle: DeploymentHandle): string {
    return handle.publicUrl;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async uploadBundle(
    sandboxId: string,
    bundle: OperationBundle,
    onProgress?: DeployArgs['onProgress'],
  ): Promise<void> {
    let i = 0;
    const total = bundle.files.length;
    for (const file of bundle.files) {
      i += 1;
      onProgress?.({
        phase: 'uploading_files',
        message: `uploading ${file.path}`,
        filesUploaded: i,
        filesTotal: total,
      });
      await this.api('PUT', `/v1/sandboxes/${sandboxId}/files`, {
        path: file.path,
        contents: file.contents,
        sha256: file.sha256,
      });
    }
  }

  private async waitForHealthy(publicUrl: string, healthPath: string): Promise<void> {
    const url = new URL(healthPath, publicUrl).toString();
    const deadline = Date.now() + 90_000;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const res = await request(url, { method: 'GET' });
        if (res.statusCode === 200) {
          await res.body.dump();
          return;
        }
        await res.body.dump();
      } catch (err) {
        lastErr = err;
      }
      await sleep(2000);
    }
    throw new BlaxelDeployError(
      'health_check_failed',
      `health check did not return 200 at ${url}: ${redactPii(String(lastErr))}`,
    );
  }

  private async api<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    const res = await request(`${this.cfg.apiBase}${path}`, {
      method,
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      throw new BlaxelDeployError(
        'api_error',
        `Blaxel ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 400)}`,
      );
    }
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }

  private authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.apiKey}`,
      'x-blaxel-workspace': this.cfg.workspace,
    };
  }

  private buildEnv(args: DeployArgs): Record<string, string> {
    return {
      ARGO_OPERATION_ID: args.operationId,
      ARGO_ENVIRONMENT: args.environment,
      NODE_ENV: 'production',
      ...(args.envOverrides ?? {}),
    };
  }

  private sandboxNameFor(operationId: string, env: 'staging' | 'production'): string {
    const safe = operationId.toLowerCase().replace(/[^a-z0-9-]/g, '');
    return `argo-${env}-${safe}`;
  }

  private publicUrlFor(operationId: string, env: 'staging' | 'production', fromApi?: string): string {
    if (fromApi && fromApi.startsWith('http')) return fromApi;
    const id = env === 'production' ? operationId : `${operationId}-staging`;
    return this.cfg.publicHostnameTemplate.replace('{operationId}', id);
  }

  private handleStub(
    sandboxId: string,
    sandboxName: string,
    environment: 'staging' | 'production',
  ): DeploymentHandle {
    return {
      provider: 'blaxel',
      environment,
      sandboxName,
      sandboxId,
      region: this.cfg.defaultRegion,
      publicUrl: this.publicUrlFor(sandboxName, environment),
      internalEndpoint: `${this.cfg.apiBase}/v1/sandboxes/${sandboxId}`,
      ports: [{ target: 3000, protocol: 'HTTP' }],
      createdAt: new Date().toISOString(),
    };
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

function parseBlaxelLogLine(raw: string): LogLine | null {
  if (!raw.trim()) return null;
  try {
    const obj = JSON.parse(raw) as {
      timestamp?: string;
      level?: string;
      message?: string;
      source?: string;
    };
    return {
      timestamp: obj.timestamp ?? new Date().toISOString(),
      level: (obj.level as LogLine['level']) ?? 'info',
      message: obj.message ?? raw,
      source: obj.source ?? 'blaxel',
    };
  } catch {
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: raw,
      source: 'blaxel',
    };
  }
}
