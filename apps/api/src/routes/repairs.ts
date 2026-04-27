import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { tokensMatch } from '@argo/security';
import { rememberDecision } from '@argo/agent';
import { getMongo } from '../db/mongo.js';
import { getPrisma } from '../db/prisma.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { broadcastToOwner } from '../realtime/socket.js';
import { logger } from '../logger.js';

export async function registerRepairsRoutes(app: FastifyInstance) {
  app.get('/api/repairs', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { db } = await getMongo();
    const ops = await getPrisma().operation.findMany({
      where: { ownerId: session.userId },
      select: { id: true },
    });
    const ids = ops.map((o: { id: string }) => o.id);
    const docs = await db
      .collection('operation_repairs')
      .find({ operationId: { $in: ids } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return docs;
  });

  app.get('/api/repairs/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const id = String((request.params as { id: string }).id);
    const { db } = await getMongo();
    const repair = await db.collection('operation_repairs').findOne({ id });
    if (!repair) return reply.code(404).send({ error: 'not_found' });
    const op = await getPrisma().operation.findFirst({
      where: { id: String(repair.operationId), ownerId: session.userId },
    });
    if (!op) return reply.code(403).send({ error: 'forbidden' });
    return repair;
  });

  // Approval-link click — no session required (token gates it).
  app.get('/api/repairs/:id/approve', async (request, reply) => {
    const id = String((request.params as { id: string }).id);
    const token = String((request.query as { token?: string }).token ?? '');
    if (!token) return reply.code(400).type('text/html').send(htmlError('Missing token.'));

    const { db } = await getMongo();
    const repair = await db.collection('operation_repairs').findOne({ id });
    if (!repair) return reply.code(404).type('text/html').send(htmlError('Repair not found.'));
    const expectedHash = String(repair.approvalTokenHash ?? '');
    if (!tokensMatch(token, expectedHash)) {
      return reply.code(401).type('text/html').send(htmlError('This link no longer works.'));
    }
    if (repair.status !== 'awaiting_approval') {
      return reply.code(409).type('text/html').send(htmlError('This repair was already actioned.'));
    }

    await db
      .collection('operation_repairs')
      .updateOne({ id }, { $set: { status: 'approved', approvedAt: new Date().toISOString() } });

    const op = await getPrisma().operation.findUnique({ where: { id: String(repair.operationId) } });
    if (op) {
      const a = await appendActivity({
        ownerId: op.ownerId,
        operationId: op.id,
        operationName: op.name,
        kind: 'repair_approved',
        message: 'Repair approved — applying.',
      });
      broadcastToOwner(op.ownerId, { type: 'activity', payload: a });

      // Capture the approval as a memory so future repair proposals
      // know which kinds of changes the operator already accepted —
      // less hand-wringing on the next round-trip.
      const failureKind = String(repair.failureKind ?? 'unknown');
      const whatChanged = String(repair.whatChanged ?? '').slice(0, 240);
      if (whatChanged) {
        await rememberDecision({
          ownerId: op.ownerId,
          operationId: op.id,
          kind: 'workflow_decision',
          content: `Approved repair on "${op.name}" (${failureKind}): ${whatChanged}`,
          tags: ['repair-approved', failureKind],
        }).catch(() => undefined);
      }
    }

    logger.info({ repairId: id }, 'repair approved via email link');

    return reply.type('text/html').send(htmlOk());
  });
}

const htmlOk = () => `<!doctype html><html><body style="margin:0;padding:48px 16px;font:16px/1.5 system-ui;background:#0a0a0b;color:#f2f0eb;text-align:center"><div style="max-width:480px;margin:0 auto"><div style="font-size:48px;margin-bottom:24px;color:#00e5cc">✓</div><h1 style="margin:0 0 12px;font-size:24px">Repair approved.</h1><p style="margin:0;color:#8a8480">Argo will deploy the change in the next 90 seconds. You'll get a confirmation email when it's live.</p></div></body></html>`;
const htmlError = (msg: string) => `<!doctype html><html><body style="margin:0;padding:48px 16px;font:16px/1.5 system-ui;background:#0a0a0b;color:#f2f0eb;text-align:center"><div style="max-width:480px;margin:0 auto"><div style="font-size:48px;margin-bottom:24px;color:#e84040">✗</div><p style="margin:0;color:#8a8480">${escape(msg)}</p></div></body></html>`;

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
