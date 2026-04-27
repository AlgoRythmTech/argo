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
  generateFollowups,
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

const RefineBody = z.object({
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

  /**
   * POST /api/scoping/refine
   *
   * Optional second-round refinement. The operator answered the first
   * questionnaire; before we lock the brief, the LLM gets a chance to
   * mint 1-3 follow-up questions when the compiled brief reveals
   * meaningful gaps. Returns either:
   *   { refined: true,  questionnaire, refinementSummary, rationales }
   *   { refined: false, refinementSummary }                   // already crisp
   * The UI shows the new questions inline; on second submit the
   * operator hits /finalize as usual (which compiles the merged
   * answers via merge logic that already handles repeat briefField
   * answers — last write wins per field).
   */
  app.post('/api/scoping/refine', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = RefineBody.safeParse(request.body);
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

    let draftBrief;
    try {
      draftBrief = compileBrief({
        questionnaire: questionnaireParsed.data,
        submission: parsed.data.submission,
        fallbackName: op.name,
        ownerEmail: session.email,
      });
    } catch (err) {
      return reply.code(422).send({ error: 'brief_compile_failed', detail: String(err).slice(0, 400) });
    }

    let result;
    try {
      result = await generateFollowups({
        brief: draftBrief,
        questionnaire: questionnaireParsed.data,
        submission: parsed.data.submission,
      });
    } catch (err) {
      // Refinement is best-effort. If the LLM is down or the response
      // mis-shapes, we degrade to "no refinement needed" so the
      // operator can still finalise the brief.
      return reply.send({
        refined: false,
        refinementSummary: 'Skipped — refinement service unavailable.',
        warning: String(err).slice(0, 200),
      });
    }

    if (result.refined && result.questionnaire) {
      // Persist the follow-up questionnaire so /finalize can find it
      // when the operator submits the second round. We attach BOTH
      // the prior questionnaire id AND the prior submission so the
      // finalize handler can merge round-1 + round-2 answers without
      // re-asking the operator anything.
      await db.collection('scoping_questionnaires').insertOne({
        _id: result.questionnaire.id as unknown as never,
        ...result.questionnaire,
        operationId: op.id,
        ownerId: session.userId,
        priorQuestionnaireId: questionnaireParsed.data.id,
        priorSubmission: parsed.data.submission,
        kind: 'refinement',
        persistedAt: new Date().toISOString(),
      } as Record<string, unknown>);

      return reply.send({
        refined: true,
        refinementSummary: result.refinementSummary,
        questionnaire: result.questionnaire,
        rationales: result.rationales,
      });
    }

    return reply.send({
      refined: false,
      refinementSummary: result.refinementSummary,
    });
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

    // If this is a refinement-round questionnaire, fold the prior
    // round's questions+answers in so compileBrief sees the FULL
    // operator intent. Without this, refinement answers would
    // overwrite a brief built from defaults instead of round 1.
    let mergedQuestionnaire = questionnaireParsed.data;
    let mergedSubmission = parsed.data.submission;
    if (questionnaireDoc.kind === 'refinement' && questionnaireDoc.priorQuestionnaireId) {
      const priorDoc = await db
        .collection('scoping_questionnaires')
        .findOne({ id: String(questionnaireDoc.priorQuestionnaireId) });
      const priorParsed = priorDoc ? ScopingQuestionnaire.safeParse(priorDoc) : null;
      const priorSubmission = (questionnaireDoc.priorSubmission ?? null) as
        | { answers?: Array<{ questionId: string; selectedOptionIds?: string[]; textValue?: string }> }
        | null;
      if (priorParsed?.success && priorSubmission?.answers) {
        mergedQuestionnaire = {
          ...questionnaireParsed.data,
          // Prior questions FIRST so refinement (last write wins per
          // briefField) overrides only when the operator chose to.
          questions: [...priorParsed.data.questions, ...questionnaireParsed.data.questions],
        };
        const normalizedPrior = priorSubmission.answers.map((a) => ({
          questionId: String(a.questionId),
          selectedOptionIds: a.selectedOptionIds ?? [],
          ...(a.textValue !== undefined ? { textValue: String(a.textValue) } : {}),
        }));
        mergedSubmission = {
          questionnaireId: questionnaireParsed.data.id,
          answers: [...normalizedPrior, ...parsed.data.submission.answers],
        };
      }
    }

    let brief;
    try {
      brief = compileBrief({
        questionnaire: mergedQuestionnaire,
        submission: mergedSubmission,
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
