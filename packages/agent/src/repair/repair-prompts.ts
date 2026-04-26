import type { RepairFailureKind } from '@argo/shared-types';

/**
 * Per-failure repair prompts. Section 11 enforces tight constraints on what
 * a repair can change. The prompts here exist to keep that enforcement
 * legible — if you find yourself relaxing one, that's a security review.
 */

const COMMON_CONSTRAINTS = [
  'Do NOT modify the database schema',
  'Do NOT change the form endpoint contract (URL, fields, methods)',
  'Do NOT alter approval gating logic',
  'Do NOT add new packages — every import must already be in the bundle',
  'Do NOT introduce comments referencing the failure or the issue tracker',
  'Patches must keep all argo:generated headers intact',
];

export function constraintsFor(kind: RepairFailureKind, smallerChange: boolean): string[] {
  const base: string[] = [];
  switch (kind) {
    case 'application_error':
      base.push('Repair the runtime exception in the failing handler. Add a guard, do not swallow.');
      break;
    case 'dependency_failure':
      base.push('A downstream call failed. Add a retry-with-backoff (max 3) and a circuit-break on persistent failure. Do NOT introduce a new dependency.');
      break;
    case 'data_validation_error':
      base.push('A submission did not match expected shape. Tighten validation in the validate step OR widen the schema if the missing field is genuinely optional. Document the choice in whatChanged.');
      break;
    case 'configuration_error':
      base.push('A required env var is missing or malformed. Surface a clear error message in the health endpoint and a default fallback in the handler.');
      break;
  }
  if (smallerChange) {
    base.push('Propose the smallest possible change that resolves the failure, even if a larger refactor would be cleaner. Trust ratchet is in early-customer mode.');
  }
  return [...base, ...COMMON_CONSTRAINTS];
}
