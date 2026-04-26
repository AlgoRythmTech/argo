/**
 * The package allow-list. Generated code may only `import` from this list.
 * New entries require a manual review (not a model decision). This kills the
 * package-hallucination supply-chain attack vector dead.
 *
 * Section 12: "Package allow-list for code generation — the agent can only
 * import packages from a curated list of 240 vetted dependencies. New
 * packages require a manual review. This kills the package-hallucination
 * attack vector dead."
 *
 * The list below is the v1 baseline. It deliberately covers the surface area
 * a generated workflow needs and nothing else. A check in
 * /packages/build-engine/src/validators/import-validator.ts enforces this.
 */

export const PACKAGE_ALLOW_LIST: ReadonlySet<string> = new Set([
  // ── Runtime essentials ───────────────────────────────────────────────────
  'node:fs',
  'node:path',
  'node:crypto',
  'node:url',
  'node:util',
  'node:stream',
  'node:buffer',
  'node:http',
  'node:https',
  'node:events',
  'node:os',
  'node:zlib',

  // ── Web framework (one choice, locked) ──────────────────────────────────
  'fastify',
  '@fastify/cors',
  '@fastify/helmet',
  '@fastify/rate-limit',
  '@fastify/cookie',
  '@fastify/sensible',
  '@fastify/multipart',
  '@fastify/static',

  // ── Validation ──────────────────────────────────────────────────────────
  'zod',
  'zod-to-json-schema',

  // ── Database access (mongo + relational) ────────────────────────────────
  'mongodb',
  'mongoose',
  '@prisma/client',
  'pg',
  'kysely',

  // ── Queue + cache ───────────────────────────────────────────────────────
  'bullmq',
  'ioredis',

  // ── Email (only the wrappers that hit AgentMail) ────────────────────────
  'nodemailer',
  'mailparser',
  '@argo/email-automation',

  // ── Cron / time ─────────────────────────────────────────────────────────
  'date-fns',
  'date-fns-tz',
  'cronstrue',
  'croner',

  // ── HTTP ────────────────────────────────────────────────────────────────
  'undici',

  // ── Utilities ───────────────────────────────────────────────────────────
  'nanoid',
  'uuid',
  'pino',
  'pino-pretty',

  // ── Argo internals (workspace) ──────────────────────────────────────────
  '@argo/shared-types',
  '@argo/security',
  '@argo/workspace-runtime',
  '@argo/agent',
  '@argo/build-engine',
]);

const NPM_NAME_REGEX = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9_.-]*$/;
const NODE_BUILTIN_REGEX = /^node:[a-z]+$/;

export type ImportValidationIssue = {
  importPath: string;
  reason: 'not_allow_listed' | 'malformed_name' | 'relative_outside_bundle';
};

export function validateImports(
  importPaths: readonly string[],
  options: { allowRelative?: boolean } = {},
): ImportValidationIssue[] {
  const allowRelative = options.allowRelative ?? true;
  const issues: ImportValidationIssue[] = [];

  for (const raw of importPaths) {
    const importPath = raw.trim();

    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      if (!allowRelative) {
        issues.push({ importPath, reason: 'relative_outside_bundle' });
      }
      continue;
    }

    if (!NODE_BUILTIN_REGEX.test(importPath) && !NPM_NAME_REGEX.test(importPath.split('/')[0]!)) {
      const scoped = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0]!;
      if (!NPM_NAME_REGEX.test(scoped)) {
        issues.push({ importPath, reason: 'malformed_name' });
        continue;
      }
    }

    const root = rootPackageName(importPath);
    if (!PACKAGE_ALLOW_LIST.has(root) && !PACKAGE_ALLOW_LIST.has(importPath)) {
      issues.push({ importPath, reason: 'not_allow_listed' });
    }
  }

  return issues;
}

function rootPackageName(importPath: string): string {
  if (importPath.startsWith('node:')) return importPath.split('/')[0]!;
  if (importPath.startsWith('@')) {
    const [scope, pkg] = importPath.split('/');
    return `${scope}/${pkg}`;
  }
  return importPath.split('/')[0]!;
}

export function isAllowListed(packageName: string): boolean {
  return PACKAGE_ALLOW_LIST.has(rootPackageName(packageName));
}
