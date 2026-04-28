import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { deployAgent, determineAgentMode, generateSkillFile, SandboxPoolManager, type AgentConfig } from '../services/agent-deployer.js';
import { logger } from '../logger.js';

/**
 * Agent Builder API — Create, configure, test, and deploy custom AI agents.
 *
 * This is what makes Argo an agent PLATFORM, not just an app builder.
 * Users can create agents with custom tools, triggers, system prompts,
 * and deploy them as autonomous workflow operators.
 */

const AVAILABLE_TOOLS = [
  {
    id: 'email_send',
    name: 'Send Email',
    category: 'email',
    description: 'Send an email to a recipient with subject and body',
    parameters: [
      { name: 'to', type: 'string', required: true },
      { name: 'subject', type: 'string', required: true },
      { name: 'body', type: 'string', required: true },
      { name: 'cc', type: 'string', required: false },
    ],
  },
  {
    id: 'email_read',
    name: 'Read Emails',
    category: 'email',
    description: 'Read recent emails from the operation inbox',
    parameters: [
      { name: 'limit', type: 'number', required: false },
      { name: 'since', type: 'string', required: false },
    ],
  },
  {
    id: 'email_classify',
    name: 'Classify Email',
    category: 'email',
    description: 'Classify an email by intent, urgency, and sentiment',
    parameters: [
      { name: 'emailId', type: 'string', required: true },
      { name: 'categories', type: 'string[]', required: false },
    ],
  },
  {
    id: 'db_query',
    name: 'Query Database',
    category: 'database',
    description: 'Run a read-only query against the operation database',
    parameters: [
      { name: 'collection', type: 'string', required: true },
      { name: 'filter', type: 'object', required: false },
      { name: 'limit', type: 'number', required: false },
    ],
  },
  {
    id: 'db_insert',
    name: 'Insert Record',
    category: 'database',
    description: 'Insert a new record into a collection',
    parameters: [
      { name: 'collection', type: 'string', required: true },
      { name: 'document', type: 'object', required: true },
    ],
  },
  {
    id: 'db_update',
    name: 'Update Record',
    category: 'database',
    description: 'Update an existing record in a collection',
    parameters: [
      { name: 'collection', type: 'string', required: true },
      { name: 'filter', type: 'object', required: true },
      { name: 'update', type: 'object', required: true },
    ],
  },
  {
    id: 'web_fetch',
    name: 'Fetch URL',
    category: 'web',
    description: 'Fetch data from a URL (GET, POST, etc.)',
    parameters: [
      { name: 'url', type: 'string', required: true },
      { name: 'method', type: 'string', required: false },
      { name: 'headers', type: 'object', required: false },
      { name: 'body', type: 'string', required: false },
    ],
  },
  {
    id: 'web_scrape',
    name: 'Scrape Page',
    category: 'web',
    description: 'Extract structured data from a web page',
    parameters: [
      { name: 'url', type: 'string', required: true },
      { name: 'selector', type: 'string', required: false },
    ],
  },
  {
    id: 'file_read',
    name: 'Read File',
    category: 'file',
    description: 'Read the contents of a file',
    parameters: [
      { name: 'path', type: 'string', required: true },
    ],
  },
  {
    id: 'file_parse_csv',
    name: 'Parse CSV',
    category: 'file',
    description: 'Parse a CSV file into structured records',
    parameters: [
      { name: 'path', type: 'string', required: true },
      { name: 'delimiter', type: 'string', required: false },
    ],
  },
  {
    id: 'calendar_create',
    name: 'Create Calendar Event',
    category: 'calendar',
    description: 'Create a new calendar event',
    parameters: [
      { name: 'title', type: 'string', required: true },
      { name: 'start', type: 'string', required: true },
      { name: 'end', type: 'string', required: true },
      { name: 'attendees', type: 'string[]', required: false },
    ],
  },
  {
    id: 'notification_slack',
    name: 'Send Slack Message',
    category: 'notification',
    description: 'Send a message to a Slack channel or user',
    parameters: [
      { name: 'channel', type: 'string', required: true },
      { name: 'message', type: 'string', required: true },
    ],
  },
  {
    id: 'notification_webhook',
    name: 'Fire Webhook',
    category: 'notification',
    description: 'Send a webhook to an external URL',
    parameters: [
      { name: 'url', type: 'string', required: true },
      { name: 'payload', type: 'object', required: true },
    ],
  },
  {
    id: 'approval_gate',
    name: 'Human Approval Gate',
    category: 'approval',
    description: 'Pause execution and wait for human approval via email',
    parameters: [
      { name: 'approver', type: 'string', required: true },
      { name: 'summary', type: 'string', required: true },
      { name: 'expiresInHours', type: 'number', required: false },
    ],
  },
  {
    id: 'escalation',
    name: 'Escalate to Human',
    category: 'approval',
    description: 'Escalate an issue to a human operator with context',
    parameters: [
      { name: 'reason', type: 'string', required: true },
      { name: 'context', type: 'object', required: false },
      { name: 'urgency', type: 'string', required: false },
    ],
  },
] as const;

const AGENT_TEMPLATES = [
  {
    slug: 'email-classifier',
    name: 'Email Classifier',
    description: 'Sorts incoming emails by intent, urgency, and routes them to the right handler',
    icon: 'mail',
    category: 'email',
    model: 'gpt-5.5',
    systemPrompt:
      'You are an email classification agent. For each incoming email, determine the intent (inquiry, complaint, order, support, spam), urgency (high, medium, low), and sentiment (positive, neutral, negative). Route accordingly.',
    tools: ['email_read', 'email_classify', 'db_insert', 'notification_slack'],
    trigger: 'email_received',
  },
  {
    slug: 'lead-qualifier',
    name: 'Lead Qualifier',
    description: 'Scores and routes inbound leads based on company size, budget, and fit',
    icon: 'target',
    category: 'sales',
    model: 'gpt-5.5',
    systemPrompt:
      'You are a lead qualification agent. Score each lead on a 1-100 scale based on company size, budget, timeline, and product fit. Route hot leads (80+) immediately to sales, warm leads (50-79) to nurture, cold leads (<50) to archive.',
    tools: ['email_read', 'web_fetch', 'db_insert', 'email_send', 'notification_slack'],
    trigger: 'form_submission',
  },
  {
    slug: 'support-triage',
    name: 'Customer Support Triage',
    description: 'Categorizes support tickets, auto-responds to common issues, escalates complex ones',
    icon: 'headphones',
    category: 'support',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a customer support triage agent. Categorize each ticket (billing, technical, account, feature-request). Auto-respond to common issues with solution articles. Escalate complex or emotional tickets to human support with full context.',
    tools: ['email_read', 'email_classify', 'email_send', 'db_query', 'escalation', 'db_insert'],
    trigger: 'email_received',
  },
  {
    slug: 'candidate-screener',
    name: 'Candidate Screener',
    description: 'Screens job applications, scores candidates, and sends personalized responses',
    icon: 'users',
    category: 'recruiting',
    model: 'gpt-5.5',
    systemPrompt:
      'You are a candidate screening agent for a recruiting agency. For each application: extract key qualifications, match against job requirements, score fit (1-100), draft a personalized response. Strong matches (75+) get forwarded to the hiring manager. Others get a polite, specific rejection explaining why.',
    tools: ['email_read', 'file_parse_csv', 'db_insert', 'email_send', 'approval_gate'],
    trigger: 'form_submission',
  },
  {
    slug: 'invoice-processor',
    name: 'Invoice Processor',
    description: 'Extracts data from invoices, validates amounts, and routes for approval',
    icon: 'receipt',
    category: 'finance',
    model: 'gpt-5.5',
    systemPrompt:
      'You are an invoice processing agent. Extract vendor name, invoice number, line items, amounts, tax, and total from each invoice. Validate amounts add up correctly. Route invoices over $5,000 for human approval. Auto-approve recurring vendor invoices under $1,000.',
    tools: ['file_read', 'db_insert', 'db_query', 'approval_gate', 'notification_webhook'],
    trigger: 'email_received',
  },
  {
    slug: 'meeting-scheduler',
    name: 'Meeting Scheduler',
    description: 'Handles scheduling via email, checks availability, and sends calendar invites',
    icon: 'calendar',
    category: 'productivity',
    model: 'claude-sonnet-4-6',
    systemPrompt:
      'You are a meeting scheduling agent. When someone requests a meeting via email, check calendar availability, propose 3 time slots, and once confirmed, create the calendar event and send invites to all attendees. Handle timezone conversions automatically.',
    tools: ['email_read', 'email_send', 'calendar_create', 'db_query'],
    trigger: 'email_received',
  },
] as const;

export async function registerAgentBuilderRoutes(app: FastifyInstance) {
  /** GET /api/agents/tools — List available tools for agent configuration. */
  app.get('/api/agents/tools', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send({ tools: AVAILABLE_TOOLS });
  });

  /** GET /api/agents/templates — List pre-built agent templates. */
  app.get('/api/agents/templates', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send({ templates: AGENT_TEMPLATES });
  });

  /** GET /api/agents — List user's custom agents. */
  app.get('/api/agents', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { db } = await getMongo();
    const agents = await db
      .collection('custom_agents')
      .find({ ownerId: session.userId })
      .sort({ updatedAt: -1 })
      .toArray();

    return reply.send({
      agents: agents.map((a) => ({
        id: a._id?.toString(),
        name: a.name,
        description: a.description,
        model: a.model,
        tools: a.tools,
        trigger: a.trigger,
        status: a.status ?? 'draft',
        operationId: a.operationId ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        invocationCount: a.invocationCount ?? 0,
      })),
    });
  });

  /** POST /api/agents — Create a new custom agent. */
  app.post('/api/agents', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const body = request.body as {
      name: string;
      description?: string;
      model: string;
      systemPrompt: string;
      tools: string[];
      trigger: string;
      temperature?: number;
      maxTokens?: number;
      operationId?: string;
    };

    if (!body.name || !body.model || !body.systemPrompt || !body.tools?.length) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: 'name, model, systemPrompt, and tools are required',
      });
    }

    const { db } = await getMongo();
    const now = new Date().toISOString();

    const result = await db.collection('custom_agents').insertOne({
      ownerId: session.userId,
      name: body.name,
      description: body.description ?? '',
      model: body.model,
      systemPrompt: body.systemPrompt,
      tools: body.tools,
      trigger: body.trigger ?? 'manual',
      temperature: body.temperature ?? 0.7,
      maxTokens: body.maxTokens ?? 4096,
      operationId: body.operationId ?? null,
      status: 'draft',
      invocationCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return reply.code(201).send({
      ok: true,
      agentId: result.insertedId.toString(),
      name: body.name,
      status: 'draft',
    });
  });

  /** PATCH /api/agents/:id — Update an agent configuration. */
  app.patch('/api/agents/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const agentId = String((request.params as { id: string }).id);
    const body = request.body as Partial<{
      name: string;
      description: string;
      model: string;
      systemPrompt: string;
      tools: string[];
      trigger: string;
      temperature: number;
      maxTokens: number;
      status: string;
    }>;

    const { db } = await getMongo();
    const { ObjectId } = await import('mongodb');

    const result = await db.collection('custom_agents').findOneAndUpdate(
      { _id: new ObjectId(agentId), ownerId: session.userId },
      { $set: { ...body, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );

    if (!result) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return reply.send({ ok: true, agent: result });
  });

  /** POST /api/agents/:id/test — Test an agent with sample input. */
  app.post('/api/agents/:id/test', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const agentId = String((request.params as { id: string }).id);
    const { input } = request.body as { input: string };

    const { db } = await getMongo();
    const { ObjectId } = await import('mongodb');

    const agent = await db
      .collection('custom_agents')
      .findOne({ _id: new ObjectId(agentId), ownerId: session.userId });

    if (!agent) {
      return reply.code(404).send({ error: 'not_found' });
    }

    // Record test invocation.
    const now = new Date().toISOString();
    await db.collection('agent_test_runs').insertOne({
      agentId,
      ownerId: session.userId,
      input,
      status: 'pending',
      createdAt: now,
    });

    // In production, this would dispatch to the LLM router.
    // For now, return a structured test response.
    return reply.send({
      ok: true,
      agentId,
      testResult: {
        input,
        reasoning: `Agent "${agent.name}" would process this input using ${agent.tools.length} tools with the ${agent.model} model.`,
        actions: agent.tools.slice(0, 3).map((toolId: string) => ({
          tool: toolId,
          status: 'simulated',
          result: `Would execute ${toolId} based on input analysis`,
        })),
        output: `Processed: "${input.slice(0, 100)}" — agent would take ${agent.tools.length} possible actions based on system prompt analysis.`,
        model: agent.model,
        tokensUsed: 0,
        durationMs: 0,
      },
    });
  });

  /** POST /api/agents/:id/deploy — Deploy an agent to a Blaxel sandbox. */
  app.post('/api/agents/:id/deploy', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const agentId = String((request.params as { id: string }).id);
    const { operationId, tier } = request.body as {
      operationId?: string;
      tier?: 'free' | 'paid';
    };

    const { db } = await getMongo();
    const { ObjectId } = await import('mongodb');

    const agent = await db
      .collection('custom_agents')
      .findOne({ _id: new ObjectId(agentId), ownerId: session.userId });

    if (!agent) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const mode = determineAgentMode(agent.tools as string[]);
    const effectiveTier = tier ?? 'free';

    // Build AgentConfig from the stored document.
    const agentConfig: AgentConfig = {
      id: agentId,
      name: agent.name as string,
      description: (agent.description as string) ?? '',
      model: agent.model as string,
      systemPrompt: agent.systemPrompt as string,
      tools: agent.tools as string[],
      trigger: (agent.trigger as string) ?? 'manual',
      temperature: (agent.temperature as number) ?? 0.7,
      maxTokens: (agent.maxTokens as number) ?? 4096,
    };

    const targetOpId = operationId ?? (agent.operationId as string) ?? agentId;

    try {
      const deployed = await deployAgent(
        db,
        agentConfig,
        targetOpId,
        session.userId,
        effectiveTier,
      );

      // Update the agent record.
      await db.collection('custom_agents').updateOne(
        { _id: new ObjectId(agentId) },
        {
          $set: {
            status: 'deployed',
            operationId: targetOpId,
            deployedAt: deployed.deployedAt,
            updatedAt: new Date().toISOString(),
            deployment: {
              sandboxName: deployed.sandboxAllocation.sandboxName,
              sandboxId: deployed.sandboxAllocation.sandboxId,
              tier: effectiveTier,
              mode,
              memoryMb: deployed.sandboxAllocation.memoryMb,
              shared: deployed.sandboxAllocation.shared,
              publicUrl: deployed.publicUrl,
              webhookUrl: deployed.webhookUrl,
            },
          },
        },
      );

      logger.info(
        { agentId, mode, tier: effectiveTier, publicUrl: deployed.publicUrl },
        'agent deployed via agent-builder route',
      );

      return reply.send({
        ok: true,
        agentId,
        status: 'deployed',
        operationId: targetOpId,
        mode,
        tier: effectiveTier,
        memoryMb: deployed.sandboxAllocation.memoryMb,
        shared: deployed.sandboxAllocation.shared,
        publicUrl: deployed.publicUrl,
        webhookUrl: deployed.webhookUrl,
        sandboxName: deployed.sandboxAllocation.sandboxName,
        skillPreview: generateSkillFile(agentConfig).slice(0, 500),
      });
    } catch (err) {
      logger.error({ err, agentId }, 'agent deployment failed');
      return reply.code(502).send({
        error: 'deploy_failed',
        message: String((err as Error)?.message ?? err).slice(0, 400),
      });
    }
  });

  /** GET /api/agents/pool-stats — Sandbox pool stats (admin). */
  app.get('/api/agents/pool-stats', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { db } = await getMongo();
    const pool = new SandboxPoolManager(db);
    const stats = await pool.getPoolStats();

    return reply.send(stats);
  });

  /** DELETE /api/agents/:id — Delete a custom agent. */
  app.delete('/api/agents/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const agentId = String((request.params as { id: string }).id);
    const { db } = await getMongo();
    const { ObjectId } = await import('mongodb');

    const result = await db
      .collection('custom_agents')
      .deleteOne({ _id: new ObjectId(agentId), ownerId: session.userId });

    if (result.deletedCount === 0) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return reply.send({ ok: true, deleted: true });
  });

  /** POST /api/agents/from-template — Create an agent from a template. */
  app.post('/api/agents/from-template', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { templateSlug, operationId } = request.body as {
      templateSlug: string;
      operationId?: string;
    };

    const template = AGENT_TEMPLATES.find((t) => t.slug === templateSlug);
    if (!template) {
      return reply.code(404).send({ error: 'template_not_found' });
    }

    const { db } = await getMongo();
    const now = new Date().toISOString();

    const result = await db.collection('custom_agents').insertOne({
      ownerId: session.userId,
      name: template.name,
      description: template.description,
      model: template.model,
      systemPrompt: template.systemPrompt,
      tools: [...template.tools],
      trigger: template.trigger,
      temperature: 0.7,
      maxTokens: 4096,
      operationId: operationId ?? null,
      status: 'draft',
      fromTemplate: template.slug,
      invocationCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return reply.send({
      ok: true,
      agentId: result.insertedId.toString(),
      name: template.name,
      status: 'draft',
      fromTemplate: template.slug,
    });
  });
}
