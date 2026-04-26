import { BlaxelExecutionProvider } from './providers/blaxel.js';
import { DockerMockExecutionProvider } from './providers/docker-mock.js';
import { E2BBuildSandbox, InProcessBuildSandbox } from './providers/e2b.js';
import type { IBuildSandbox } from './providers/build-sandbox.js';
import type { IExecutionProvider } from './providers/execution.js';

/**
 * Provider factory. Selects the concrete IExecutionProvider/IBuildSandbox
 * based on environment. Every callsite in the system depends on the
 * interface — this factory is the only place where the choice is made.
 */

export function createExecutionProvider(): IExecutionProvider {
  const enabled = process.env.BLAXEL_ENABLED?.toLowerCase() === 'true';
  if (!enabled) {
    return DockerMockExecutionProvider.fromEnv();
  }
  return BlaxelExecutionProvider.fromEnv();
}

export function createBuildSandbox(): IBuildSandbox {
  const enabled = process.env.E2B_ENABLED?.toLowerCase() === 'true';
  if (!enabled) {
    return new InProcessBuildSandbox();
  }
  return new E2BBuildSandbox();
}
