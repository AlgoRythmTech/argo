import { MongoClient, type Db } from 'mongodb';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongo(): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) return { client, db };
  const cfg = getConfig();
  client = new MongoClient(cfg.MONGODB_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  db = client.db(cfg.MONGODB_DB);
  logger.info({ db: cfg.MONGODB_DB }, 'mongodb connected');
  await ensureIndexes(db);
  return { client, db };
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('agent_invocations').createIndex({ operationId: 1, createdAt: -1 }),
    db.collection('agent_invocations').createIndex({ kind: 1, createdAt: -1 }),
    db.collection('runtime_events').createIndex({ operationId: 1, createdAt: -1 }),
    db.collection('runtime_events').createIndex({ severity: 1, processedAt: 1 }),
    db.collection('operation_repairs').createIndex({ operationId: 1, createdAt: -1 }),
    db.collection('operation_repairs').createIndex({ status: 1 }),
    db.collection('operation_bundles').createIndex({ operationId: 1, version: -1 }),
    db.collection('templates').createIndex({ operationId: 1, kind: 1 }),
    db.collection('voice_corpus').createIndex({ operationId: 1, sentAt: -1 }),
    db.collection('workflow_intents').createIndex({ operationId: 1, createdAt: -1 }),
    db.collection('workflow_maps').createIndex({ operationId: 1, version: -1 }),
    db.collection('submissions').createIndex({ operationId: 1, receivedAt: -1 }),
    db.collection('submissions').createIndex({ status: 1 }),
    db.collection('activity_feed').createIndex({ ownerId: 1, occurredAt: -1 }),
  ]);
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
