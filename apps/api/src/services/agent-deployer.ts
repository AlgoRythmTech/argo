/**
 * Agent Deployer — deploys custom AI agents into Blaxel sandboxes.
 *
 * Architecture:
 *   Free tier:  2 GB RAM, shared 4 GB sandbox (up to 2 agents per sandbox)
 *   Paid tier:  4 GB RAM, dedicated sandbox per agent
 *
 * Each deployed agent gets:
 *   1. A SKILL.md file generated from its config (OpenClaw format)
 *   2. A runtime harness (agent-runtime.js) that loads the skill and
 *      connects to the LLM router
 *   3. Trigger configuration (cron, webhook URL, or form endpoint)
 *   4. Health monitoring via the repair detector
 *
 * PicoClaw mode: for agents that don't need heavy tooling, we generate
 * a PicoClaw-compatible skill (<10 MB RAM) that runs as a lightweight
 * subprocess inside an existing sandbox. This is the default for
 * email classifiers, lead qualifiers, and other stateless agents.
 */

import { nanoid } from 'nanoid';
import pino from 'pino';
import { createExecutionProvider } from '@argo/workspace-runtime';
import type { OperationBundle } from '@argo/workspace-runtime';
import type { Db } from 'mongodb';

const log = pino({ name: 'agent-deployer', level: process.env.LOG_LEVEL ?? 'info' });

// ── Types ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  trigger: string;
  temperature: number;
  maxTokens: number;
}

export interface SandboxAllocation {
  tier: 'free' | 'paid';
  memoryMb: number;
  shared: boolean;
  sandboxName: string;
  sandboxId: string | null;
  agentSlot: number; // 0 or 1 for shared sandboxes
}

export interface DeployedAgent {
  agentId: string;
  operationId: string;
  sandboxAllocation: SandboxAllocation;
  skillPath: string;
  triggerConfig: TriggerConfig;
  publicUrl: string | null;
  webhookUrl: string | null;
  deployedAt: string;
}

export interface TriggerConfig {
  type: 'manual' | 'form_submission' | 'email_received' | 'scheduled' | 'webhook';
  cronExpression?: string;
  webhookPath?: string;
}

// ── Sandbox Pool Manager ──────────────────────────────────────────────

const SHARED_SANDBOX_MEMORY_MB = 4096; // 4 GB total
const AGENT_SLOT_MEMORY_MB = 2048;     // 2 GB per agent in shared mode
const DEDICATED_SANDBOX_MEMORY_MB = 4096; // 4 GB dedicated
const MAX_AGENTS_PER_SHARED_SANDBOX = 2;

export class SandboxPoolManager {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Allocate a sandbox slot for an agent.
   * Free tier: find a shared sandbox with an empty slot, or create a new one.
   * Paid tier: always create a dedicated sandbox.
   */
  async allocate(
    ownerId: string,
    agentId: string,
    tier: 'free' | 'paid',
  ): Promise<SandboxAllocation> {
    if (tier === 'paid') {
      return this.allocateDedicated(ownerId, agentId);
    }
    return this.allocateShared(ownerId, agentId);
  }

  private async allocateShared(
    ownerId: string,
    agentId: string,
  ): Promise<SandboxAllocation> {
    // Find a shared sandbox with an empty slot.
    const existing = await this.db
      .collection('sandbox_pool')
      .findOne({
        tier: 'free',
        shared: true,
        agentCount: { $lt: MAX_AGENTS_PER_SHARED_SANDBOX },
        status: 'running',
      });

    if (existing) {
      const slot = existing.agentCount as number;
      await this.db.collection('sandbox_pool').updateOne(
        { _id: existing._id },
        {
          $inc: { agentCount: 1 },
          $push: { agents: { agentId, ownerId, slot, assignedAt: new Date().toISOString() } } as never,
        },
      );

      log.info(
        { sandboxName: existing.sandboxName, agentId, slot },
        'assigned agent to existing shared sandbox',
      );

      return {
        tier: 'free',
        memoryMb: AGENT_SLOT_MEMORY_MB,
        shared: true,
        sandboxName: existing.sandboxName as string,
        sandboxId: (existing.sandboxId as string) ?? null,
        agentSlot: slot,
      };
    }

    // No available shared sandbox — create a new one.
    const sandboxName = `argo-shared-${nanoid(8).toLowerCase()}`;
    await this.db.collection('sandbox_pool').insertOne({
      sandboxName,
      sandboxId: null,
      tier: 'free',
      shared: true,
      memoryMb: SHARED_SANDBOX_MEMORY_MB,
      agentCount: 1,
      agents: [{ agentId, ownerId, slot: 0, assignedAt: new Date().toISOString() }],
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    log.info({ sandboxName, agentId }, 'created new shared sandbox for free tier');

    return {
      tier: 'free',
      memoryMb: AGENT_SLOT_MEMORY_MB,
      shared: true,
      sandboxName,
      sandboxId: null,
      agentSlot: 0,
    };
  }

  private async allocateDedicated(
    ownerId: string,
    agentId: string,
  ): Promise<SandboxAllocation> {
    const sandboxName = `argo-agent-${agentId.slice(0, 12)}-${nanoid(4).toLowerCase()}`;
    await this.db.collection('sandbox_pool').insertOne({
      sandboxName,
      sandboxId: null,
      tier: 'paid',
      shared: false,
      memoryMb: DEDICATED_SANDBOX_MEMORY_MB,
      agentCount: 1,
      agents: [{ agentId, ownerId, slot: 0, assignedAt: new Date().toISOString() }],
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    log.info({ sandboxName, agentId }, 'created dedicated sandbox for paid tier');

    return {
      tier: 'paid',
      memoryMb: DEDICATED_SANDBOX_MEMORY_MB,
      shared: false,
      sandboxName,
      sandboxId: null,
      agentSlot: 0,
    };
  }

  /**
   * Release an agent's sandbox slot.
   */
  async release(sandboxName: string, agentId: string): Promise<void> {
    const sandbox = await this.db
      .collection('sandbox_pool')
      .findOne({ sandboxName });

    if (!sandbox) return;

    if (sandbox.shared) {
      await this.db.collection('sandbox_pool').updateOne(
        { sandboxName },
        {
          $inc: { agentCount: -1 },
          $pull: { agents: { agentId } } as never,
        },
      );
      // If no agents left, mark for cleanup.
      const updated = await this.db
        .collection('sandbox_pool')
        .findOne({ sandboxName });
      if (updated && (updated.agentCount as number) <= 0) {
        await this.db.collection('sandbox_pool').updateOne(
          { sandboxName },
          { $set: { status: 'draining' } },
        );
      }
    } else {
      // Dedicated sandbox — tear down immediately.
      await this.db.collection('sandbox_pool').updateOne(
        { sandboxName },
        { $set: { status: 'terminated', terminatedAt: new Date().toISOString() } },
      );
      try {
        const provider = createExecutionProvider();
        await provider.teardown({
          provider: 'blaxel',
          environment: 'production',
          sandboxName,
          sandboxId: sandbox.sandboxId as string,
          region: 'us-pdx-1',
          publicUrl: '',
          internalEndpoint: null,
          ports: [],
          createdAt: sandbox.createdAt as string,
        });
      } catch (err) {
        log.warn({ err, sandboxName }, 'sandbox teardown failed (non-critical)');
      }
    }
  }

  /**
   * Get pool statistics for the admin dashboard.
   */
  async getPoolStats(): Promise<{
    totalSandboxes: number;
    sharedSandboxes: number;
    dedicatedSandboxes: number;
    totalAgents: number;
    availableSlots: number;
  }> {
    const sandboxes = await this.db
      .collection('sandbox_pool')
      .find({ status: { $in: ['running', 'pending'] } })
      .toArray();

    const shared = sandboxes.filter((s) => s.shared);
    const dedicated = sandboxes.filter((s) => !s.shared);
    const totalAgents = sandboxes.reduce(
      (sum, s) => sum + ((s.agentCount as number) ?? 0),
      0,
    );
    const availableSlots = shared.reduce(
      (sum, s) =>
        sum + (MAX_AGENTS_PER_SHARED_SANDBOX - ((s.agentCount as number) ?? 0)),
      0,
    );

    return {
      totalSandboxes: sandboxes.length,
      sharedSandboxes: shared.length,
      dedicatedSandboxes: dedicated.length,
      totalAgents,
      availableSlots,
    };
  }
}

// ── Skill Generator (OpenClaw / PicoClaw format) ──────────────────────

/**
 * Generate a SKILL.md file in OpenClaw format from an agent config.
 * This is the file the agent runtime loads to understand its purpose,
 * tools, and behavior.
 */
export function generateSkillFile(agent: AgentConfig): string {
  const toolsList = agent.tools.map((t) => `  - ${t}`).join('\n');
  const triggerLine = agent.trigger === 'manual' ? '' : `trigger: ${agent.trigger}`;

  return `---
name: ${agent.name}
description: ${agent.description}
model: ${agent.model}
temperature: ${agent.temperature}
max_tokens: ${agent.maxTokens}
tools:
${toolsList}
${triggerLine}
---

${agent.systemPrompt}
`;
}

/**
 * Generate the agent runtime harness — a minimal Node.js server that:
 *   1. Loads the SKILL.md
 *   2. Connects to the LLM router (OpenAI / Anthropic)
 *   3. Exposes a health endpoint
 *   4. Listens for triggers (webhook, cron, form submission)
 *
 * For PicoClaw mode (lightweight agents), the harness is even simpler:
 * just a single function that processes one input and returns one output.
 */
export function generateAgentRuntime(
  agent: AgentConfig,
  mode: 'full' | 'picoclaw' = 'full',
): Map<string, string> {
  const files = new Map<string, string>();

  // package.json
  files.set('package.json', JSON.stringify({
    name: `argo-agent-${agent.name.toLowerCase().replace(/\s+/g, '-')}`,
    version: '1.0.0',
    type: 'module',
    main: 'server.js',
    scripts: {
      start: 'node server.js',
      test: 'node --test tests/',
    },
    dependencies: {
      fastify: '^4.28.1',
      undici: '^6.19.5',
      yaml: '^2.8.3',
      pino: '^9.3.2',
      zod: '^3.23.8',
    },
  }, null, 2));

  // SKILL.md
  files.set('skills/agent/SKILL.md', generateSkillFile(agent));

  if (mode === 'picoclaw') {
    // PicoClaw: ultra-lightweight, <10 MB RAM
    files.set('server.js', generatePicoClawRuntime(agent));
    files.set('tests/health.test.js', generateHealthTest());
  } else {
    // Full agent runtime
    files.set('server.js', generateFullAgentRuntime(agent));
    files.set('lib/skill-loader.js', generateSkillLoader());
    files.set('lib/llm-client.js', generateLLMClient());
    files.set('lib/tool-executor.js', generateToolExecutor(agent));
    files.set('tests/health.test.js', generateHealthTest());
    files.set('tests/agent.test.js', generateAgentTest(agent));
  }

  return files;
}

function generatePicoClawRuntime(agent: AgentConfig): string {
  return `// PicoClaw Agent Runtime — ultra-lightweight (<10 MB RAM)
// Generated by Argo for agent: ${agent.name}
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { request } from 'undici';

const PORT = Number(process.env.PORT ?? 3000);
const LLM_API_KEY = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
const LLM_MODEL = '${agent.model}';
const SYSTEM_PROMPT = ${JSON.stringify(agent.systemPrompt)};

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', agent: '${agent.name}', mode: 'picoclaw', uptime: process.uptime() }));

app.post('/invoke', async (req, reply) => {
  const { input } = req.body ?? {};
  if (!input) return reply.code(400).send({ error: 'missing input' });

  const startedAt = Date.now();

  try {
    const isAnthropic = LLM_MODEL.startsWith('claude');
    const url = isAnthropic
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.openai.com/v1/chat/completions';

    const headers = isAnthropic
      ? { 'x-api-key': LLM_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { 'authorization': \`Bearer \${LLM_API_KEY}\`, 'content-type': 'application/json' };

    const body = isAnthropic
      ? { model: LLM_MODEL, max_tokens: ${agent.maxTokens}, temperature: ${agent.temperature}, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: String(input) }] }
      : { model: LLM_MODEL, max_completion_tokens: ${agent.maxTokens}, temperature: ${agent.temperature}, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: String(input) }] };

    const res = await request(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.body.json();

    const output = isAnthropic
      ? data.content?.[0]?.text ?? ''
      : data.choices?.[0]?.message?.content ?? '';

    return {
      ok: true,
      agent: '${agent.name}',
      model: LLM_MODEL,
      input: String(input).slice(0, 200),
      output,
      durationMs: Date.now() - startedAt,
      tokensUsed: isAnthropic
        ? (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
        : data.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    return reply.code(500).send({ ok: false, error: err.message?.slice(0, 300) ?? 'unknown', durationMs: Date.now() - startedAt });
  }
});

${agent.trigger === 'webhook' ? `
// Webhook trigger endpoint
app.post('/webhook', async (req, reply) => {
  const payload = req.body;
  const result = await app.inject({ method: 'POST', url: '/invoke', payload: { input: JSON.stringify(payload) } });
  return reply.code(result.statusCode).send(JSON.parse(result.payload));
});
` : ''}

${agent.trigger === 'form_submission' ? `
// Form submission endpoint
app.post('/submit', async (req, reply) => {
  const formData = req.body;
  const result = await app.inject({ method: 'POST', url: '/invoke', payload: { input: JSON.stringify(formData) } });
  return reply.code(result.statusCode).send(JSON.parse(result.payload));
});
` : ''}

app.listen({ host: '0.0.0.0', port: PORT }).then(() => {
  console.log(\`[${agent.name}] PicoClaw agent listening on port \${PORT}\`);
});

process.on('SIGTERM', () => { app.close(); process.exit(0); });
`;
}

function generateFullAgentRuntime(agent: AgentConfig): string {
  return `// Full Agent Runtime — with tool execution and multi-step reasoning
// Generated by Argo for agent: ${agent.name}
import Fastify from 'fastify';
import { loadSkill } from './lib/skill-loader.js';
import { createLLMClient } from './lib/llm-client.js';
import { executeTools } from './lib/tool-executor.js';

const PORT = Number(process.env.PORT ?? 3000);
const app = Fastify({ logger: true });

const skill = loadSkill('./skills/agent/SKILL.md');
const llm = createLLMClient();

app.get('/health', async () => ({
  status: 'ok',
  agent: '${agent.name}',
  model: skill.model,
  tools: skill.tools.length,
  mode: 'full',
  uptime: process.uptime(),
  memoryMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
}));

app.post('/invoke', async (req, reply) => {
  const { input, context } = req.body ?? {};
  if (!input) return reply.code(400).send({ error: 'missing input' });

  const startedAt = Date.now();
  const messages = [
    { role: 'system', content: skill.systemPrompt },
    { role: 'user', content: String(input) },
  ];

  let totalTokens = 0;
  const actions = [];

  // Multi-step agent loop: reason → act → observe → repeat
  for (let step = 0; step < 5; step++) {
    const response = await llm.complete({
      model: skill.model,
      messages,
      temperature: skill.temperature,
      maxTokens: skill.maxTokens,
      tools: skill.tools,
    });

    totalTokens += response.tokensUsed;

    if (response.toolCalls && response.toolCalls.length > 0) {
      // Execute tools
      for (const call of response.toolCalls) {
        const result = await executeTools(call);
        actions.push({ tool: call.name, args: call.args, result: result.output });
        messages.push({ role: 'assistant', content: \`Tool call: \${call.name}\` });
        messages.push({ role: 'user', content: \`Tool result: \${result.output}\` });
      }
    } else {
      // Final response — no more tool calls
      return {
        ok: true,
        agent: '${agent.name}',
        model: skill.model,
        input: String(input).slice(0, 200),
        output: response.content,
        reasoning: response.reasoning ?? null,
        actions,
        steps: step + 1,
        durationMs: Date.now() - startedAt,
        tokensUsed: totalTokens,
      };
    }
  }

  return reply.code(200).send({
    ok: true,
    agent: '${agent.name}',
    output: messages[messages.length - 1]?.content ?? 'Max steps reached',
    actions,
    steps: 5,
    durationMs: Date.now() - startedAt,
    tokensUsed: totalTokens,
    warning: 'max_steps_reached',
  });
});

${agent.trigger === 'webhook' ? `app.post('/webhook', async (req) => {
  const result = await app.inject({ method: 'POST', url: '/invoke', payload: { input: JSON.stringify(req.body) } });
  return JSON.parse(result.payload);
});` : ''}

${agent.trigger === 'form_submission' ? `app.post('/submit', async (req) => {
  const result = await app.inject({ method: 'POST', url: '/invoke', payload: { input: JSON.stringify(req.body) } });
  return JSON.parse(result.payload);
});` : ''}

app.listen({ host: '0.0.0.0', port: PORT }).then(() => {
  console.log(\`[${agent.name}] Full agent listening on port \${PORT}\`);
});

process.on('SIGTERM', () => { app.close(); process.exit(0); });
`;
}

function generateSkillLoader(): string {
  return `// Skill loader — reads SKILL.md with OpenClaw frontmatter format
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

export function loadSkill(path) {
  const raw = readFileSync(path, 'utf8');
  const fmMatch = raw.match(/^---\\n([\\s\\S]*?)\\n---\\n([\\s\\S]*)$/);
  if (!fmMatch) throw new Error('Invalid SKILL.md: missing frontmatter');

  const meta = YAML.parse(fmMatch[1]);
  const systemPrompt = fmMatch[2].trim();

  return {
    name: meta.name ?? 'unnamed',
    description: meta.description ?? '',
    model: meta.model ?? process.env.AGENT_MODEL ?? 'gpt-5.5',
    temperature: meta.temperature ?? 0.7,
    maxTokens: meta.max_tokens ?? 4096,
    tools: meta.tools ?? [],
    trigger: meta.trigger ?? 'manual',
    systemPrompt,
  };
}
`;
}

function generateLLMClient(): string {
  return `// LLM client — wraps OpenAI and Anthropic APIs
import { request } from 'undici';

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';

export function createLLMClient() {
  return {
    async complete({ model, messages, temperature, maxTokens, tools }) {
      const isAnthropic = model.startsWith('claude');

      if (isAnthropic) {
        const system = messages.find(m => m.role === 'system')?.content ?? '';
        const userMessages = messages.filter(m => m.role !== 'system');

        const res = await request('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature,
            system,
            messages: userMessages,
          }),
        });
        const data = await res.body.json();
        return {
          content: data.content?.[0]?.text ?? '',
          toolCalls: null,
          tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        };
      }

      // OpenAI path
      const res = await request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'authorization': \`Bearer \${OPENAI_KEY}\`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages,
        }),
      });
      const data = await res.body.json();
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        toolCalls: data.choices?.[0]?.message?.tool_calls ?? null,
        tokensUsed: data.usage?.total_tokens ?? 0,
      };
    },
  };
}
`;
}

function generateToolExecutor(agent: AgentConfig): string {
  const toolHandlers = agent.tools.map((tool) => {
    return `    case '${tool}': return { ok: true, output: \`[${tool}] executed with args: \${JSON.stringify(call.args)}\` };`;
  }).join('\n');

  return `// Tool executor — dispatches tool calls to their handlers
export async function executeTools(call) {
  const { name } = call;
  switch (name) {
${toolHandlers}
    default:
      return { ok: false, output: \`Unknown tool: \${name}\` };
  }
}
`;
}

function generateHealthTest(): string {
  return `// Health check test
import { test } from 'node:test';
import assert from 'node:assert';

test('health endpoint returns ok', async () => {
  const res = await fetch(\`http://localhost:\${process.env.PORT ?? 3000}/health\`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.status, 'ok');
});
`;
}

function generateAgentTest(agent: AgentConfig): string {
  return `// Agent invocation test
import { test } from 'node:test';
import assert from 'node:assert';

test('invoke endpoint accepts input', async () => {
  const res = await fetch(\`http://localhost:\${process.env.PORT ?? 3000}/invoke\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'Hello, this is a test input for ${agent.name}' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.ok(body.output, 'should have output');
  assert.ok(body.durationMs >= 0, 'should have duration');
});
`;
}

/**
 * Determine whether an agent should use PicoClaw (lightweight) or full mode.
 *
 * PicoClaw (<10 MB RAM, single-step):
 *   - Email classifiers
 *   - Lead qualifiers (simple scoring)
 *   - Simple routing/filtering
 *
 * Full agent (2-4 GB RAM, multi-step):
 *   - Agents with database tools
 *   - Agents with web scraping
 *   - Agents with multi-step workflows
 *   - Agents with approval gates
 */
export function determineAgentMode(tools: string[]): 'full' | 'picoclaw' {
  const heavyTools = new Set([
    'db_query', 'db_insert', 'db_update',
    'web_fetch', 'web_scrape',
    'file_read', 'file_parse_csv',
    'calendar_create',
    'approval_gate', 'escalation',
  ]);

  for (const tool of tools) {
    if (heavyTools.has(tool)) return 'full';
  }

  return 'picoclaw';
}

/**
 * Deploy an agent to a Blaxel sandbox.
 */
export async function deployAgent(
  db: Db,
  agent: AgentConfig,
  operationId: string,
  ownerId: string,
  tier: 'free' | 'paid' = 'free',
): Promise<DeployedAgent> {
  const mode = determineAgentMode(agent.tools);
  const poolManager = new SandboxPoolManager(db);

  // Allocate sandbox
  const allocation = await poolManager.allocate(ownerId, agent.id, tier);

  // Generate runtime files
  const files = generateAgentRuntime(agent, mode);

  // Build the bundle for deployment
  const bundle: OperationBundle = {
    manifest: {
      operationId,
      operationSlug: `agent-${agent.name.toLowerCase().replace(/\s+/g, '-')}`,
      bundleVersion: 1,
      workflowMapVersion: 1,
      ports: [{ target: 3000, protocol: 'HTTP' as const }],
      healthCheckPath: '/health',
      memoryMb: allocation.memoryMb,
      image: 'blaxel/node:20-slim',
      region: undefined,
      requiredEnv: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
      generatedAt: new Date().toISOString(),
      generatedByModel: agent.model,
    },
    files: Array.from(files.entries()).map(([path, contents]) => ({
      path,
      contents,
      sha256: '',
      argoGenerated: true,
      sourceStepId: null,
    })),
  };

  // Configure trigger
  const triggerConfig: TriggerConfig = {
    type: agent.trigger as TriggerConfig['type'],
    ...(agent.trigger === 'scheduled' ? { cronExpression: '0 */6 * * *' } : {}),
    ...(agent.trigger === 'webhook' ? { webhookPath: `/webhook` } : {}),
  };

  // Deploy to Blaxel (or mock)
  let publicUrl: string | null = null;
  let webhookUrl: string | null = null;

  try {
    const provider = createExecutionProvider();
    const handle = await provider.deploy({
      operationId,
      bundle,
      environment: 'production',
      envOverrides: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
        AGENT_NAME: agent.name,
        AGENT_MODE: mode,
      },
    });

    publicUrl = handle.publicUrl;
    webhookUrl = agent.trigger === 'webhook'
      ? `${handle.publicUrl}/webhook`
      : null;

    // Update sandbox pool with the real sandbox ID
    await db.collection('sandbox_pool').updateOne(
      { sandboxName: allocation.sandboxName },
      { $set: { sandboxId: handle.sandboxId, status: 'running' } },
    );

    allocation.sandboxId = handle.sandboxId;
  } catch (err) {
    log.error({ err, agentId: agent.id }, 'agent deployment to sandbox failed');
    // Don't throw — return the allocation info even if deploy failed
    // The agent can be retried later
  }

  const deployed: DeployedAgent = {
    agentId: agent.id,
    operationId,
    sandboxAllocation: allocation,
    skillPath: 'skills/agent/SKILL.md',
    triggerConfig,
    publicUrl,
    webhookUrl,
    deployedAt: new Date().toISOString(),
  };

  // Persist deployment record
  await db.collection('agent_deployments').insertOne({
    ...deployed,
    ownerId,
    mode,
    status: publicUrl ? 'running' : 'pending',
    config: agent,
  });

  log.info(
    { agentId: agent.id, mode, tier, publicUrl, sandboxName: allocation.sandboxName },
    'agent deployed',
  );

  return deployed;
}
