// Initial Mongo collections for Argo.
// Created on first container boot; idempotent.

const dbName = 'argo';
db = db.getSiblingDB(dbName);

const collections = [
  'operations',
  'agent_invocations',
  'runtime_events',
  'operation_repairs',
  'operation_bundles',
  'templates',
  'voice_corpus',
  'workflow_intents',
  'workflow_maps',
];

for (const c of collections) {
  if (!db.getCollectionNames().includes(c)) {
    db.createCollection(c);
  }
}

db.operations.createIndex({ ownerId: 1, status: 1 });
db.operations.createIndex({ slug: 1 }, { unique: true });

db.agent_invocations.createIndex({ operationId: 1, createdAt: -1 });
db.agent_invocations.createIndex({ kind: 1, createdAt: -1 });

db.runtime_events.createIndex({ operationId: 1, createdAt: -1 });
db.runtime_events.createIndex({ severity: 1, processedAt: 1 });

db.operation_repairs.createIndex({ operationId: 1, createdAt: -1 });
db.operation_repairs.createIndex({ status: 1 });

db.operation_bundles.createIndex({ operationId: 1, version: -1 });

db.templates.createIndex({ operationId: 1, kind: 1 });

print('argo: mongo init complete');
