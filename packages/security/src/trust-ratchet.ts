import type { EmailTemplate } from '@argo/shared-types';

/**
 * The trust ratchet, hard-coded.
 *
 * Section 3, Fatal Flaw #1:
 *   "Argo never sends an outbound email to a third party without an approval
 *    gate on the first ten sends per template, regardless of how confident
 *    the model is. After ten approvals on a template with an approval rate
 *    above 95%, the gate becomes opt-in."
 *
 * This is NOT a feature flag. It is a constant. The thresholds may be
 * configured via env (TRUST_RATCHET_MIN_APPROVALS,
 * TRUST_RATCHET_APPROVAL_RATE_THRESHOLD), but they cannot be removed or
 * defaulted to a less safe value. The trust ratchet is the product.
 */

export type TrustRatchetThresholds = {
  minApprovals: number;
  approvalRateThreshold: number;
};

export const DEFAULT_THRESHOLDS: TrustRatchetThresholds = {
  minApprovals: 10,
  approvalRateThreshold: 0.95,
};

export function getThresholdsFromEnv(): TrustRatchetThresholds {
  const minApprovals = Number.parseInt(process.env.TRUST_RATCHET_MIN_APPROVALS ?? '', 10);
  const rateRaw = Number.parseFloat(process.env.TRUST_RATCHET_APPROVAL_RATE_THRESHOLD ?? '');
  return {
    minApprovals: Number.isFinite(minApprovals) && minApprovals >= 1 ? minApprovals : 10,
    approvalRateThreshold:
      Number.isFinite(rateRaw) && rateRaw >= 0.5 && rateRaw <= 1 ? rateRaw : 0.95,
  };
}

export type RatchetDecision = {
  approvalRequired: boolean;
  reason: 'first_n_sends' | 'low_approval_rate' | 'opt_in_unlocked' | 'kind_always_gated';
  sendsToDate: number;
  approvalsToDate: number;
  approvalRate: number;
};

/**
 * The single decision function. Every outbound third-party email passes
 * through this before being sent. There is no caller that bypasses it.
 */
export function decideApprovalGate(
  template: Pick<EmailTemplate, 'kind' | 'sendsToDate' | 'approvalsToDate' | 'approvalRequired'>,
  thresholds: TrustRatchetThresholds = DEFAULT_THRESHOLDS,
): RatchetDecision {
  const sends = template.sendsToDate;
  const approvals = template.approvalsToDate;
  const rate = sends === 0 ? 0 : approvals / sends;

  // The approval-to-owner kind is always gated. It IS the approval.
  if (template.kind === 'approval_to_owner' || template.kind === 'repair_request') {
    return {
      approvalRequired: false,
      reason: 'kind_always_gated',
      sendsToDate: sends,
      approvalsToDate: approvals,
      approvalRate: rate,
    };
  }

  if (sends < thresholds.minApprovals) {
    return {
      approvalRequired: true,
      reason: 'first_n_sends',
      sendsToDate: sends,
      approvalsToDate: approvals,
      approvalRate: rate,
    };
  }

  if (rate < thresholds.approvalRateThreshold) {
    return {
      approvalRequired: true,
      reason: 'low_approval_rate',
      sendsToDate: sends,
      approvalsToDate: approvals,
      approvalRate: rate,
    };
  }

  return {
    approvalRequired: !template.approvalRequired ? false : false,
    reason: 'opt_in_unlocked',
    sendsToDate: sends,
    approvalsToDate: approvals,
    approvalRate: rate,
  };
}
