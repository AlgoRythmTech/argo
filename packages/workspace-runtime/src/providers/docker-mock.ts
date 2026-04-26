import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from 'undici';
import pino from 'pino';
import { nanoid } from 'nanoid';
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

const log = pino({ name: 'docker-mock-provider', level: process.env.LOG_LEVEL ?? 'info' });

/**
 * DockerMockExecutionProvider — the dev-mode IExecutionProvider used when
 * BLAXEL_ENABLED=false.
 *
 * Section 13: "If Blaxel is unavailable during development, fall back to a
 * local Docker-Compose mock implementation of `IExecutionProvider` (which is
 * what the /infra/docker/docker-compose.dev.yml already provides). [...]
 * Never to SendGrid, Postmark, Resend, or any other production provider in
 * v1."
 *
 * In v1 this implementation runs the bundle as a local Node child process
 * inside `.argo/mock-deployments/<sandboxId>/`. It is NOT a security
 * boundary — it exists only to let the local stack work without Blaxel
 * credentials. Production deploys must use BlaxelExecutionProvider.
 */
export class DockerMockExecutionProvider implements IExecutionProvider {
  readonly name = 'docker_mock' as const;

  private readonly running = new Map<string, ChildProcess>();
  private readonly publicPorts = new Map<string, number>();
  private readonly logBuffer = new Map<string, LogLine[]>();
  private nextPort = 4100;

  constructor(private readonly rootDir: string = resolve(process.cwd(), '.argo/mock-deployments')) {}

  static fromEnv(): DockerMockExecutionProvider {
    return new DockerMockExecutionProvider();
  }

  async deploy(args: DeployArgs): Promise<DeploymentHandle> {
    const sandboxId = nanoid(12);
    const sandboxName = `mock-${args.environment}-${args.operationId.slice(0, 12)}`;
    const sandboxDir = join(this.rootDir, sandboxId);
    args.onProgress?.({ phase: 'creating_sandbox', message: `mkdir ${sandboxDir}` });
    await mkdir(sandboxDir, { recursive: true });

    let i = 0;
    const total = args.bundle.files.length;
    for (const f of args.bundle.files) {
      i += 1;
      args.onProgress?.({
        phase: 'uploading_files',
        message: `wrote ${f.path}`,
        filesUploaded: i,
        filesTotal: total,
      });
      const target = join(sandboxDir, f.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.contents, 'utf8');
    }

    // The mock writes a sentinel server.js if no server file exists. This
    // gives /health a 200 even for the very first scaffold.
    const serverPath = join(sandboxDir, 'server.js');
    const hasServer = args.bundle.files.some(
      (f) => f.path === 'server.js' || f.path === 'dist/server.js' || f.path === 'src/server.ts',
    );
    if (!hasServer) {
      await writeFile(serverPath, sentinelServerJs(), 'utf8');
    }

    const port = this.allocatePort();
    this.publicPorts.set(sandboxId, port);

    args.onProgress?.({ phase: 'starting_process', message: `spawn node on :${port}` });
    const child = spawn(process.execPath, [hasServer ? '.' : 'server.js'], {
      cwd: sandboxDir,
      env: {
        ...process.env,
        PORT: String(port),
        ARGO_OPERATION_ID: args.operationId,
        ARGO_ENVIRONMENT: args.environment,
        ...(args.envOverrides ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.running.set(sandboxId, child);
    this.logBuffer.set(sandboxId, []);
    const sink = (level: LogLine['level']) => (chunk: Buffer) => {
      const buf = this.logBuffer.get(sandboxId);
      if (!buf) return;
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line) continue;
        buf.push({
          timestamp: new Date().toISOString(),
          level,
          message: line,
          source: sandboxId,
        });
        if (buf.length > 500) buf.splice(0, buf.length - 500);
      }
    };
    child.stdout?.on('data', sink('info'));
    child.stderr?.on('data', sink('error'));
    child.on('exit', (code) => {
      log.warn({ sandboxId, code }, 'mock deployment exited');
    });

    const publicUrl = `http://localhost:${port}`;
    args.onProgress?.({ phase: 'health_check', message: `polling ${publicUrl}/health` });
    await this.waitForHealthy(publicUrl, args.bundle.manifest.healthCheckPath);

    args.onProgress?.({ phase: 'ready', message: 'live (mock)', publicUrl });

    return {
      provider: 'docker_mock',
      environment: args.environment,
      sandboxName,
      sandboxId,
      region: 'local',
      publicUrl,
      internalEndpoint: null,
      ports: args.bundle.manifest.ports,
      createdAt: new Date().toISOString(),
    };
  }

  async swapStagingToProduction(args: SwapArgs): Promise<SwapResult> {
    return {
      newProduction: { ...args.staging, environment: 'production' },
      retiredProductionId: args.production.sandboxId,
      swappedAt: new Date().toISOString(),
    };
  }

  async *streamLogs(args: LogStreamArgs): AsyncIterable<LogLine> {
    const buf = this.logBuffer.get(args.handle.sandboxId) ?? [];
    const tail = args.tail ?? 200;
    for (const line of buf.slice(-tail)) yield line;
    if (args.follow === false) return;
    let lastLen = buf.length;
    while (this.running.has(args.handle.sandboxId)) {
      await sleep(500);
      const cur = this.logBuffer.get(args.handle.sandboxId) ?? [];
      if (cur.length > lastLen) {
        for (const line of cur.slice(lastLen)) yield line;
        lastLen = cur.length;
      }
    }
  }

  async execCommand(_args: ExecCommandArgs): Promise<ExecCommandResult> {
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
  }

  async teardown(handle: DeploymentHandle): Promise<void> {
    const child = this.running.get(handle.sandboxId);
    if (child) {
      child.kill('SIGTERM');
      this.running.delete(handle.sandboxId);
    }
    this.logBuffer.delete(handle.sandboxId);
    this.publicPorts.delete(handle.sandboxId);
    try {
      await rm(join(this.rootDir, handle.sandboxId), { recursive: true, force: true });
    } catch {
      // Best-effort.
    }
  }

  getPublicUrl(handle: DeploymentHandle): string {
    return handle.publicUrl;
  }

  private allocatePort(): number {
    const p = this.nextPort;
    this.nextPort += 1;
    return p;
  }

  private async waitForHealthy(publicUrl: string, healthPath: string): Promise<void> {
    const url = new URL(healthPath, publicUrl).toString();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const res = await request(url, { method: 'GET' });
        if (res.statusCode === 200) {
          await res.body.dump();
          return;
        }
        await res.body.dump();
      } catch {
        // keep trying
      }
      await sleep(500);
    }
    throw new Error(`mock health check failed at ${url}`);
  }
}

function dirname(p: string): string {
  const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return ix === -1 ? '.' : p.slice(0, ix);
}

function sentinelServerJs(): string {
  return `// argo:mock — fallback server when no bundle server.js was generated
const http = require('node:http');
const port = Number(process.env.PORT) || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', mock: true }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});
server.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', message: 'mock-server-listening', port }));
});
`;
}
