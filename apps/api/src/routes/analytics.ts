import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';

/**
 * GET /api/analytics
 *
 * Aggregated analytics for the operator's workspace: submissions over
 * time, approval rates, email delivery, error rates, cost breakdown.
 * All data is derived from existing MongoDB collections — no new writes.
 */
export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/overview', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const prisma = getPrisma();
    const { db } = await getMongo();

    const ops = await prisma.operation.findMany({
      where: { ownerId: session.userId, status: { not: 'archived' } },
      select: { id: true, name: true, status: true, publicUrl: true, submissionsToday: true, pendingApprovals: true, bundleVersion: true, createdAt: true },
    });
    const opIds = ops.map((o: { id: string }) => o.id);

    // Parallel aggregation queries.
    const [
      submissionsByDay,
      approvalStats,
      errorsByDay,
      invocationStats,
      repairStats,
      topOperations,
    ] = await Promise.all([
      // Submissions per day (last 30 days).
      db.collection('submissions').aggregate([
        { $match: { operationId: { $in: opIds }, createdAt: { $gte: daysAgo(30) } } },
        { $group: { _id: { $substr: ['$createdAt', 0, 10] }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      // Approval metrics.
      prisma.approval.groupBy({
        by: ['status'],
        where: { operationId: { in: opIds } },
        _count: true,
      }),

      // Errors per day (last 30 days).
      db.collection('runtime_events').aggregate([
        { $match: { operationId: { $in: opIds }, kind: { $in: ['http_5xx', 'unhandled_exception'] }, occurredAt: { $gte: daysAgo(30) } } },
        { $group: { _id: { $substr: ['$occurredAt', 0, 10] }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      // LLM invocation stats (last 30 days).
      db.collection('agent_invocations').aggregate([
        { $match: { ownerId: session.userId, createdAt: { $gte: daysAgo(30) } } },
        {
          $group: {
            _id: null,
            totalInvocations: { $sum: 1 },
            totalCostUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
            totalPromptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
            totalCompletionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
            avgDurationMs: { $avg: { $ifNull: ['$durationMs', 0] } },
            failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          },
        },
      ]).toArray(),

      // Repair stats.
      db.collection('operation_repairs').aggregate([
        { $match: { operationId: { $in: opIds } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]).toArray(),

      // Top operations by submissions.
      db.collection('submissions').aggregate([
        { $match: { operationId: { $in: opIds } } },
        { $group: { _id: '$operationId', total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]).toArray(),
    ]);

    const approvalCounts: Record<string, number> = Object.fromEntries(
      approvalStats.map((g: { status: string; _count: number }) => [g.status, g._count]),
    );
    const totalApprovals = Object.values(approvalCounts).reduce((a: number, b: number) => a + b, 0);
    const approvedCount = approvalCounts.approved ?? 0;

    const invStats = invocationStats[0] ?? {
      totalInvocations: 0,
      totalCostUsd: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      avgDurationMs: 0,
      failedCount: 0,
    };

    const repairCounts = Object.fromEntries(
      repairStats.map((g) => [String(g._id), g.count]),
    );

    const opNameMap = Object.fromEntries(ops.map((o: { id: string; name: string }) => [o.id, o.name]));

    return reply.send({
      operationCount: ops.length,
      runningCount: ops.filter((o: { status: string }) => o.status === 'running').length,
      totalSubmissionsToday: ops.reduce((a: number, o: { submissionsToday: number }) => a + o.submissionsToday, 0),
      totalPendingApprovals: ops.reduce((a: number, o: { pendingApprovals: number }) => a + o.pendingApprovals, 0),

      submissionsTimeline: submissionsByDay.map((d) => ({
        date: d._id,
        count: d.count,
      })),

      errorsTimeline: errorsByDay.map((d) => ({
        date: d._id,
        count: d.count,
      })),

      approvals: {
        total: totalApprovals,
        approved: approvedCount,
        declined: approvalCounts.declined ?? 0,
        pending: approvalCounts.pending ?? 0,
        expired: approvalCounts.expired ?? 0,
        approvalRate: totalApprovals > 0 ? Math.round((approvedCount / totalApprovals) * 100) : 0,
      },

      llm: {
        totalInvocations: invStats.totalInvocations,
        totalCostUsd: Math.round((invStats.totalCostUsd as number) * 100) / 100,
        totalPromptTokens: invStats.totalPromptTokens,
        totalCompletionTokens: invStats.totalCompletionTokens,
        avgDurationMs: Math.round(invStats.avgDurationMs as number),
        failedCount: invStats.failedCount,
        successRate:
          invStats.totalInvocations > 0
            ? Math.round(((invStats.totalInvocations - (invStats.failedCount as number)) / invStats.totalInvocations) * 100)
            : 100,
      },

      repairs: {
        total: Object.values(repairCounts).reduce((a, b) => a + (b as number), 0),
        awaiting: (repairCounts.awaiting_approval as number) ?? 0,
        approved: (repairCounts.approved as number) ?? 0,
        deployed: (repairCounts.deployed as number) ?? 0,
        rejected: (repairCounts.rejected as number) ?? 0,
      },

      topOperations: topOperations.map((t) => ({
        operationId: t._id,
        operationName: opNameMap[t._id as string] ?? 'Unknown',
        totalSubmissions: t.total,
      })),
    });
  });

  /** GET /api/analytics/operation/:id — per-operation analytics. */
  app.get('/api/analytics/operation/:id', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const operationId = String((request.params as { id: string }).id);

    const op = await getPrisma().operation.findFirst({
      where: { id: operationId, ownerId: session.userId },
    });
    if (!op) return reply.code(404).send({ error: 'not_found' });

    const { db } = await getMongo();

    const [submissionsByDay, errorsByDay, invocationsByKind, recentSubmissions] = await Promise.all([
      db.collection('submissions').aggregate([
        { $match: { operationId, createdAt: { $gte: daysAgo(30) } } },
        { $group: { _id: { $substr: ['$createdAt', 0, 10] }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      db.collection('runtime_events').aggregate([
        { $match: { operationId, kind: { $in: ['http_5xx', 'unhandled_exception'] }, occurredAt: { $gte: daysAgo(30) } } },
        { $group: { _id: { $substr: ['$occurredAt', 0, 10] }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),

      db.collection('agent_invocations').aggregate([
        { $match: { operationId, createdAt: { $gte: daysAgo(30) } } },
        {
          $group: {
            _id: '$kind',
            count: { $sum: 1 },
            totalCost: { $sum: { $ifNull: ['$costUsd', 0] } },
            avgDuration: { $avg: { $ifNull: ['$durationMs', 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]).toArray(),

      db.collection('submissions')
        .find({ operationId })
        .sort({ createdAt: -1 })
        .limit(20)
        .project({ _id: 0, id: 1, status: 1, createdAt: 1 })
        .toArray(),
    ]);

    return reply.send({
      operationId,
      operationName: op.name,
      status: op.status,
      bundleVersion: op.bundleVersion,
      submissionsTimeline: submissionsByDay.map((d) => ({ date: d._id, count: d.count })),
      errorsTimeline: errorsByDay.map((d) => ({ date: d._id, count: d.count })),
      invocationsByKind: invocationsByKind.map((k) => ({
        kind: k._id,
        count: k.count,
        totalCostUsd: Math.round((k.totalCost as number) * 100) / 100,
        avgDurationMs: Math.round(k.avgDuration as number),
      })),
      recentSubmissions,
    });
  });
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
