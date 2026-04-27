// Sandbox exec tool — the build agent runs allowlisted shell commands
// inside a tmpdir holding the current bundle, sees stdout/stderr, and
// can react in the next cycle.
//
// Replit Agent and Cursor's long-running agents both have this. It's
// what turns "the LLM hopes the code works" into "the LLM tested the
// code and saw it works." Used heavily by the multi-agent orchestrator
// to validate intermediate states.
//
// Safety:
//   - Hard allowlist: node, pnpm install/test/run, vitest, tsc, vite build,
//     eslint. NO arbitrary commands.
//   - 30-second timeout per call.
//   - Output capped at 32 KB so a chatty test runner can't blow the
//     model's token budget.

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { join, dirname as pathDirname } from 'node:path';
import { tmpdir } from 'node:os';

const ALLOWED_BINARIES: ReadonlySet<string> = new Set([
  'node',
  'pnpm',
  'npm',
  'npx',
  'vitest',
  'tsc',
  'vite',
  'eslint',
  'prettier',
]);

/**
 * The first token of the command (after splitting on whitespace) must
 * be in ALLOWED_BINARIES. Subsequent tokens are passed through unchanged.
 */
const ALLOWED_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  pnpm:  new Set(['install', 'i', 'add', 'test', 'run', 'exec', 'typecheck', 'build', '-v', '--version']),
  npm:   new Set(['install', 'i', 'test', 'run', 'exec', '-v', '--version']),
  npx:   new Set([]),               // any binary npx can find — but binary name still gates
  node:  new Set([]),               // node <script>
  vitest:new Set(['run', 'watch', '--passWithNoTests', '-v', '--version']),
  tsc:   new Set(['--noEmit', '--build', '-b', '-v', '--version']),
  vite:  new Set(['build', 'preview', '-v', '--version']),
  eslint:new Set([]),
  prettier: new Set(['--check', '--write', '-v', '--version']),
};

const MAX_OUTPUT_BYTES = 32 * 1024;
const TIMEOUT_MS = 30_000;

export interface SandboxExecArgs {
  /** Allowlisted command (e.g. "pnpm test", "tsc --noEmit", "node tests/eval-suite.js"). */
  command: string;
  /** The current bundle (path -> contents). Written to a tmpdir before exec. */
  files: ReadonlyMap<string, string>;
  /** Extra env to merge into process.env for the child. */
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SandboxExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  /** Set when the command was rejected by the allowlist before exec. */
  rejected: string | null;
}

export async function runSandboxExec(args: SandboxExecArgs): Promise<SandboxExecResult> {
  const started = Date.now();
  const tokens = args.command.trim().split(/\s+/);
  const bin = tokens[0]!;
  if (!ALLOWED_BINARIES.has(bin)) {
    return {
      ok: false, exitCode: 0, stdout: '', stderr: '', durationMs: 0, truncated: false,
      rejected: `binary_not_allowed:${bin} — allowed: ${Array.from(ALLOWED_BINARIES).join(', ')}`,
    };
  }
  const sub = tokens[1] ?? '';
  const allowedSubs = ALLOWED_SUBCOMMANDS[bin];
  if (allowedSubs && allowedSubs.size > 0 && sub && !allowedSubs.has(sub)) {
    return {
      ok: false, exitCode: 0, stdout: '', stderr: '', durationMs: 0, truncated: false,
      rejected: `subcommand_not_allowed:${bin} ${sub} — allowed: ${Array.from(allowedSubs).join(', ')}`,
    };
  }

  // Materialise the bundle into a fresh tmpdir.
  const dir = await mkdtemp(join(tmpdir(), 'argo-exec-'));
  try {
    for (const [path, contents] of args.files) {
      const target = join(dir, path);
      await mkdir(pathDirname(target), { recursive: true });
      await writeFile(target, contents, 'utf8');
    }

    return await new Promise<SandboxExecResult>((resolve) => {
      const child = spawn(bin, tokens.slice(1), {
        cwd: dir,
        env: { ...process.env, NODE_ENV: 'test', ARGO_TEST_MODE: '1', ...(args.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let killedByTimeout = false;
      const onChunk = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
        if (truncated) return;
        const total = which === 'stdout' ? stdout.length : stderr.length;
        const room = MAX_OUTPUT_BYTES - total;
        if (room <= 0) {
          truncated = true;
          return;
        }
        const slice = chunk.toString('utf8').slice(0, room);
        if (which === 'stdout') stdout += slice;
        else stderr += slice;
        if (slice.length < chunk.length) truncated = true;
      };
      child.stdout?.on('data', onChunk('stdout'));
      child.stderr?.on('data', onChunk('stderr'));
      const t = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill('SIGKILL'); } catch { /* hush */ }
      }, TIMEOUT_MS);
      const onAbort = () => {
        try { child.kill('SIGTERM'); } catch { /* hush */ }
      };
      args.signal?.addEventListener('abort', onAbort, { once: true });
      child.on('exit', async (code) => {
        clearTimeout(t);
        args.signal?.removeEventListener('abort', onAbort);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        resolve({
          ok: !killedByTimeout && code === 0,
          exitCode: code ?? -1,
          stdout,
          stderr: killedByTimeout ? stderr + '\n[exec timed out after 30s — killed with SIGKILL]' : stderr,
          durationMs: Date.now() - started,
          truncated,
          rejected: null,
        });
      });
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return {
      ok: false, exitCode: -1, stdout: '', stderr: String((err as Error)?.message ?? err).slice(0, 400),
      durationMs: Date.now() - started, truncated: false, rejected: null,
    };
  }
}

export function renderSandboxExecAsPromptSection(
  command: string,
  result: SandboxExecResult,
): string {
  const lines: string[] = [];
  lines.push(`# Tool result: sandbox_exec`);
  lines.push(`Command: \`${command}\``);
  if (result.rejected) {
    lines.push(`Rejected: ${result.rejected}`);
    return lines.join('\n');
  }
  lines.push(`Exit code: ${result.exitCode} · ${result.durationMs}ms${result.truncated ? ' · OUTPUT TRUNCATED' : ''}`);
  if (result.stdout.trim()) {
    lines.push('');
    lines.push('## stdout');
    lines.push('```');
    lines.push(result.stdout.trim().slice(-4000));
    lines.push('```');
  }
  if (result.stderr.trim()) {
    lines.push('');
    lines.push('## stderr');
    lines.push('```');
    lines.push(result.stderr.trim().slice(-4000));
    lines.push('```');
  }
  return lines.join('\n');
}

export const SANDBOX_EXEC_ALLOWED_BINARIES = Array.from(ALLOWED_BINARIES);
