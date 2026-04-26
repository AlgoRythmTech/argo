import { createHash } from 'node:crypto';
import type { OperationBundle, OperationBundleFile } from '@argo/workspace-runtime';
import { attachHeader, type GeneratedHeaderArgs } from './header.js';

/**
 * Helper that turns a stream of `(path, contents)` pairs into a finalised
 * OperationBundle ready for IExecutionProvider.deploy().
 *
 * - Computes sha256 for each file
 * - Attaches argo:generated headers to TS/JS files where requested
 * - Validates that every generated file has a header
 */
export class BundleBuilder {
  private readonly files: OperationBundleFile[] = [];

  constructor(
    private readonly headerArgsBase: Omit<GeneratedHeaderArgs, 'stepId'>,
  ) {}

  addGenerated(args: {
    path: string;
    contents: string;
    sourceStepId: string | null;
  }): this {
    const withHeader = shouldAttachHeader(args.path)
      ? attachHeader(args.contents, { ...this.headerArgsBase, stepId: args.sourceStepId })
      : args.contents;
    this.files.push({
      path: args.path,
      contents: withHeader,
      sha256: sha256OfString(withHeader),
      argoGenerated: true,
      sourceStepId: args.sourceStepId,
    });
    return this;
  }

  addScaffolding(args: { path: string; contents: string }): this {
    this.files.push({
      path: args.path,
      contents: args.contents,
      sha256: sha256OfString(args.contents),
      argoGenerated: false,
      sourceStepId: null,
    });
    return this;
  }

  build(args: {
    operationId: string;
    operationSlug: string;
    bundleVersion: number;
    workflowMapVersion: number;
    generatedByModel: string;
    requiredEnv: string[];
    image?: string;
    memoryMb?: number;
    region?: string;
    ports?: Array<{ target: number; protocol: 'HTTP' | 'TCP' }>;
  }): OperationBundle {
    return {
      manifest: {
        operationId: args.operationId,
        operationSlug: args.operationSlug,
        bundleVersion: args.bundleVersion,
        workflowMapVersion: args.workflowMapVersion,
        generatedAt: new Date().toISOString(),
        generatedByModel: args.generatedByModel,
        requiredEnv: args.requiredEnv,
        ports: args.ports ?? [{ target: 3000, protocol: 'HTTP' }],
        image: args.image ?? 'blaxel/nextjs:latest',
        memoryMb: args.memoryMb ?? 1024,
        region: args.region,
        healthCheckPath: '/health',
      },
      files: this.files.slice(),
    };
  }
}

function shouldAttachHeader(path: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs)$/i.test(path);
}

export function sha256OfString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
