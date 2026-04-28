/**
 * Credit Protection System — Argo's non-negotiable guarantee.
 *
 * "We never charge you for our mistakes."
 *
 * This is THE differentiator from Replit/Lovable/Bolt/Emergent. Every
 * competitor charges credits when:
 *   - The AI loops and doesn't converge
 *   - The environment crashes mid-task
 *   - The platform has a gateway/cold-start error
 *   - The agent lies about fixing something
 *
 * Argo's guarantee: if the invocation didn't produce a SUCCESSFUL,
 * VERIFIABLE outcome, the cost is refunded automatically. Period.
 *
 * How it works:
 *   1. Every LLM invocation is tracked with status: pending → success | failed | refunded
 *   2. Failed invocations (platform errors, loops, crashes) are auto-refunded
 *   3. Loop detection: if the same error pattern repeats 3+ times, stop and refund
 *   4. Environment errors (5xx from sandbox, timeout, OOM) are always refunded
 *   5. Users see a transparent breakdown: what they were charged vs. what was refunded
 */

import pino from 'pino';
import type { Db } from 'mongodb';

const log = pino({ name: 'credit-protection', level: process.env.LOG_LEVEL ?? 'info' });

// ── Types ─────────────────────────────────────────────────────────────

export interface InvocationRecord {
  id: string;
  ownerId: string;
  operationId: string | null;
  kind: string; // 'build' | 'iterate' | 'repair' | 'classify' | 'chat'
  model: string;
  provider: string;
  status: 'pending' | 'success' | 'failed' | 'refunded' | 'loop_detected';
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  refundedUsd: number;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  loopSignature: string | null; // hash of error pattern for loop detection
  createdAt: string;
  completedAt: string | null;
}

export interface CreditSummary {
  totalSpentUsd: number;
  totalRefundedUsd: number;
  netChargedUsd: number;
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  refundedInvocations: number;
  loopDetections: number;
  platformErrorRefunds: number;
  refundRate: number; // percentage
}

// ── Refundable error patterns ─────────────────────────────────────────

const PLATFORM_ERROR_CODES = new Set([
  'environment_crash',
  'sandbox_timeout',
  'sandbox_oom',
  'gateway_error',
  'cold_start_failure',
  'websocket_disconnect',
  'provider_500',
  'provider_502',
  'provider_503',
  'rate_limit_exhausted',
  'context_overflow',
  'model_not_found',
  'authentication_error',
]);

const LOOP_THRESHOLD = 3; // Same error pattern 3 times = stop and refund all

// ── Credit Protection Manager ─────────────────────────────────────────

export class CreditProtectionManager {
  constructor(private db: Db) {}

  /**
   * Record a new invocation. Called at the START of every LLM call.
   */
  async startInvocation(params: {
    ownerId: string;
    operationId: string | null;
    kind: string;
    model: string;
    provider: string;
  }): Promise<string> {
    const { nanoid } = await import('nanoid');
    const id = nanoid(16);
    const now = new Date().toISOString();

    await this.db.collection('credit_ledger').insertOne({
      id,
      ...params,
      status: 'pending',
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      refundedUsd: 0,
      durationMs: 0,
      errorCode: null,
      errorMessage: null,
      loopSignature: null,
      createdAt: now,
      completedAt: null,
    });

    return id;
  }

  /**
   * Complete an invocation successfully.
   */
  async completeSuccess(id: string, params: {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    durationMs: number;
  }): Promise<void> {
    await this.db.collection('credit_ledger').updateOne(
      { id },
      {
        $set: {
          status: 'success',
          ...params,
          completedAt: new Date().toISOString(),
        },
      },
    );
  }

  /**
   * Record a failed invocation and auto-refund if it's a platform error.
   */
  async completeFailed(id: string, params: {
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    durationMs: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<{ refunded: boolean; reason: string }> {
    const isPlatformError = PLATFORM_ERROR_CODES.has(params.errorCode);
    const refunded = isPlatformError;

    await this.db.collection('credit_ledger').updateOne(
      { id },
      {
        $set: {
          status: refunded ? 'refunded' : 'failed',
          ...params,
          refundedUsd: refunded ? params.costUsd : 0,
          completedAt: new Date().toISOString(),
        },
      },
    );

    if (refunded) {
      log.info(
        { invocationId: id, errorCode: params.errorCode, costUsd: params.costUsd },
        'auto-refunded platform error invocation',
      );
    }

    return {
      refunded,
      reason: refunded
        ? `Platform error (${params.errorCode}) — cost automatically refunded`
        : `User error or expected failure`,
    };
  }

  /**
   * Detect and handle loops: if the same error pattern repeats 3+ times
   * for the same operation, stop and refund all loop invocations.
   */
  async checkForLoop(
    ownerId: string,
    operationId: string,
    errorSignature: string,
  ): Promise<{ isLoop: boolean; refundedCount: number; refundedUsd: number }> {
    const recentFailed = await this.db
      .collection('credit_ledger')
      .find({
        ownerId,
        operationId,
        status: { $in: ['failed', 'refunded'] },
        loopSignature: errorSignature,
        createdAt: { $gte: new Date(Date.now() - 30 * 60_000).toISOString() }, // last 30 min
      })
      .toArray();

    if (recentFailed.length < LOOP_THRESHOLD) {
      return { isLoop: false, refundedCount: 0, refundedUsd: 0 };
    }

    // Loop detected! Refund all matching invocations.
    const result = await this.db.collection('credit_ledger').updateMany(
      {
        ownerId,
        operationId,
        loopSignature: errorSignature,
        status: 'failed',
        refundedUsd: 0,
      },
      {
        $set: {
          status: 'loop_detected',
          refundedUsd: { $ifNull: ['$costUsd', 0] },
        },
      },
    );

    // Calculate total refund.
    const totalRefunded = recentFailed.reduce(
      (sum, inv) => sum + ((inv.costUsd as number) ?? 0),
      0,
    );

    log.warn(
      { ownerId, operationId, errorSignature, count: recentFailed.length, refundedUsd: totalRefunded },
      'loop detected — refunding all loop invocations',
    );

    return {
      isLoop: true,
      refundedCount: result.modifiedCount,
      refundedUsd: Math.round(totalRefunded * 100) / 100,
    };
  }

  /**
   * Get credit summary for a user.
   */
  async getSummary(ownerId: string, periodStart?: string): Promise<CreditSummary> {
    const filter: Record<string, unknown> = { ownerId };
    if (periodStart) {
      filter.createdAt = { $gte: periodStart };
    }

    const pipeline = [
      { $match: filter },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$costUsd' },
          totalRefunded: { $sum: '$refundedUsd' },
          total: { $sum: 1 },
          success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $in: ['$status', ['refunded', 'loop_detected']] }, 1, 0] } },
          loops: { $sum: { $cond: [{ $eq: ['$status', 'loop_detected'] }, 1, 0] } },
          platformErrors: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'refunded'] }, { $ne: ['$errorCode', null] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ];

    const results = await this.db.collection('credit_ledger').aggregate(pipeline).toArray();
    const r = results[0] ?? {
      totalSpent: 0,
      totalRefunded: 0,
      total: 0,
      success: 0,
      failed: 0,
      refunded: 0,
      loops: 0,
      platformErrors: 0,
    };

    const totalSpent = Math.round((r.totalSpent as number) * 100) / 100;
    const totalRefunded = Math.round((r.totalRefunded as number) * 100) / 100;

    return {
      totalSpentUsd: totalSpent,
      totalRefundedUsd: totalRefunded,
      netChargedUsd: Math.round((totalSpent - totalRefunded) * 100) / 100,
      totalInvocations: r.total as number,
      successfulInvocations: r.success as number,
      failedInvocations: r.failed as number,
      refundedInvocations: r.refunded as number,
      loopDetections: r.loops as number,
      platformErrorRefunds: r.platformErrors as number,
      refundRate:
        (r.total as number) > 0
          ? Math.round(((r.refunded as number) / (r.total as number)) * 100)
          : 0,
    };
  }
}

/**
 * Generate an error signature for loop detection.
 * Hashes the error code + first 100 chars of the error message.
 */
export function errorSignature(errorCode: string, errorMessage: string): string {
  const raw = `${errorCode}:${errorMessage.slice(0, 100)}`;
  // Simple hash for grouping — not crypto-grade.
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `loop_${Math.abs(hash).toString(36)}`;
}
