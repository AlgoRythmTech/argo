import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';

/**
 * Usage Dashboard API — transparent cost tracking.
 *
 * "Token consumption is the #1 pain point" across Replit/Lovable/Bolt.
 * Users hate opaque credit systems. Argo shows exactly what costs what:
 * per-model token usage, per-operation breakdown, projected monthly cost.
 *
 * No surprises. No hidden fees. No "you ran out of credits mid-build."
 */

// Model pricing (per 1M tokens, USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.5': { input: 3.00, output: 15.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-opus-4-7': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
};

export async function registerUsageRoutes(app: FastifyInstance) {
  /** GET /api/usage — Full usage breakdown for the current billing period. */
  app.get('/api/usage', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { db } = await getMongo();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // Aggregate usage by model for the current month.
    const [byModel, byOperation, byDay, totals] = await Promise.all([
      // Per-model breakdown
      db.collection('agent_invocations').aggregate([
        { $match: { ownerId: session.userId, createdAt: { $gte: monthStart } } },
        {
          $group: {
            _id: '$model',
            invocations: { $sum: 1 },
            promptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
            completionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
            totalCost: { $sum: { $ifNull: ['$costUsd', 0] } },
            avgDurationMs: { $avg: { $ifNull: ['$durationMs', 0] } },
            failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          },
        },
        { $sort: { totalCost: -1 } },
      ]).toArray(),

      // Per-operation breakdown
      db.collection('agent_invocations').aggregate([
        { $match: { ownerId: session.userId, createdAt: { $gte: monthStart } } },
        {
          $group: {
            _id: '$operationId',
            invocations: { $sum: 1 },
            promptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
            completionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
            totalCost: { $sum: { $ifNull: ['$costUsd', 0] } },
          },
        },
        { $sort: { totalCost: -1 } },
        { $limit: 20 },
      ]).toArray(),

      // Daily usage for the current month
      db.collection('agent_invocations').aggregate([
        { $match: { ownerId: session.userId, createdAt: { $gte: monthStart } } },
        {
          $group: {
            _id: { $substr: ['$createdAt', 0, 10] },
            invocations: { $sum: 1 },
            tokens: { $sum: { $add: [{ $ifNull: ['$promptTokens', 0] }, { $ifNull: ['$completionTokens', 0] }] } },
            cost: { $sum: { $ifNull: ['$costUsd', 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]).toArray(),

      // Grand totals
      db.collection('agent_invocations').aggregate([
        { $match: { ownerId: session.userId, createdAt: { $gte: monthStart } } },
        {
          $group: {
            _id: null,
            invocations: { $sum: 1 },
            promptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
            completionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
            totalCost: { $sum: { $ifNull: ['$costUsd', 0] } },
          },
        },
      ]).toArray(),
    ]);

    // Get operation names.
    const opIds = byOperation.map((o) => String(o._id)).filter(Boolean);
    const ops = opIds.length > 0
      ? await getPrisma().operation.findMany({
          where: { id: { in: opIds } },
          select: { id: true, name: true },
        })
      : [];
    const opNameMap = Object.fromEntries(
      ops.map((o: { id: string; name: string }) => [o.id, o.name]),
    );

    const grandTotal = totals[0] ?? {
      invocations: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
    };

    const totalCost = Math.round((grandTotal.totalCost as number) * 100) / 100;
    const projectedMonthly = dayOfMonth > 0
      ? Math.round((totalCost / dayOfMonth) * daysInMonth * 100) / 100
      : 0;

    return reply.send({
      period: {
        start: monthStart,
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
        dayOfMonth,
        daysInMonth,
      },

      totals: {
        invocations: grandTotal.invocations,
        promptTokens: grandTotal.promptTokens,
        completionTokens: grandTotal.completionTokens,
        totalTokens: (grandTotal.promptTokens as number) + (grandTotal.completionTokens as number),
        totalCostUsd: totalCost,
        projectedMonthlyCostUsd: projectedMonthly,
      },

      byModel: byModel.map((m) => ({
        model: m._id ?? 'unknown',
        invocations: m.invocations,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        totalTokens: (m.promptTokens as number) + (m.completionTokens as number),
        costUsd: Math.round((m.totalCost as number) * 100) / 100,
        avgDurationMs: Math.round(m.avgDurationMs as number),
        failures: m.failures,
        pricing: MODEL_PRICING[m._id as string] ?? null,
      })),

      byOperation: byOperation.map((o) => ({
        operationId: o._id,
        operationName: opNameMap[o._id as string] ?? 'Unknown',
        invocations: o.invocations,
        promptTokens: o.promptTokens,
        completionTokens: o.completionTokens,
        costUsd: Math.round((o.totalCost as number) * 100) / 100,
      })),

      daily: byDay.map((d) => ({
        date: d._id,
        invocations: d.invocations,
        tokens: d.tokens,
        costUsd: Math.round((d.cost as number) * 100) / 100,
      })),

      pricing: MODEL_PRICING,
    });
  });
}
