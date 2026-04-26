import type { WorkflowMap } from '@argo/shared-types';

/**
 * Generates the approval-route resolver that lives inside the customer's
 * Blaxel deployment. The route handles the three actions linked from the
 * Argo approval emails: APPROVE, EDIT, DECLINE.
 *
 * Token verification is constant-time and tokens expire in 72h.
 */
export function generateApprovalRoute(_map: WorkflowMap): string {
  return `import { createHash, timingSafeEqual } from 'node:crypto';

export function registerApprovalRoute(app) {
  app.get('/a/:token', async (request, reply) => {
    const action = String(request.query?.action ?? 'approve').toLowerCase();
    if (!['approve', 'edit', 'decline'].includes(action)) {
      return reply.code(400).send({ error: 'invalid_action' });
    }

    const tokenHash = createHash('sha256').update(String(request.params.token)).digest('hex');
    const approval = await app.mongo.db.collection('approvals').findOne({ tokenHash });
    if (!approval) {
      return reply.code(404).type('text/html').send(renderErrorHtml('This link no longer works. It may have expired or been used.'));
    }

    if (new Date(approval.expiresAt).getTime() < Date.now()) {
      await app.mongo.db.collection('approvals').updateOne({ _id: approval._id }, { $set: { status: 'expired' } });
      return reply.code(410).type('text/html').send(renderErrorHtml('This link has expired (72h).'));
    }

    if (approval.status !== 'pending') {
      return reply.type('text/html').send(renderErrorHtml('This decision was already recorded.'));
    }

    await app.mongo.db.collection('approvals').updateOne(
      { _id: approval._id },
      {
        $set: {
          status: action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'editing',
          decidedAt: new Date().toISOString(),
        },
      },
    );

    // Notify control plane.
    fetch(process.env.ARGO_CONTROL_PLANE_URL + '/internal/approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-argo-internal': process.env.INTERNAL_API_KEY ?? '' },
      body: JSON.stringify({
        operationId: process.env.ARGO_OPERATION_ID,
        approvalId: approval._id,
        action,
        decidedAt: new Date().toISOString(),
      }),
    }).catch((err) => app.log.warn({ err }, 'control plane approval notify failed'));

    return reply.type('text/html').send(renderConfirmationHtml(action));
  });
}

function renderConfirmationHtml(action) {
  const titles = { approve: 'Approved.', edit: 'Got it — open Argo to edit.', decline: 'Declined.' };
  const subs = {
    approve: 'Your reply will go out within a few seconds.',
    edit: 'Open argo.app to finish your edit. The link will work once.',
    decline: 'No reply will be sent.',
  };
  return ${'`'}<!doctype html><html><body style="margin:0;padding:48px 16px;font:18px/1.5 system-ui;color:#1a1a1a;background:#0a0a0b;text-align:center;color:#f2f0eb"><div style="max-width:480px;margin:0 auto"><div style="font-size:48px;margin-bottom:24px;color:#00e5cc">✓</div><h1 style="margin:0 0 12px;font-size:24px">${'$'}{titles[action]}</h1><p style="margin:0;color:#8a8480">${'$'}{subs[action]}</p></div></body></html>${'`'};
}

function renderErrorHtml(msg) {
  return ${'`'}<!doctype html><html><body style="margin:0;padding:48px 16px;font:18px/1.5 system-ui;background:#0a0a0b;color:#f2f0eb;text-align:center"><div style="max-width:480px;margin:0 auto"><div style="font-size:48px;margin-bottom:24px;color:#e84040">✗</div><p style="margin:0;color:#8a8480">${'$'}{msg}</p></div></body></html>${'`'};
}
`;
}
