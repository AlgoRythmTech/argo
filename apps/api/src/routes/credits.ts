import type { FastifyInstance } from 'fastify';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { CreditProtectionManager } from '../services/credit-protection.js';

/**
 * Credits API — transparent billing with automatic refunds.
 *
 * Argo's guarantee: "We never charge you for our mistakes."
 *
 * Every competitor (Replit, Lovable, Bolt, Emergent) charges credits
 * when their platform crashes, when the AI loops, when environments
 * fail. Argo refunds those automatically and shows you exactly what
 * happened.
 */

export async function registerCreditRoutes(app: FastifyInstance) {
  /** GET /api/credits/summary — Current billing period credit summary. */
  app.get('/api/credits/summary', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { db } = await getMongo();
    const manager = new CreditProtectionManager(db);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const summary = await manager.getSummary(session.userId, monthStart);

    return reply.send({
      period: {
        start: monthStart,
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
      },
      ...summary,
      guarantees: {
        platformErrorsRefunded: true,
        loopDetectionEnabled: true,
        loopThreshold: 3,
        environmentCrashesRefunded: true,
        description: 'Argo never charges you for platform errors, AI loops, or environment crashes. Failed invocations are automatically refunded.',
      },
    });
  });

  /** GET /api/credits/ledger — Detailed invocation ledger. */
  app.get('/api/credits/ledger', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const query = request.query as { page?: string; limit?: string; status?: string; operationId?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
    const skip = (page - 1) * limit;

    const { db } = await getMongo();

    const filter: Record<string, unknown> = { ownerId: session.userId };
    if (query.status) filter.status = query.status;
    if (query.operationId) filter.operationId = query.operationId;

    const [invocations, totalCount] = await Promise.all([
      db.collection('credit_ledger')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .project({
          _id: 0,
          id: 1,
          operationId: 1,
          kind: 1,
          model: 1,
          provider: 1,
          status: 1,
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 1,
          refundedUsd: 1,
          durationMs: 1,
          errorCode: 1,
          errorMessage: 1,
          createdAt: 1,
          completedAt: 1,
        })
        .toArray(),
      db.collection('credit_ledger').countDocuments(filter),
    ]);

    return reply.send({
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      invocations,
    });
  });

  /** GET /api/credits/guarantees — Public guarantees description. */
  app.get('/api/credits/guarantees', async (_request, reply) => {
    return reply.send({
      guarantees: [
        {
          id: 'platform_errors',
          title: 'Platform errors are always free',
          description: 'If our environment crashes, our gateway times out, or our infrastructure fails, you are never charged. The cost is automatically refunded.',
          icon: 'shield',
        },
        {
          id: 'loop_detection',
          title: 'AI loops are detected and stopped',
          description: 'If the AI tries the same fix 3 times without success, we stop it, refund all loop invocations, and suggest a different approach.',
          icon: 'rotate-ccw',
        },
        {
          id: 'no_silent_changes',
          title: 'No code changes without your approval',
          description: 'Every change is shown as a diff before it is applied. Schema changes, auth changes, and routing changes require explicit approval.',
          icon: 'eye',
        },
        {
          id: 'full_version_history',
          title: 'Full version history with one-click rollback',
          description: 'Every version of your code is saved. You can roll back to any prior state with one click. Nothing is ever permanently lost.',
          icon: 'history',
        },
        {
          id: 'transparent_pricing',
          title: 'Transparent pricing — see exactly what costs what',
          description: 'Every invocation shows the model used, tokens consumed, and exact cost. No opaque credits. No hidden fees. No surprises.',
          icon: 'dollar-sign',
        },
        {
          id: 'code_ownership',
          title: 'You own your code — download or push to GitHub anytime',
          description: 'Your generated code is yours. Download it as a ZIP, push it to GitHub, or take it anywhere. No lock-in, ever.',
          icon: 'download',
        },
        {
          id: 'human_support',
          title: 'Human support for serious issues',
          description: 'Platform bugs, data issues, and complex debugging are handled by real engineers, not just AI. You never pay credits to troubleshoot our bugs.',
          icon: 'users',
        },
      ],
    });
  });
}
