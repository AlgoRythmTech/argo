// Per-app BUILD_MANIFEST.md generator.
//
// Every Argo-generated app ships with a comprehensive manifest that
// catalogues EVERY file, dep, agent, workflow, and route. This is what
// the operator (or their CTO / lawyer / auditor) reads to understand
// what was actually built, without reading the code. None of Replit /
// Lovable / Bolt / v0 / Emergent ship anything close.
//
// The generator runs after a successful deploy. It introspects the
// bundle deterministically (no LLM call needed for the catalogue), then
// uses GPT to write the prose sections (operator-summary, "what to do
// when X breaks", limitations).
//
// Output is a single Markdown document keyed by (operationId, bundleVersion)
// — the same shape as the existing operation_readmes collection.

import { z } from 'zod';
import { request } from 'undici';
import { routeModel } from '../llm/model-router.js';

// ─── Deterministic bundle introspection ────────────────────────────────

export interface ManifestFile {
  path: string;
  bytes: number;
  argoGenerated: boolean;
  /** Inferred role from path. Helps the renderer group files. */
  role: 'entry' | 'route' | 'schema' | 'db' | 'mailer' | 'jobs' | 'agent' | 'tool' | 'workflow' |
        'security' | 'observability' | 'web-page' | 'web-component' | 'web-hook' | 'web-style' |
        'web-config' | 'test' | 'doc' | 'config' | 'other';
}

export interface ManifestAgent {
  name: string;
  /** Path to the file that calls createAgent({ name }). */
  file: string;
  /** Model the agent uses (extracted from createAgent literal). */
  model: string | null;
  /** Tools wired into the agent (best-effort from inline tool array). */
  tools: string[];
}

export interface ManifestRoute {
  /** HTTP method as the agent declared it (GET/POST/PATCH/DELETE/PUT). */
  method: string;
  /** Path pattern (e.g. /api/submissions). */
  pattern: string;
  /** File the route lives in. */
  file: string;
}

export interface ManifestWorkflow {
  name: string;
  file: string;
  /** Step names in order — extracted from defineWorkflow(name, [{ name }, ...]). */
  steps: string[];
}

export interface ManifestEnvVar {
  name: string;
  /** First file referencing it. */
  firstUseFile: string;
  /** Whether .env.example documents it. */
  documented: boolean;
}

export interface BundleManifest {
  files: ManifestFile[];
  dependencies: Record<string, string>;
  agents: ManifestAgent[];
  routes: ManifestRoute[];
  workflows: ManifestWorkflow[];
  envVars: ManifestEnvVar[];
  /** Total bytes of generated code (excludes scaffolding). */
  generatedBytes: number;
  /** Total file count. */
  fileCount: number;
}

const FILE_EXT = /\.(?:m?[jt]sx?|cjs|json|md|env|example|sh|yml|yaml|css|html|toml)$/i;

const RUNTIME_INJECTED_ENV = new Set([
  'NODE_ENV', 'PORT', 'LOG_LEVEL', 'TZ',
  'ARGO_OPERATION_ID', 'ARGO_ENVIRONMENT', 'ARGO_CONTROL_PLANE_URL',
  'ARGO_TEST_MODE', 'ARGO_OWNER_ID',
]);

export function buildManifest(args: {
  files: ReadonlyArray<{ path: string; contents: string; argoGenerated: boolean }>;
}): BundleManifest {
  const files: ManifestFile[] = [];
  const agents: ManifestAgent[] = [];
  const routes: ManifestRoute[] = [];
  const workflows: ManifestWorkflow[] = [];
  const envVarMap = new Map<string, { firstUseFile: string }>();
  let generatedBytes = 0;

  let dependencies: Record<string, string> = {};
  for (const f of args.files) {
    const role = inferRole(f.path);
    files.push({ path: f.path, bytes: f.contents.length, argoGenerated: f.argoGenerated, role });
    if (f.argoGenerated) generatedBytes += f.contents.length;

    if (f.path === 'package.json') {
      try {
        const parsed = JSON.parse(f.contents) as { dependencies?: Record<string, string> };
        dependencies = parsed.dependencies ?? {};
      } catch {
        /* invalid package.json — caught by quality gate elsewhere */
      }
    }

    if (FILE_EXT.test(f.path)) {
      // Agents: createAgent({ name: '...', model: '...', tools: [...] })
      // Use a relaxed regex; we only need names/models/tools.
      const agentRe = /createAgent\s*\(\s*\{([^}]*)\}/g;
      let am: RegExpExecArray | null;
      while ((am = agentRe.exec(f.contents)) !== null) {
        const block = am[1] ?? '';
        const name = capture(block, /name\s*:\s*['"]([^'"]+)['"]/);
        if (!name) continue;
        const model = capture(block, /model\s*:\s*['"]([^'"]+)['"]/);
        const toolsBlock = capture(block, /tools\s*:\s*\[([^\]]*)\]/);
        const tools: string[] = [];
        if (toolsBlock) {
          const toolNames = toolsBlock.match(/[A-Za-z_][\w]*/g) ?? [];
          for (const t of toolNames) if (!tools.includes(t)) tools.push(t);
        }
        agents.push({ name, file: f.path, model: model ?? null, tools });
      }

      // Routes: app.get('/path', ...), app.post('/path', ...), etc.
      const routeRe = /app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;
      let rm: RegExpExecArray | null;
      while ((rm = routeRe.exec(f.contents)) !== null) {
        routes.push({
          method: (rm[1] ?? 'get').toUpperCase(),
          pattern: rm[2] ?? '',
          file: f.path,
        });
      }

      // Workflows: defineWorkflow('name', [{ name: 'step', ... }, { name: '...', ...}])
      const wfRe = /defineWorkflow\s*\(\s*['"]([^'"]+)['"]\s*,\s*\[([\s\S]*?)\]\s*\)/g;
      let wm: RegExpExecArray | null;
      while ((wm = wfRe.exec(f.contents)) !== null) {
        const wfName = wm[1] ?? '';
        const body = wm[2] ?? '';
        const stepRe = /name\s*:\s*['"]([^'"]+)['"]/g;
        const steps: string[] = [];
        let sm: RegExpExecArray | null;
        while ((sm = stepRe.exec(body)) !== null) {
          if (sm[1]) steps.push(sm[1]);
        }
        workflows.push({ name: wfName, file: f.path, steps });
      }

      // Env vars: process.env.X
      const envRe = /process\.env\.([A-Z][A-Z0-9_]*)/g;
      let em: RegExpExecArray | null;
      while ((em = envRe.exec(f.contents)) !== null) {
        const name = em[1] ?? '';
        if (RUNTIME_INJECTED_ENV.has(name)) continue;
        if (!envVarMap.has(name)) envVarMap.set(name, { firstUseFile: f.path });
      }
    }
  }

  const envExample = args.files.find((f) => f.path === '.env.example' || f.path === 'env.example');
  const envVars: ManifestEnvVar[] = Array.from(envVarMap.entries()).map(([name, info]) => ({
    name,
    firstUseFile: info.firstUseFile,
    documented: envExample
      ? new RegExp(`^\\s*${name}\\s*=`, 'm').test(envExample.contents)
      : false,
  }));

  return {
    files,
    dependencies,
    agents,
    routes,
    workflows,
    envVars,
    generatedBytes,
    fileCount: files.length,
  };
}

function inferRole(path: string): ManifestFile['role'] {
  if (/^web\/.+\.test\./.test(path) || path.startsWith('tests/')) return 'test';
  if (path.startsWith('web/pages/')) return 'web-page';
  if (path.startsWith('web/components/')) return 'web-component';
  if (path.startsWith('web/hooks/')) return 'web-hook';
  if (path.startsWith('web/styles/') || /globals\.css$/.test(path)) return 'web-style';
  if (path.startsWith('web/') && /\.(?:config|json)/i.test(path)) return 'web-config';
  if (/(^|\/)server\.(?:m?js|ts)$/i.test(path)) return 'entry';
  if (path.startsWith('routes/')) return 'route';
  if (path.startsWith('schema/')) return 'schema';
  if (path.startsWith('db/')) return 'db';
  if (path.startsWith('mailer/')) return 'mailer';
  if (path.startsWith('jobs/')) return 'jobs';
  if (path.startsWith('agents/') || path.startsWith('lib/agent/')) return 'agent';
  if (path.startsWith('tools/')) return 'tool';
  if (path.startsWith('workflows/') || path.startsWith('lib/workflow/')) return 'workflow';
  if (path.startsWith('security/')) return 'security';
  if (path.startsWith('observability/')) return 'observability';
  if (path === 'README.md' || path === 'readme.md') return 'doc';
  if (path === 'package.json' || path === '.env.example' || /\.(yml|yaml|toml)$/i.test(path)) return 'config';
  return 'other';
}

function capture(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m && m[1] ? m[1] : null;
}

// ─── Markdown rendering ────────────────────────────────────────────────

export function renderManifestAsMarkdown(args: {
  operationName: string;
  bundleVersion: number;
  manifest: BundleManifest;
  /** Optional LLM-written prose. Falls back to deterministic boilerplate. */
  prose?: ManifestProse;
}): string {
  const { manifest, prose } = args;
  const lines: string[] = [];
  lines.push(`# ${args.operationName} — build manifest v${args.bundleVersion}`);
  lines.push('');
  lines.push(
    prose?.oneLine ??
      `Auto-generated catalogue of everything Argo wrote for "${args.operationName}". Read this once when something breaks; don't read the code unless you have to.`,
  );
  lines.push('');

  // Quick stats
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Stat | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Files | ${manifest.fileCount} |`);
  lines.push(`| Generated code bytes | ${formatBytes(manifest.generatedBytes)} |`);
  lines.push(`| Dependencies | ${Object.keys(manifest.dependencies).length} |`);
  lines.push(`| Agents | ${manifest.agents.length} |`);
  lines.push(`| Routes | ${manifest.routes.length} |`);
  lines.push(`| Workflows | ${manifest.workflows.length} |`);
  lines.push(`| Env vars referenced | ${manifest.envVars.length} |`);
  lines.push('');

  if (prose?.overview) {
    lines.push('## What this app does');
    lines.push('');
    lines.push(prose.overview);
    lines.push('');
  }

  // Files grouped by role.
  lines.push('## Files');
  lines.push('');
  const grouped = new Map<ManifestFile['role'], ManifestFile[]>();
  for (const f of manifest.files) {
    if (!grouped.has(f.role)) grouped.set(f.role, []);
    grouped.get(f.role)!.push(f);
  }
  const ROLE_ORDER: ManifestFile['role'][] = [
    'entry', 'route', 'schema', 'db', 'agent', 'tool', 'workflow', 'mailer',
    'jobs', 'security', 'observability', 'web-page', 'web-component', 'web-hook',
    'web-style', 'web-config', 'test', 'doc', 'config', 'other',
  ];
  for (const role of ROLE_ORDER) {
    const list = grouped.get(role);
    if (!list || list.length === 0) continue;
    lines.push(`### ${prettyRole(role)} (${list.length})`);
    lines.push('');
    for (const f of list) {
      const tag = f.argoGenerated ? '`generated`' : '`scaffolding`';
      lines.push(`- \`${f.path}\` — ${formatBytes(f.bytes)} ${tag}`);
    }
    lines.push('');
  }

  // Dependencies
  if (Object.keys(manifest.dependencies).length > 0) {
    lines.push('## Dependencies');
    lines.push('');
    lines.push('| Package | Version |');
    lines.push('|---|---|');
    for (const [name, version] of Object.entries(manifest.dependencies).sort()) {
      lines.push(`| \`${name}\` | \`${version}\` |`);
    }
    lines.push('');
  }

  // Agents
  if (manifest.agents.length > 0) {
    lines.push('## Agents');
    lines.push('');
    for (const a of manifest.agents) {
      lines.push(`### \`${a.name}\``);
      lines.push(`- File: \`${a.file}\``);
      if (a.model) lines.push(`- Model: \`${a.model}\``);
      if (a.tools.length > 0) lines.push(`- Tools: ${a.tools.map((t) => `\`${t}\``).join(', ')}`);
      lines.push('');
    }
  }

  // Routes
  if (manifest.routes.length > 0) {
    lines.push('## HTTP routes');
    lines.push('');
    lines.push('| Method | Path | File |');
    lines.push('|---|---|---|');
    for (const r of manifest.routes) {
      lines.push(`| ${r.method} | \`${r.pattern}\` | \`${r.file}\` |`);
    }
    lines.push('');
  }

  // Workflows
  if (manifest.workflows.length > 0) {
    lines.push('## Workflows');
    lines.push('');
    for (const w of manifest.workflows) {
      lines.push(`### \`${w.name}\``);
      lines.push(`- File: \`${w.file}\``);
      lines.push(`- Steps: ${w.steps.map((s) => `\`${s}\``).join(' → ')}`);
      lines.push('');
    }
  }

  // Env vars
  if (manifest.envVars.length > 0) {
    lines.push('## Environment variables');
    lines.push('');
    lines.push('| Name | First use | Documented in .env.example |');
    lines.push('|---|---|---|');
    for (const e of manifest.envVars) {
      lines.push(`| \`${e.name}\` | \`${e.firstUseFile}\` | ${e.documented ? '✅' : '❌'} |`);
    }
    lines.push('');
  }

  if (prose?.howItWorks) {
    lines.push('## How it works');
    lines.push('');
    lines.push(prose.howItWorks);
    lines.push('');
  }
  if (prose?.ifSomethingBreaks) {
    lines.push('## If something breaks');
    lines.push('');
    lines.push(prose.ifSomethingBreaks);
    lines.push('');
  }
  if (prose?.knownLimitations) {
    lines.push('## Known limitations');
    lines.push('');
    lines.push(prose.knownLimitations);
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated by Argo at ${new Date().toISOString()}. Re-runs on every deploy.`);
  return lines.join('\n');
}

function prettyRole(role: ManifestFile['role']): string {
  const map: Record<ManifestFile['role'], string> = {
    entry: 'Entry point',
    route: 'HTTP routes',
    schema: 'Schemas (Zod)',
    db: 'Database',
    agent: 'Agents',
    tool: 'Tools',
    workflow: 'Workflows',
    mailer: 'Mailer',
    jobs: 'Background jobs',
    security: 'Security',
    observability: 'Observability',
    'web-page': 'Web pages',
    'web-component': 'Web components',
    'web-hook': 'React hooks',
    'web-style': 'Styles',
    'web-config': 'Web config',
    test: 'Tests',
    doc: 'Documentation',
    config: 'Configuration',
    other: 'Other',
  };
  return map[role];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ─── LLM-written prose sections ────────────────────────────────────────

export const ManifestProse = z.object({
  oneLine: z.string().min(20).max(220),
  overview: z.string().min(80).max(2000),
  howItWorks: z.string().min(80).max(2400),
  ifSomethingBreaks: z.string().min(60).max(1600),
  knownLimitations: z.string().min(40).max(1200),
});
export type ManifestProse = z.infer<typeof ManifestProse>;

const PROSE_SYSTEM = `
You are Argo's documentarian. Given a deterministic catalogue of files /
agents / routes / workflows that Argo just generated, write the prose
sections of the BUILD_MANIFEST.md.

# Hard rules

- Output ONLY a JSON object: { oneLine, overview, howItWorks,
  ifSomethingBreaks, knownLimitations }.
- No prose outside JSON. No markdown fences. No code samples.
- "oneLine" is a hook a CEO would tweet.
- "overview" describes the OUTCOME the operator gets in 2-3 paragraphs.
  Plain English; no class names or function names.
- "howItWorks" describes the MECHANISM in 2-3 paragraphs. You may say
  "a form on your site", "an email arrives", "Argo waits for approval"
  but NEVER name TypeScript classes or libraries.
- "ifSomethingBreaks" tells the operator what to do when a submission
  doesn't show up, an email isn't sent, etc. Reference Argo's repair
  flow ("Argo will email you a proposed fix") rather than asking them
  to read logs.
- "knownLimitations" lists 2-4 honest caveats: rate limits, model edge
  cases, integrations not yet wired. Don't oversell.

# Tone

Senior engineer briefing an executive. Short sentences. No hedging.
`.trim();

export interface ComposeManifestProseArgs {
  operationName: string;
  /** Plain-English brief facts. */
  brief: {
    name: string;
    audience: string;
    outcome: string;
    trigger: string;
  };
  manifest: BundleManifest;
  signal?: AbortSignal;
}

export async function composeManifestProse(args: ComposeManifestProseArgs): Promise<ManifestProse> {
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const apiBase = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  // Manifests are a structured-output task — gpt-4o is plenty.
  const routing = routeModel('classifier');
  const candidates = routing.candidates;
  let lastErr: Error | null = null;

  // Compress the manifest into the smallest input the model needs.
  const userMsg =
    `Operation: ${args.operationName}\n\n` +
    `Brief:\n${JSON.stringify(args.brief, null, 2)}\n\n` +
    `Catalogue summary:\n` +
    `- ${args.manifest.fileCount} files (${formatBytes(args.manifest.generatedBytes)} generated)\n` +
    `- Dependencies: ${Object.keys(args.manifest.dependencies).join(', ') || 'none'}\n` +
    `- Agents: ${args.manifest.agents.map((a) => a.name).join(', ') || 'none'}\n` +
    `- Routes: ${args.manifest.routes.map((r) => `${r.method} ${r.pattern}`).join(', ') || 'none'}\n` +
    `- Workflows: ${args.manifest.workflows.map((w) => w.name).join(', ') || 'none'}\n\n` +
    `Return the prose JSON now.`;

  for (const model of candidates) {
    try {
      const isGpt55 = model.startsWith('gpt-5.5');
      const reqBody: Record<string, unknown> = {
        model,
        response_format: { type: 'json_object' as const },
        max_completion_tokens: 1800,
        messages: [
          { role: 'system' as const, content: PROSE_SYSTEM },
          { role: 'user' as const, content: userMsg },
        ],
      };
      if (!isGpt55) reqBody.temperature = 0.4;
      const res = await request(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(reqBody),
        ...(args.signal ? { signal: args.signal } : {}),
        bodyTimeout: 60_000,
        headersTimeout: 30_000,
      });
      const text = await res.body.text();
      if (res.statusCode >= 400) {
        const err: Error & { status?: number } = new Error(`${model} -> ${res.statusCode}: ${text.slice(0, 200)}`);
        err.status = res.statusCode;
        throw err;
      }
      const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
      const content = parsed.choices?.[0]?.message?.content ?? '{}';
      const json = JSON.parse(content);
      const result = ManifestProse.safeParse(json);
      if (!result.success) {
        lastErr = new Error('manifest prose schema mismatch: ' + result.error.message.slice(0, 240));
        continue;
      }
      return result.data;
    } catch (err) {
      const e = err as Error & { status?: number };
      const transient = e.status === 404 || e.status === 400 ||
        /model_not_found|invalid model/i.test(e.message ?? '');
      if (!transient) throw err;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('composeManifestProse: no candidate model succeeded');
}
