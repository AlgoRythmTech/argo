// Memory transparency — the operator's window into what Argo has
// internalised about them via supermemory.ai. The thesis: persistent
// memory is only acceptable if the operator can SEE it and PRUNE it.
// Black-box memory feels creepy. A visible, editable list feels like
// an assistant who took notes.
//
//   GET    /api/memory                    — list all memories for the operator
//   GET    /api/memory?operationId=…      — scope to one operation
//   DELETE /api/memory/:id                — forget a single memory
//
// All routes are owner-scoped via session. Returns gracefully empty
// when SUPERMEMORY_ENABLED=false so the UI can render a "memory off"
// hint without a 500.

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { forgetMemory, listMemories, memoryEnabled } from '@argo/agent';
import { requireSession } from '../plugins/auth-plugin.js';
import { getPrisma } from '../db/prisma.js';

const ListQuery = z.object({
  operationId: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function registerMemoryRoutes(app: FastifyInstance) {
  app.get('/api/memory', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = ListQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });

    if (!memoryEnabled()) {
      return reply.send({
        enabled: false,
        memories: [],
        note: 'Set SUPERMEMORY_ENABLED=true and SUPERMEMORY_API_KEY to activate persistent memory.',
      });
    }

    // If the caller asks for a specific operation, confirm ownership before
    // querying — supermemory's containerTags do owner-scoping but we don't
    // want a stranger guessing operation ids and getting a hit.
    if (parsed.data.operationId) {
      const op = await getPrisma().operation.findFirst({
        where: { id: parsed.data.operationId, ownerId: session.userId },
        select: { id: true },
      });
      if (!op) return reply.code(404).send({ error: 'operation_not_found' });
    }

    const memories = await listMemories({
      ownerId: session.userId,
      ...(parsed.data.operationId !== undefined ? { operationId: parsed.data.operationId } : {}),
      limit: parsed.data.limit ?? 100,
    });

    return reply.send({
      enabled: true,
      count: memories.length,
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        kind: (m.metadata as { kind?: string }).kind ?? 'memory',
        operationId: (m.metadata as { operationId?: string }).operationId ?? null,
        tags: (m.metadata as { tags?: string[] }).tags ?? [],
        score: m.score,
      })),
    });
  });

  app.delete('/api/memory/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id ?? '').trim();
    if (!id) return reply.code(400).send({ error: 'missing_id' });

    if (!memoryEnabled()) {
      return reply.code(409).send({ error: 'memory_disabled' });
    }

    // We can't call list-then-verify cheaply (supermemory's id space is
    // opaque). The owner-scoped containerTag on write means a memory's
    // id alone shouldn't unmask another operator's data, but we still
    // require the request to come from a session — a stranger with a
    // guessed id and no session gets nothing.
    const result = await forgetMemory(id);
    if (!result.ok) return reply.code(502).send({ error: 'forget_failed' });
    return reply.send({ ok: true });
  });
}
