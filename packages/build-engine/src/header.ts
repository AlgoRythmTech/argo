/**
 * Section 10: "Every generated file gets the `argo:generated` header
 * (operationId, stepId, schemaVersion). Files without the header cannot be
 * touched by the repair worker. This invariant is enforced by the file
 * system layer, not the agent's discretion."
 */

export type GeneratedHeaderArgs = {
  operationId: string;
  stepId: string | null;
  schemaVersion: number;
  bundleVersion: number;
  generatedAt?: string;
};

export function generatedHeader(args: GeneratedHeaderArgs): string {
  const ts = args.generatedAt ?? new Date().toISOString();
  return [
    '/**',
    ' * argo:generated',
    ` * operationId: ${args.operationId}`,
    ` * stepId: ${args.stepId ?? '(scaffolding)'}`,
    ` * schemaVersion: ${args.schemaVersion}`,
    ` * bundleVersion: ${args.bundleVersion}`,
    ` * generatedAt: ${ts}`,
    ' *',
    ' * DO NOT EDIT BY HAND. The Argo repair worker may modify this file.',
    ' */',
    '',
  ].join('\n');
}

export function hasGeneratedHeader(content: string): boolean {
  return /\/\*\*\s*\n\s*\*\s+argo:generated\b/.test(content);
}

export function attachHeader(content: string, args: GeneratedHeaderArgs): string {
  if (hasGeneratedHeader(content)) return content;
  return generatedHeader(args) + content;
}
