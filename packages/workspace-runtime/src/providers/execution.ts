import type { LogLine } from '@argo/shared-types';
import type {
  DeploymentEnvironment,
  OperationBundle,
} from '../bundle.js';

/**
 * IExecutionProvider — the abstraction over Blaxel.
 *
 * Section 13: "Wrapped behind an `IExecutionProvider` interface in
 * /packages/workspace-runtime/src/providers/execution.ts from Day 1, with
 * the concrete Blaxel implementation in `blaxel.ts`. The wrapper exists
 * even though the only implementation is Blaxel — this is the abstraction
 * insurance you'll be glad you bought if Blaxel raises pricing or has an
 * outage in month nine."
 *
 * Two implementations live in this package:
 *   - BlaxelExecutionProvider  (production)
 *   - DockerMockExecutionProvider (dev fallback when BLAXEL_ENABLED=false)
 *
 * Every callsite depends on the interface, never on the concretion.
 */

export type DeploymentHandle = {
  provider: 'blaxel' | 'docker_mock';
  environment: DeploymentEnvironment;
  /** Human-friendly name, also used by Blaxel as the sandbox identifier. */
  sandboxName: string;
  /** Provider-issued identifier. */
  sandboxId: string;
  region: string | null;
  /** Public URL where the deployed workflow's HTTP surface answers. */
  publicUrl: string;
  /** Internal endpoint for runtime mgmt (logs, exec). */
  internalEndpoint: string | null;
  ports: Array<{ target: number; protocol: 'HTTP' | 'TCP' }>;
  createdAt: string;
};

export type DeployArgs = {
  operationId: string;
  bundle: OperationBundle;
  environment: DeploymentEnvironment;
  /** Secrets injected at deploy time. Never written to bundle files. */
  envOverrides?: Record<string, string>;
  /** Callback invoked for streaming progress; safe to omit. */
  onProgress?: (event: DeployProgressEvent) => void;
};

export type DeployProgressEvent =
  | { phase: 'creating_sandbox'; message: string }
  | { phase: 'uploading_files'; message: string; filesUploaded: number; filesTotal: number }
  | { phase: 'installing_dependencies'; message: string }
  | { phase: 'starting_process'; message: string }
  | { phase: 'health_check'; message: string }
  | { phase: 'ready'; message: string; publicUrl: string };

export type LogStreamArgs = {
  handle: DeploymentHandle;
  /** Tail at most this many recent lines. Default: 200. */
  tail?: number;
  /** Follow new lines as they arrive. Default: true. */
  follow?: boolean;
};

export type SwapArgs = {
  /** The currently-live production deployment. */
  production: DeploymentHandle;
  /** The validated staging deployment that should become production. */
  staging: DeploymentHandle;
  /** Whether to keep the previous production around for rollback. Default: true. */
  retainOldProduction?: boolean;
};

export type SwapResult = {
  newProduction: DeploymentHandle;
  retiredProductionId: string;
  swappedAt: string;
};

export type ExecCommandArgs = {
  handle: DeploymentHandle;
  command: string;
  /** Working directory inside the sandbox. Default: bundle root. */
  cwd?: string;
  /** Timeout in ms. Default: 60_000. */
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type ExecCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

/**
 * The interface every callsite depends on.
 */
export interface IExecutionProvider {
  readonly name: 'blaxel' | 'docker_mock';

  /** Push a bundle, boot the sandbox, return a handle that includes the public URL. */
  deploy(args: DeployArgs): Promise<DeploymentHandle>;

  /** Atomic swap. Used by the self-healing repair flow once tests pass. */
  swapStagingToProduction(args: SwapArgs): Promise<SwapResult>;

  /** Stream logs (live tail). Implementations MAY return a finite stream when follow=false. */
  streamLogs(args: LogStreamArgs): AsyncIterable<LogLine>;

  /** Shell-like execution inside the sandbox. */
  execCommand(args: ExecCommandArgs): Promise<ExecCommandResult>;

  /** Tear down a deployment. Idempotent. */
  teardown(handle: DeploymentHandle): Promise<void>;

  /** Public URL for a handle. Always returns the value the customer can paste. */
  getPublicUrl(handle: DeploymentHandle): string;
}
