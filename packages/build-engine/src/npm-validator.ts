// NPM dependency validator.
//
// LLMs hallucinate package names. Replit Agent and Lovable both ship
// bundles where `pnpm install` fails with "package not found" because
// the model invented a plausible-sounding npm name. This catches it
// BEFORE the install step — we hit registry.npmjs.org at the gate, fail
// fast, and re-prompt with the exact hallucinated names.
//
// Usage from the auto-fix loop:
//
//   const result = await validateDependencies(bundle);
//   if (!result.allValid) bundle.failures.push(...result.failures);
//
// Caching: per-process LRU keyed on package name. Most builds reuse the
// same 20-30 packages, so cache hit rate is ~95% after warm-up.

import { request } from 'undici';
import type { OperationBundle } from '@argo/workspace-runtime';

const REGISTRY_BASE = process.env.NPM_REGISTRY_BASE ?? 'https://registry.npmjs.org';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface CacheEntry {
  exists: boolean;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface DependencyFailure {
  packageName: string;
  /** Where we found the package referenced. */
  source: 'package.json' | 'add-dependency-tag';
  /** What we know about why it failed. */
  reason: 'not_found' | 'invalid_name' | 'fetch_failed';
  detail: string;
}

export interface DependencyValidationResult {
  allValid: boolean;
  validated: number;
  failures: DependencyFailure[];
  /** Names known to be valid in the npm registry. */
  validPackages: string[];
}

const NPM_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * NPM-builtin names + Argo's own scope are never validated against the
 * registry — they always resolve in the runtime.
 */
const SKIP_VALIDATION = new Set<string>([
  // Node builtins (already in package.json as "node:*" imports).
  'node',
  // Argo's own scope.
  '@argo/agent',
  '@argo/build-engine',
  '@argo/security',
  '@argo/shared-types',
  '@argo/workspace-runtime',
  '@argo/email-automation',
]);

export async function validateDependencies(
  bundle: OperationBundle,
  options: { signal?: AbortSignal; concurrency?: number } = {},
): Promise<DependencyValidationResult> {
  const concurrency = options.concurrency ?? 6;
  const candidates = collectPackageNames(bundle);

  const failures: DependencyFailure[] = [];
  const validPackages: string[] = [];
  let validated = 0;

  const queue = [...candidates];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        const { name, source } = next;
        if (SKIP_VALIDATION.has(name)) continue;
        if (!NPM_NAME_PATTERN.test(name)) {
          failures.push({
            packageName: name,
            source,
            reason: 'invalid_name',
            detail: `"${name}" is not a valid npm package name (must match ${NPM_NAME_PATTERN.source}).`,
          });
          continue;
        }
        validated++;
        const exists = await checkExists(name, options.signal);
        if (exists.ok) {
          if (exists.exists) {
            validPackages.push(name);
          } else {
            failures.push({
              packageName: name,
              source,
              reason: 'not_found',
              detail: `"${name}" does not exist on npm. Hallucinated dependencies must be replaced with real ones — search npm before declaring.`,
            });
          }
        } else {
          // Network error — don't fail the build over it; just warn.
          failures.push({
            packageName: name,
            source,
            reason: 'fetch_failed',
            detail: `Couldn't reach the npm registry to verify "${name}": ${exists.error}. Build continues; the install step is the next gate.`,
          });
        }
      }
    })());
  }
  await Promise.all(workers);

  // fetch_failed entries don't count against allValid — they're advisory.
  const blocking = failures.filter((f) => f.reason !== 'fetch_failed');
  return {
    allValid: blocking.length === 0,
    validated,
    failures,
    validPackages,
  };
}

function collectPackageNames(
  bundle: OperationBundle,
): Array<{ name: string; source: DependencyFailure['source'] }> {
  const out: Array<{ name: string; source: DependencyFailure['source'] }> = [];
  const seen = new Set<string>();
  const push = (name: string, source: DependencyFailure['source']) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, source });
  };

  // package.json declares deps via dependencies + devDependencies.
  const pkg = bundle.files.find((f) => f.path === 'package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.contents) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const name of Object.keys(parsed.dependencies ?? {})) push(name, 'package.json');
      for (const name of Object.keys(parsed.devDependencies ?? {})) push(name, 'package.json');
    } catch {
      // Invalid package.json is its own quality-gate failure; we skip here.
    }
  }
  return out;
}

async function checkExists(
  name: string,
  signal?: AbortSignal,
): Promise<{ ok: true; exists: boolean } | { ok: false; error: string }> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.storedAt < CACHE_TTL_MS) {
    return { ok: true, exists: cached.exists };
  }
  try {
    // HEAD on the registry's package endpoint is fast + cacheable.
    const res = await request(`${REGISTRY_BASE}/${encodeURIComponent(name)}`, {
      method: 'HEAD',
      ...(signal ? { signal } : {}),
      bodyTimeout: FETCH_TIMEOUT_MS,
      headersTimeout: FETCH_TIMEOUT_MS,
    });
    // Drain any body to free the socket.
    try {
      await res.body.dump();
    } catch {
      /* hush */
    }
    const exists = res.statusCode < 400;
    cache.set(name, { exists, storedAt: Date.now() });
    return { ok: true, exists };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err).slice(0, 160) };
  }
}

/**
 * For test injection — clears the per-process cache.
 */
export function clearNpmValidationCache(): void {
  cache.clear();
}

/**
 * Render dependency failures as the markdown the auto-fix loop appends to
 * the model's next-cycle prompt.
 */
export function renderDependencyFailures(failures: readonly DependencyFailure[]): string {
  if (failures.length === 0) return '';
  const lines: string[] = [];
  lines.push('## NPM dependency failures');
  lines.push('');
  for (const f of failures) {
    lines.push(`- ${f.packageName} (${f.source}, ${f.reason}): ${f.detail}`);
  }
  lines.push('');
  lines.push(
    'Fix every line above. Either remove the bad package, replace it with a real',
    'one (search npm first), or, if the capability is small, write it inline using',
    'node:* builtins. Re-emit ONLY package.json via <dyad-write> with the corrected',
    'dependencies block.',
  );
  return lines.join('\n');
}
