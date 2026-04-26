import type { WorkflowMap } from '@argo/shared-types';

export function generateScheduler(map: WorkflowMap): string {
  const cron = map.digest?.cron ?? '0 9 * * 1';
  const tz = map.digest?.timezone ?? 'America/New_York';
  return `import { Cron } from 'croner';

export function startScheduler(app) {
  // Weekly digest tick — the actual digest composition happens in the Argo
  // control plane. This cron only POSTs the trigger.
  new Cron(${JSON.stringify(cron)}, { timezone: ${JSON.stringify(tz)} }, async () => {
    try {
      await fetch(process.env.ARGO_CONTROL_PLANE_URL + '/internal/digest-tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-argo-internal': process.env.INTERNAL_API_KEY ?? '' },
        body: JSON.stringify({ operationId: process.env.ARGO_OPERATION_ID, firedAt: new Date().toISOString() }),
      });
      app.log.info('digest-tick fired');
    } catch (err) {
      app.log.warn({ err }, 'digest-tick failed');
    }
  });

  // Hourly approval-expiry sweep.
  new Cron('0 * * * *', { timezone: 'UTC' }, async () => {
    const now = new Date().toISOString();
    const expired = await app.mongo.db.collection('approvals').updateMany(
      { status: 'pending', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } },
    );
    if (expired.modifiedCount > 0) {
      app.log.info({ count: expired.modifiedCount }, 'expired approvals swept');
    }
  });

  // 48h reminder sweep — fires once per pending approval that hasn't been
  // touched in 48h but isn't yet at 72h expiry.
  new Cron('*/15 * * * *', { timezone: 'UTC' }, async () => {
    const now = Date.now();
    const reminders = await app.mongo.db.collection('approvals').find({
      status: 'pending',
      reminderSentAt: { $exists: false },
      remindAt: { $lt: new Date(now).toISOString() },
    }).limit(100).toArray();
    for (const r of reminders) {
      try {
        await fetch(process.env.ARGO_CONTROL_PLANE_URL + '/internal/approval-reminder', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-argo-internal': process.env.INTERNAL_API_KEY ?? '' },
          body: JSON.stringify({ operationId: process.env.ARGO_OPERATION_ID, approvalId: r._id }),
        });
        await app.mongo.db.collection('approvals').updateOne(
          { _id: r._id },
          { $set: { reminderSentAt: new Date().toISOString() } },
        );
      } catch (err) {
        app.log.warn({ err, approvalId: r._id }, 'reminder dispatch failed');
      }
    }
  });
}
`;
}
