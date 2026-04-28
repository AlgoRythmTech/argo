import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';

/**
 * Data Browser API — browse the data your operation generates.
 *
 * Users struggle with raw database access (Supabase RLS confusion is
 * the #1 complaint about Lovable). Argo provides a simple, safe data
 * browser that connects to the operation's MongoDB and shows
 * collections, documents, and basic stats.
 *
 * Security: read-only by default, write operations require explicit
 * confirmation. All queries are scoped to the operation's database.
 */

export async function registerDataBrowserRoutes(app: FastifyInstance) {
  /** GET /api/operations/:id/data/collections — List collections in the operation's DB. */
  app.get('/api/operations/:id/data/collections', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const operationId = String((request.params as { id: string }).id);
    const prisma = getPrisma();

    const op = await prisma.operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const opDbName = `argo_op_${operationId}`;

    // Try to connect to the operation's dedicated database.
    // Fall back to querying collections in the main database that are
    // prefixed with the operation ID.
    try {
      const opDb = db.client.db(opDbName);
      const collections = await opDb.listCollections().toArray();

      const stats = await Promise.all(
        collections.map(async (col) => {
          try {
            const count = await opDb.collection(col.name).estimatedDocumentCount();
            return { name: col.name, type: col.type, documentCount: count };
          } catch {
            return { name: col.name, type: col.type, documentCount: 0 };
          }
        }),
      );

      return reply.send({
        operationId,
        database: opDbName,
        collections: stats,
        totalCollections: stats.length,
        totalDocuments: stats.reduce((sum, s) => sum + s.documentCount, 0),
      });
    } catch {
      // Fall back: look for documents in the main DB tagged with this operation.
      const mainCollections = ['submissions', 'runtime_events', 'emails_sent', 'operation_repairs'];
      const stats = await Promise.all(
        mainCollections.map(async (name) => {
          try {
            const count = await db.collection(name).countDocuments({ operationId });
            return { name, type: 'collection', documentCount: count };
          } catch {
            return { name, type: 'collection', documentCount: 0 };
          }
        }),
      );

      return reply.send({
        operationId,
        database: 'argo (shared)',
        collections: stats.filter((s) => s.documentCount > 0),
        totalCollections: stats.filter((s) => s.documentCount > 0).length,
        totalDocuments: stats.reduce((sum, s) => sum + s.documentCount, 0),
      });
    }
  });

  /** GET /api/operations/:id/data/:collection — Browse documents in a collection. */
  app.get('/api/operations/:id/data/:collection', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const operationId = String((request.params as { id: string }).id);
    const collectionName = String((request.params as { collection: string }).collection);
    const query = request.query as { page?: string; limit?: string; sort?: string; filter?: string };

    const prisma = getPrisma();
    const op = await prisma.operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
    const skip = (page - 1) * limit;
    const sortField = query.sort ?? 'createdAt';

    const { db } = await getMongo();
    const opDbName = `argo_op_${operationId}`;

    let collection;
    let filter: Record<string, unknown> = {};

    try {
      const opDb = db.client.db(opDbName);
      collection = opDb.collection(collectionName);
    } catch {
      // Fall back to main DB with operationId filter.
      collection = db.collection(collectionName);
      filter = { operationId };
    }

    // Parse user-provided filter (safe JSON parse).
    if (query.filter) {
      try {
        const userFilter = JSON.parse(query.filter);
        if (typeof userFilter === 'object' && userFilter !== null) {
          filter = { ...filter, ...userFilter };
        }
      } catch { /* ignore bad filter */ }
    }

    const [documents, totalCount] = await Promise.all([
      collection
        .find(filter)
        .sort({ [sortField]: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    // Sanitize documents: convert ObjectId to string, redact large fields.
    const sanitized = documents.map((doc) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(doc)) {
        if (key === '_id') {
          clean.id = value?.toString();
        } else if (typeof value === 'string' && value.length > 2000) {
          clean[key] = value.slice(0, 2000) + '... (truncated)';
        } else {
          clean[key] = value;
        }
      }
      return clean;
    });

    return reply.send({
      operationId,
      collection: collectionName,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      documents: sanitized,
    });
  });

  /** GET /api/operations/:id/data/:collection/:docId — Get a single document. */
  app.get('/api/operations/:id/data/:collection/:docId', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const operationId = String((request.params as { id: string }).id);
    const collectionName = String((request.params as { collection: string }).collection);
    const docId = String((request.params as { docId: string }).docId);

    const prisma = getPrisma();
    const op = await prisma.operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();
    const { ObjectId } = await import('mongodb');
    const opDbName = `argo_op_${operationId}`;

    let doc;
    try {
      const opDb = db.client.db(opDbName);
      doc = await opDb.collection(collectionName).findOne({ _id: new ObjectId(docId) });
    } catch {
      doc = await db.collection(collectionName).findOne({
        _id: new ObjectId(docId),
        operationId,
      });
    }

    if (!doc) return reply.code(404).send({ error: 'document_not_found' });

    return reply.send({
      operationId,
      collection: collectionName,
      document: { id: doc._id?.toString(), ...doc, _id: undefined },
    });
  });
}
