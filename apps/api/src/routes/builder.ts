import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { detectTrigger, questionsFor, extractWorkflowIntent, generateWorkflowMap, applyMapEdit, DefaultLlmRouter } from '@argo/agent';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { MongoInvocationStore } from '../stores/invocation-store.js';
import { appendActivity } from '../stores/activity-store.js';
import { broadcastToOwner } from '../realtime/socket.js';

const router = DefaultLlmRouter.fromEnv();
const store = new MongoInvocationStore();

const StartBuilderBody = z.object({
  operationId: z.string(),
  description: z.string().min(20).max(4000),
});

const SubmitAnswersBody = z.object({
  operationId: z.string(),
  rawDescription: z.string().min(20).max(4000),
  trigger: z.enum(['form_submission', 'email_received', 'scheduled']),
  answers: z.record(z.string(), z.string()),
});

const ApplyEditBody = z.object({
  operationId: z.string(),
  targetStepId: z.string(),
  userInstruction: z.string().min(3).max(800),
});

export async function registerBuilderRoutes(app: FastifyInstance) {
  app.post('/api/builder/start', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = StartBuilderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const owned = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!owned) return reply.code(404).send({ error: 'not_found' });

    const trigger = detectTrigger(parsed.data.description);
    const questions = questionsFor(trigger);
    return reply.send({ trigger, questions });
  });

  app.post('/api/builder/submit-answers', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = SubmitAnswersBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const owned = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!owned) return reply.code(404).send({ error: 'not_found' });

    await getPrisma().operation.update({
      where: { id: owned.id },
      data: { status: 'mapping' },
    });

    const intent = await extractWorkflowIntent(router, store, {
      operationId: owned.id,
      ownerId: session.userId,
      dialogue: {
        trigger: parsed.data.trigger,
        rawDescription: parsed.data.rawDescription,
        // Cast — runtime values are strings; question-tree expects QuestionId keys.
        answers: parsed.data.answers as never,
      },
    });

    if (!intent.ok) {
      return reply.code(422).send({ error: 'intent_extraction_failed', detail: intent.errorMessage });
    }

    const ownerEmail = session.email;
    const map = await generateWorkflowMap(router, store, {
      operationId: owned.id,
      ownerId: session.userId,
      ownerEmail,
      intent: intent.data,
      operationName: owned.name,
      timezone: owned.timezone,
    });

    if (!map.ok) {
      return reply.code(422).send({ error: 'map_generation_failed' });
    }

    const newVersion = (owned.workflowMapVersion ?? 0) + 1;
    const { db } = await getMongo();
    await db.collection('workflow_intents').insertOne({
      operationId: owned.id,
      ownerId: session.userId,
      version: newVersion,
      intent: intent.data,
      createdAt: new Date().toISOString(),
    });
    await db.collection('workflow_maps').insertOne({
      operationId: owned.id,
      ownerId: session.userId,
      version: newVersion,
      map: map.data,
      generatedFromInvocationId: map.invocationId,
      createdAt: new Date().toISOString(),
    });

    await getPrisma().operation.update({
      where: { id: owned.id },
      data: {
        workflowMapVersion: newVersion,
        status: 'awaiting_user_confirmation',
        updatedAt: new Date(),
      },
    });

    const activity = await appendActivity({
      ownerId: session.userId,
      operationId: owned.id,
      operationName: owned.name,
      kind: 'map_proposed',
      message: `Argo proposed a workflow map (v${newVersion}).`,
    });
    broadcastToOwner(session.userId, { type: 'activity', payload: activity });
    broadcastToOwner(session.userId, { type: 'map_updated', operationId: owned.id, version: newVersion });

    return reply.send({
      operationId: owned.id,
      mapVersion: newVersion,
      map: map.data,
      fallbackUsed: 'fallbackUsed' in map ? Boolean(map.fallbackUsed) : false,
      invocationId: map.invocationId,
    });
  });

  app.post('/api/builder/edit-step', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = ApplyEditBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const owned = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!owned) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const current = await db
      .collection('workflow_maps')
      .find({ operationId: owned.id })
      .sort({ version: -1 })
      .limit(1)
      .next();
    if (!current) return reply.code(409).send({ error: 'no_map_yet' });

    const result = await applyMapEdit(router, store, {
      operationId: owned.id,
      ownerId: session.userId,
      currentMap: current.map as never,
      targetStepId: parsed.data.targetStepId,
      userInstruction: parsed.data.userInstruction,
    });

    if (!result.ok) {
      return reply.code(422).send({ error: 'edit_failed', detail: result.errorMessage });
    }

    const newVersion = (owned.workflowMapVersion ?? 0) + 1;
    await db.collection('workflow_maps').insertOne({
      operationId: owned.id,
      ownerId: session.userId,
      version: newVersion,
      map: result.data,
      generatedFromInvocationId: result.invocationId,
      createdAt: new Date().toISOString(),
    });
    await getPrisma().operation.update({
      where: { id: owned.id },
      data: { workflowMapVersion: newVersion, updatedAt: new Date() },
    });

    const id = 'act_' + nanoid(12);
    broadcastToOwner(session.userId, {
      type: 'activity',
      payload: {
        id,
        operationId: owned.id,
        operationName: owned.name,
        kind: 'map_edited',
        message: `You edited step "${parsed.data.targetStepId}".`,
        occurredAt: new Date().toISOString(),
      },
    });
    broadcastToOwner(session.userId, { type: 'map_updated', operationId: owned.id, version: newVersion });

    return reply.send({ operationId: owned.id, mapVersion: newVersion, map: result.data });
  });
}
