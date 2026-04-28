import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { DefaultLlmRouter } from '@argo/agent';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { MongoInvocationStore } from '../stores/invocation-store.js';
import { logger } from '../logger.js';

const router = DefaultLlmRouter.fromEnv();
const store = new MongoInvocationStore();

const ChatMessageBody = z.object({
  operationId: z.string().optional(),
  message: z.string().min(1).max(8000),
  /** Optional thread ID for multi-turn conversations. */
  threadId: z.string().optional(),
});

/**
 * POST /api/chat
 *
 * Conversational AI assistant for the workspace. Users can ask questions
 * about their operations, request changes, get debugging help, or just
 * brainstorm. Backed by the same model router the build engine uses.
 *
 * Context is built from:
 *   - The active operation's brief, workflow map, and recent events
 *   - The conversation thread history (last 20 messages)
 *   - Operator memories from supermemory
 */
export async function registerChatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = ChatMessageBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const { message, threadId: existingThread } = parsed.data;
    const threadId = existingThread ?? `chat_${nanoid(12)}`;
    const { db } = await getMongo();

    // Build operation context if scoped to one.
    let opContext = '';
    let operationId = parsed.data.operationId ?? null;
    if (operationId) {
      const op = await getPrisma().operation.findFirst({
        where: { id: operationId, ownerId: session.userId },
      });
      if (!op) return reply.code(404).send({ error: 'operation_not_found' });

      const [briefDoc, mapDoc, recentEvents, bundleDoc] = await Promise.all([
        db.collection('project_briefs').find({ operationId }).sort({ persistedAt: -1 }).limit(1).next(),
        db.collection('workflow_maps').find({ operationId }).sort({ version: -1 }).limit(1).next(),
        db.collection('runtime_events').find({ operationId }).sort({ occurredAt: -1 }).limit(10).toArray(),
        db.collection('operation_bundles').find({ operationId }).sort({ version: -1 }).limit(1).next(),
      ]);

      const brief = briefDoc as Record<string, unknown> | null;
      const map = mapDoc as Record<string, unknown> | null;

      opContext = [
        `\n--- OPERATION CONTEXT ---`,
        `Name: ${op.name}`,
        `Status: ${op.status}`,
        `Public URL: ${op.publicUrl ?? 'not deployed'}`,
        `Bundle version: ${op.bundleVersion}`,
        brief ? `Brief: ${JSON.stringify({ name: brief.name, outcome: brief.outcome, trigger: brief.trigger, audience: brief.audience }).slice(0, 600)}` : '',
        map ? `Workflow map version: ${map.version}` : '',
        bundleDoc ? `Files in bundle: ${((bundleDoc.filesSummary ?? []) as Array<{ path: string }>).map((f) => f.path).join(', ')}` : '',
        recentEvents.length > 0
          ? `Recent events:\n${recentEvents.map((e) => `  - [${(e as Record<string, unknown>).kind}] ${(e as Record<string, unknown>).message ?? ''}`).join('\n')}`
          : '',
        `--- END CONTEXT ---\n`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    // Load thread history (last 20 messages).
    const history = await db
      .collection('chat_threads')
      .find({ threadId, ownerId: session.userId })
      .sort({ createdAt: 1 })
      .limit(20)
      .toArray();

    const historyText = history
      .map((m) => `${(m as Record<string, unknown>).role === 'user' ? 'User' : 'Argo'}: ${(m as Record<string, unknown>).content}`)
      .join('\n');

    // Compose the prompt.
    const prompt = [
      opContext,
      historyText ? `Previous conversation:\n${historyText}\n` : '',
      `User: ${message}`,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are Argo, an AI business operator. You help users understand and manage their automated workflows. You have access to their operation context including briefs, workflow maps, deployed code, and runtime events.

Be concise, helpful, and specific. When discussing code or configurations, reference actual file paths and settings. When debugging, analyze the runtime events. When suggesting changes, explain the impact.

You can help with:
- Explaining how their operation works
- Debugging runtime errors
- Suggesting workflow improvements
- Answering questions about Argo's features
- Planning new operations or modifications

Always maintain a professional but friendly tone. Keep responses under 400 words unless the user asks for detail.`;

    try {
      const result = await router.completeText({
        kind: 'chat_response',
        operationId: operationId ?? undefined,
        ownerId: session.userId,
        systemPrompt,
        userPrompt: prompt,
        maxTokens: 2000,
        temperature: 0.7,
        store,
      });

      // Persist both messages.
      const now = new Date().toISOString();
      await db.collection('chat_threads').insertMany([
        {
          threadId,
          ownerId: session.userId,
          operationId,
          role: 'user',
          content: message,
          createdAt: now,
        },
        {
          threadId,
          ownerId: session.userId,
          operationId,
          role: 'assistant',
          content: result.text,
          invocationId: result.invocationId ?? null,
          model: result.model ?? null,
          promptTokens: result.promptTokens ?? null,
          completionTokens: result.completionTokens ?? null,
          createdAt: new Date(Date.now() + 1).toISOString(),
        },
      ]);

      return reply.send({
        threadId,
        response: result.text,
        model: result.model ?? null,
        operationId,
      });
    } catch (err) {
      logger.error({ err }, 'chat completion failed');
      return reply.code(500).send({
        error: 'chat_failed',
        detail: String(err).slice(0, 300),
      });
    }
  });

  /** GET /api/chat/threads — list recent threads. */
  app.get('/api/chat/threads', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { db } = await getMongo();

    // Get distinct thread IDs with latest message.
    const threads = await db
      .collection('chat_threads')
      .aggregate([
        { $match: { ownerId: session.userId } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$threadId',
            operationId: { $first: '$operationId' },
            lastMessage: { $first: '$content' },
            lastRole: { $first: '$role' },
            updatedAt: { $first: '$createdAt' },
            messageCount: { $sum: 1 },
          },
        },
        { $sort: { updatedAt: -1 } },
        { $limit: 30 },
      ])
      .toArray();

    return reply.send({
      threads: threads.map((t) => ({
        threadId: t._id,
        operationId: t.operationId,
        lastMessage: String(t.lastMessage).slice(0, 120),
        lastRole: t.lastRole,
        updatedAt: t.updatedAt,
        messageCount: t.messageCount,
      })),
    });
  });

  /** GET /api/chat/threads/:threadId — get full thread. */
  app.get('/api/chat/threads/:threadId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const threadId = String((request.params as { threadId: string }).threadId);
    const { db } = await getMongo();

    const messages = await db
      .collection('chat_threads')
      .find({ threadId, ownerId: session.userId })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();

    return reply.send({
      threadId,
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        content: m.content,
        model: m.model ?? null,
        createdAt: m.createdAt,
      })),
    });
  });
}
