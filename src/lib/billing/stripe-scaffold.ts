// Stripe integration point (scaffold).
//
// The billing UI is built and reads the current plan from `workspace_plans`,
// but no live Stripe calls are wired yet. To go live:
//   1. `npm i stripe`
//   2. Set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET (see .env.example).
//   3. Implement the two functions below with the Stripe SDK, and add a webhook
//      route at /api/settings/billing/webhook that syncs subscription status onto
//      workspaces.stripe_subscription_status / stripe_customer_id.
//
// Until then these throw a typed "not configured" error the UI handles cleanly,
// so the Billing section renders without crashing.

export class BillingNotConfiguredError extends Error {
  constructor(message = "Billing is not connected yet.") {
    super(message);
    this.name = "BillingNotConfiguredError";
  }
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type BillingSessionResult = { url: string };

export async function createBillingPortalSession(_input: {
  workspaceId: string;
  stripeCustomerId: string | null;
  returnUrl: string;
}): Promise<BillingSessionResult> {
  if (!isBillingConfigured()) {
    throw new BillingNotConfiguredError();
  }
  // TODO: const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  //       const session = await stripe.billingPortal.sessions.create({
  //         customer: _input.stripeCustomerId!, return_url: _input.returnUrl });
  //       return { url: session.url };
  throw new BillingNotConfiguredError("Stripe key is set, but the billing portal call is not implemented yet.");
}

export async function createCheckoutSession(_input: {
  workspaceId: string;
  priceId: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<BillingSessionResult> {
  if (!isBillingConfigured()) {
    throw new BillingNotConfiguredError();
  }
  throw new BillingNotConfiguredError("Stripe key is set, but checkout is not implemented yet.");
}
