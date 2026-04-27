// Stripe client wrapper. Only constructed when STRIPE_ENABLED=true and
// STRIPE_SECRET_KEY is set. Every callsite first checks isEnabled so the
// dev environment runs without Stripe configured.

import Stripe from 'stripe';

let cached: { client: Stripe | null; enabled: boolean } | null = null;

export function getStripe(): { client: Stripe | null; enabled: boolean } {
  if (cached) return cached;
  const enabled =
    (process.env.STRIPE_ENABLED ?? 'false').toLowerCase() === 'true' &&
    (process.env.STRIPE_SECRET_KEY ?? '').length > 0;
  cached = {
    client: enabled
      ? new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: '2024-09-30.acacia' as Stripe.LatestApiVersion,
          typescript: true,
        })
      : null,
    enabled,
  };
  return cached;
}

/**
 * Picks the Stripe Price ID for an operator's Nth operation, per the
 * pricing schedule from master prompt §14.
 */
export function priceIdForOperation(operationNumber: number): string | null {
  if (operationNumber <= 1) return process.env.STRIPE_PRICE_FIRST_OPERATION ?? null;
  if (operationNumber === 2) return process.env.STRIPE_PRICE_SECOND_OPERATION ?? null;
  return process.env.STRIPE_PRICE_THIRD_PLUS_OPERATION ?? null;
}
