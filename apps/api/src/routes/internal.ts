import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';
import { requireInternalKey } from '../plugins/internal-auth.js';
import { broadcastToOwner } from '../realtime/socket.js';
import { appendActivity } from '../stores/activity-store.js';
import { logger } from '../logger.js';

const SubmissionBody = z.object({
  operationId: z.string(),
  submissionId: z.string(),
  receivedAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const ApprovalBody = z.object({
  operationId: z.string(),
  approvalId: z.string(),
  action: z.enum(['approve', 'edit', 'decline']),
  decidedAt: z.string(),
});

const EventsBody = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        operationId: z.string(),
        deploymentId: z.string().optional(),
        kind: z.string(),
        severity: z.enum(['info', 'warn', 'error', 'critical']),
        message: z.string(),
        context: z.record(z.string(), z.unknown()).optional(),
        stackTrace: z.string().nullable().optional(),
        occurredAt: z.string(),
      }),
    )
    .min(1)
    .max(500),
});

const DigestTickBody = z.object({
  operationId: z.string(),
  firedAt: z.string(),
});

export async function registerInternalRoutes(app: FastifyInstance) {
  app.post('/internal/submission', async (request, reply) => {
    if (!requireInternalKey(request, reply)) return;
    const parsed = SubmissionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const op = await getPrisma().operation.findUnique({ where: { id: parsed.data.operationId } });
    if (!op) return reply.code(404).send({ error: 'op_not_found' });

    const { db } = await getMongo();
    await db.collection('submissions').insertOne({
      id: parsed.data.submissionId,
      operationId: op.id,
      receivedAt: parsed.data.receivedAt,
      payload: parsed.data.payload,
      status: 'received',
    });

    await getPrisma().operation.update({
      where: { id: op.id },
      data: {
        submissionsToday: { increment: 1 },
        lastEventAt: new Date(),
      },
    });

    const activity = await appendActivity({
      ownerId: op.ownerId,
      operationId: op.id,
      operationName: op.name,
      kind: 'submission_received',
      message: `New submission (${parsed.data.submissionId.slice(-8)}).`,
    });
    broadcastToOwner(op.ownerId, { type: 'activity', payload: activity });

    return reply.send({ ok: true });
  });

  app.post('/internal/approval', async (request, reply) => {
    if (!requireInternalKey(request, reply)) return;
    const parsed = ApprovalBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const approval = await getPrisma().approval.findUnique({ where: { id: parsed.data.approvalId } });
    if (!approval) return reply.code(404).send({ error: 'approval_not_found' });
    const op = await getPrisma().operation.findUnique({ where: { id: approval.operationId } });
    if (!op) return reply.code(404).send({ error: 'op_not_found' });

    await getPrisma().approval.update({
      where: { id: approval.id },
      data: {
        status: parsed.data.action === 'approve' ? 'approved' : parsed.data.action === 'decline' ? 'declined' : 'editing',
        decidedAt: new Date(parsed.data.decidedAt),
      },
    });

    if (parsed.data.action === 'approve' && approval.templateId) {
      await getPrisma().templateCounter.update({
        where: { id: approval.templateId },
        data: { approvalsToDate: { increment: 1 }, sendsToDate: { increment: 1 } },
      });
    } else if (approval.templateId) {
      await getPrisma().templateCounter.update({
        where: { id: approval.templateId },
        data: { sendsToDate: { increment: 1 } },
      });
    }

    await getPrisma().operation.update({
      where: { id: op.id },
      data: {
        pendingApprovals: { decrement: 1 },
        totalApprovalsRequested: { increment: 1 },
        totalApprovalsGranted: parsed.data.action === 'approve' ? { increment: 1 } : undefined,
        lastEventAt: new Date(),
      },
    });

    const activity = await appendActivity({
      ownerId: op.ownerId,
      operationId: op.id,
      operationName: op.name,
      kind: parsed.data.action === 'approve' ? 'approval_granted' : 'approval_declined',
      message:
        parsed.data.action === 'approve'
          ? `You approved ${approval.subjectLine}`
          : `You declined ${approval.subjectLine}`,
    });
    broadcastToOwner(op.ownerId, { type: 'activity', payload: activity });

    return reply.send({ ok: true });
  });

  app.post('/internal/events', async (request, reply) => {
    if (!requireInternalKey(request, reply)) return;
    const parsed = EventsBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const { db } = await getMongo();
    const docs = parsed.data.events.map((e) => ({
      ...e,
      ingestedAt: new Date().toISOString(),
      processedAt: null,
    }));
    await db.collection('runtime_events').insertMany(docs);

    for (const e of parsed.data.events) {
      if (e.severity === 'error' || e.severity === 'critical') {
        const op = await getPrisma().operation.findUnique({ where: { id: e.operationId } });
        if (op) {
          const a = await appendActivity({
            ownerId: op.ownerId,
            operationId: op.id,
            operationName: op.name,
            kind: 'runtime_error',
            message: `Runtime: ${e.message.slice(0, 120)}`,
          });
          broadcastToOwner(op.ownerId, { type: 'activity', payload: a });
        }
      }
    }

    return reply.send({ ok: true, ingested: parsed.data.events.length });
  });

  app.post('/internal/digest-tick', async (request, reply) => {
    if (!requireInternalKey(request, reply)) return;
    const parsed = DigestTickBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const op = await getPrisma().operation.findUnique({ where: { id: parsed.data.operationId } });
    if (!op) return reply.code(404).send({ error: 'op_not_found' });
    logger.info({ operationId: op.id }, 'digest-tick received');
    // Enqueue the digest job — see /apps/api/src/jobs/digest-worker.ts
    const { getDigestQueue } = await import('../jobs/queues.js');
    await getDigestQueue().add(
      'digest_' + nanoid(8),
      { operationId: op.id, firedAt: parsed.data.firedAt },
      { removeOnComplete: 100, removeOnFail: 500 },
    );
    return reply.send({ ok: true });
  });

  app.post('/internal/approval-reminder', async (request, reply) => {
    if (!requireInternalKey(request, reply)) return;
    const body = z.object({ operationId: z.string(), approvalId: z.string() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    // Reminder dispatch handled by the email worker.
    const { getReminderQueue } = await import('../jobs/queues.js');
    await getReminderQueue().add('reminder_' + nanoid(8), { approvalId: body.data.approvalId });
    return reply.send({ ok: true });
  });
}
