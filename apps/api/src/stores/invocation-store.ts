import type { InvocationStore } from '@argo/agent';
import type { AgentInvocation } from '@argo/shared-types';
import { getMongo } from '../db/mongo.js';

/**
 * Mongo-backed implementation of InvocationStore. Append-only, used for
 * audit + replay of every agent call.
 */
export class MongoInvocationStore implements InvocationStore {
  async insert(invocation: AgentInvocation): Promise<void> {
    const { db } = await getMongo();
    await db.collection('agent_invocations').insertOne(invocation as unknown as Document);
  }
}

type Document = Record<string, unknown>;
