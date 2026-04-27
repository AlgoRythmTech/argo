// Billing endpoints — Stripe customer + checkout session + signed webhook.
//
//   POST /api/billing/checkout       — start a checkout for the operator's next op
//   POST /api/billing/portal         — open the Stripe customer portal
//   POST /webhooks/stripe            — Stripe → Argo signed event sink
//
// Operators see the simple price (master prompt §14): $199 for the first
// operation (free 30 days), $149 for the second, $99 for the third+.
// We never expose tokens or credits.

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getStripe, priceIdForOperation } from '../billing/stripe-client.js';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { logger } from '../logger.js';

const CheckoutBody = z.object({
  successPath: z.string().min(1).max(200).default('/billing/success'),
  cancelPath: z.string().min(1).max(200).default('/billing/cancel'),
});

export async function registerBillingRoutes(app: FastifyInstance) {
  app.post('/api/billing/checkout', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const parsed = CheckoutBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { client, enabled } = getStripe();
    if (!enabled || !client) {
      return reply.code(409).send({ error: 'billing_disabled', message: 'STRIPE_ENABLED=false' });
    }

    // Make-or-get the BillingCustomer row + Stripe customer.
    let billing = await getPrisma().billingCustomer.findUnique({ where: { userId: session.userId } });
    if (!billing) {
      const customer = await client.customers.create({
        email: session.email,
        metadata: { argoUserId: session.userId },
      });
      billing = await getPrisma().billingCustomer.create({
        data: {
          userId: session.userId,
          email: session.email,
          stripeCustomerId: customer.id,
        },
      });
    } else if (!billing.stripeCustomerId) {
      const customer = await client.customers.create({
        email: session.email,
        metadata: { argoUserId: session.userId },
      });
      billing = await getPrisma().billingCustomer.update({
        where: { id: billing.id },
        data: { stripeCustomerId: customer.id },
      });
    }

    // Decide which price to charge based on how many active operations they have.
    const activeOps = await getPrisma().operation.count({
      where: { ownerId: session.userId, status: { not: 'archived' } },
    });
    const priceId = priceIdForOperation(activeOps + 1);
    if (!priceId) {
      return reply
        .code(409)
        .send({ error: 'no_price_configured', activeOps });
    }

    const publicUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:5173';
    const checkout = await client.checkout.sessions.create({
      mode: 'subscription',
      customer: billing.stripeCustomerId!,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${publicUrl}${parsed.data.successPath}?cs={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}${parsed.data.cancelPath}`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { argoUserId: session.userId, operationCountAtCheckout: String(activeOps + 1) },
      },
    });
    return reply.send({ url: checkout.url, sessionId: checkout.id });
  });

  app.post('/api/billing/portal', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { client, enabled } = getStripe();
    if (!enabled || !client) {
      return reply.code(409).send({ error: 'billing_disabled' });
    }
    const billing = await getPrisma().billingCustomer.findUnique({ where: { userId: session.userId } });
    if (!billing?.stripeCustomerId) {
      return reply.code(404).send({ error: 'no_billing_customer' });
    }
    const portal = await client.billingPortal.sessions.create({
      customer: billing.stripeCustomerId,
      return_url: process.env.API_PUBLIC_URL ?? 'http://localhost:5173',
    });
    return reply.send({ url: portal.url });
  });

  // Stripe → Argo signed webhook. Raw body required for signature check.
  app.post('/webhooks/stripe', async (request, reply) => {
    const { client, enabled } = getStripe();
    if (!enabled || !client) {
      return reply.code(409).send({ error: 'billing_disabled' });
    }
    const sig = String(request.headers['stripe-signature'] ?? '');
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    if (!sig || !secret) return reply.code(401).send({ error: 'missing_signature' });

    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? '';
    let event: import('stripe').Stripe.Event;
    try {
      event = client.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      logger.warn({ err }, 'stripe webhook signature failed');
      return reply.code(401).send({ error: 'bad_signature' });
    }

    // Dedup using Stripe's event id — Stripe retries.
    const { db } = await getMongo();
    const dedup = await db
      .collection('billing_webhook_dedup')
      .findOneAndUpdate(
        { _id: event.id as unknown as never },
        { $setOnInsert: { receivedAt: new Date().toISOString() } },
        { upsert: true, returnDocument: 'before' },
      );
    if (dedup && dedup.value) return reply.send({ ok: true, deduped: true });

    switch (event.type) {
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        await db.collection('billing_events').insertOne({
          id: event.id,
          type: event.type,
          createdAt: new Date(event.created * 1000).toISOString(),
          object: event.data.object,
        } as Record<string, unknown>);
        break;
      }
      default:
        // Drop everything else; we'll add handlers as they become relevant.
        break;
    }
    return reply.send({ ok: true });
  });
}
