import { nanoid } from 'nanoid';
import { getMongo } from '../db/mongo.js';
import type { ActivityFeedEntry } from '@argo/shared-types';

/**
 * Activity feed — the right-column "this just happened" stream the dashboard
 * renders. Bounded to 1000 entries per owner via TTL-style cleanup.
 */
export async function appendActivity(args: {
  ownerId: string;
  operationId: string | null;
  operationName: string | null;
  kind: string;
  message: string;
}): Promise<ActivityFeedEntry> {
  const { db } = await getMongo();
  const entry: ActivityFeedEntry & { ownerId: string } = {
    id: 'act_' + nanoid(12),
    ownerId: args.ownerId,
    operationId: args.operationId,
    operationName: args.operationName,
    kind: args.kind,
    message: args.message,
    occurredAt: new Date().toISOString(),
  };
  await db.collection('activity_feed').insertOne(entry as unknown as Record<string, unknown>);
  return entry;
}

export async function recentActivity(ownerId: string, limit = 100): Promise<ActivityFeedEntry[]> {
  const { db } = await getMongo();
  const docs = await db
    .collection('activity_feed')
    .find({ ownerId })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    id: String(d.id ?? ''),
    operationId: (d.operationId as string | null) ?? null,
    operationName: (d.operationName as string | null) ?? null,
    kind: String(d.kind ?? ''),
    message: String(d.message ?? ''),
    occurredAt: String(d.occurredAt ?? new Date().toISOString()),
  }));
}
