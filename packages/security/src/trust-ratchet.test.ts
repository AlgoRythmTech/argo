import { describe, expect, it } from 'vitest';
import { decideApprovalGate, DEFAULT_THRESHOLDS } from './trust-ratchet.js';

const baseTemplate = {
  approvalRequired: true,
  sendsToDate: 0,
  approvalsToDate: 0,
} as const;

describe('decideApprovalGate', () => {
  it('always gates a brand-new third-party template', () => {
    const decision = decideApprovalGate({
      ...baseTemplate,
      kind: 'rejection_to_third_party',
    });
    expect(decision.approvalRequired).toBe(true);
    expect(decision.reason).toBe('first_n_sends');
  });

  it('keeps gating until the 10th send even at 100% approval rate', () => {
    const decision = decideApprovalGate({
      kind: 'rejection_to_third_party',
      sendsToDate: 9,
      approvalsToDate: 9,
      approvalRequired: true,
    });
    expect(decision.approvalRequired).toBe(true);
    expect(decision.reason).toBe('first_n_sends');
  });

  it('gates when approval rate drops below 95%', () => {
    const decision = decideApprovalGate({
      kind: 'rejection_to_third_party',
      sendsToDate: 50,
      approvalsToDate: 40,
      approvalRequired: true,
    });
    expect(decision.approvalRequired).toBe(true);
    expect(decision.reason).toBe('low_approval_rate');
  });

  it('unlocks once thresholds are met', () => {
    const decision = decideApprovalGate({
      kind: 'rejection_to_third_party',
      sendsToDate: 20,
      approvalsToDate: 20,
      approvalRequired: false,
    });
    expect(decision.approvalRequired).toBe(false);
    expect(decision.reason).toBe('opt_in_unlocked');
  });

  it('uses configured thresholds when supplied', () => {
    const decision = decideApprovalGate(
      {
        kind: 'rejection_to_third_party',
        sendsToDate: 5,
        approvalsToDate: 5,
        approvalRequired: false,
      },
      { minApprovals: 3, approvalRateThreshold: 0.9 },
    );
    expect(decision.approvalRequired).toBe(false);
    expect(decision.reason).toBe('opt_in_unlocked');
  });

  it('approval-to-owner kind never blocks (it IS the approval)', () => {
    const decision = decideApprovalGate({
      kind: 'approval_to_owner',
      sendsToDate: 0,
      approvalsToDate: 0,
      approvalRequired: false,
    });
    expect(decision.approvalRequired).toBe(false);
    expect(decision.reason).toBe('kind_always_gated');
  });

  it('default thresholds are 10 and 0.95', () => {
    expect(DEFAULT_THRESHOLDS.minApprovals).toBe(10);
    expect(DEFAULT_THRESHOLDS.approvalRateThreshold).toBe(0.95);
  });
});
