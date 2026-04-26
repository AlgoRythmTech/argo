// Scoping endpoints — the click-driven Perplexity-style intake flow.
//
//   POST /api/scoping/start    {sentence}                 -> Questionnaire (4-6 Qs)
//   POST /api/scoping/finalize {questionnaireId, answers} -> ProjectBrief + redirect
//                                                            to /api/build/stream
//
// Persists each questionnaire + brief into Mongo so the operator can
// re-open the workspace and see the scope they answered.

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  compileBrief,
  generateQuestionnaire,
  rememberDecision,
  renderBriefAsPrompt,
} from '@argo/agent';
import { ScopingQuestionnaire, QuestionnaireSubmission } from '@argo/shared-types';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';

const StartBody = z.object({
  operationId: z.string().min(1),
  sentence: z.string().min(8).max(2000),
});

const FinalizeBody = z.object({
  operationId: z.string().min(1),
  submission: QuestionnaireSubmission,
});

export async function registerScopingRoutes(app: FastifyInstance) {
  app.post('/api/scoping/start', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = StartBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const op = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    let questionnaire: ScopingQuestionnaire;
    try {
      questionnaire = await generateQuestionnaire({ sentence: parsed.data.sentence });
    } catch (err) {
      return reply.code(502).send({ error: 'questionnaire_generation_failed', detail: String(err).slice(0, 400) });
    }

    const { db } = await getMongo();
    await db.collection('scoping_questionnaires').insertOne({
      _id: questionnaire.id as unknown as never,
      ...questionnaire,
      operationId: op.id,
      ownerId: session.userId,
      persistedAt: new Date().toISOString(),
    } as Record<string, unknown>);

    return reply.send(questionnaire);
  });

  app.post('/api/scoping/finalize', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = FinalizeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const op = await getPrisma().operation.findFirst({
      where: { id: parsed.data.operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const questionnaireDoc = await db
      .collection('scoping_questionnaires')
      .findOne({ id: parsed.data.submission.questionnaireId });
    if (!questionnaireDoc) return reply.code(404).send({ error: 'questionnaire_not_found' });

    const questionnaireParsed = ScopingQuestionnaire.safeParse(questionnaireDoc);
    if (!questionnaireParsed.success) {
      return reply.code(500).send({ error: 'questionnaire_corrupt' });
    }

    let brief;
    try {
      brief = compileBrief({
        questionnaire: questionnaireParsed.data,
        submission: parsed.data.submission,
        fallbackName: op.name,
        ownerEmail: session.email,
      });
    } catch (err) {
      return reply.code(422).send({ error: 'brief_compile_failed', detail: String(err).slice(0, 400) });
    }

    const buildPrompt = renderBriefAsPrompt(brief);

    await db.collection('project_briefs').insertOne({
      ...brief,
      operationId: op.id,
      ownerId: session.userId,
      buildPrompt,
      persistedAt: new Date().toISOString(),
    } as Record<string, unknown>);

    // Persist a memory so future operations for this owner inherit voice + style.
    if (brief.voiceTone || brief.replyStyle) {
      await rememberDecision({
        ownerId: session.userId,
        operationId: op.id,
        kind: 'voice_preference',
        content: `For "${brief.name}" — reply style is ${brief.replyStyle}${
          brief.voiceTone ? `, voice notes: ${brief.voiceTone}` : ''
        }.`,
        tags: ['brief-finalize', brief.replyStyle],
      }).catch(() => undefined);
    }
    if (brief.complianceNotes) {
      await rememberDecision({
        ownerId: session.userId,
        operationId: op.id,
        kind: 'do_not_do',
        content: `Compliance constraints for "${brief.name}": ${brief.complianceNotes}`,
        tags: ['compliance'],
      }).catch(() => undefined);
    }

    return reply.send({ ok: true, brief, buildPrompt });
  });

  app.get('/api/scoping/:operationId/latest', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const operationId = String((request.params as { operationId: string }).operationId);
    const op = await getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });
    const { db } = await getMongo();
    const brief = await db
      .collection('project_briefs')
      .find({ operationId: op.id })
      .sort({ persistedAt: -1 })
      .limit(1)
      .next();
    if (!brief) return reply.code(404).send({ error: 'no_brief_yet' });
    return reply.send(brief);
  });
}
