import {
  currencyForMarket,
  isBillingCurrency,
  isBillingMarket,
  type BillingProduct,
} from "./offers.ts";

export type CheckoutWorkspaceFacts = {
  countryConfirmedAt: string | boolean | null;
  countryCode: string | null;
  billingCurrency: string | null;
  billingAccessState: string | null;
  stripeSubscriptionId: string | null;
  managedScopeApprovedAt: string | null;
};

export type CheckoutRequestContext = {
  role: string;
  product: BillingProduct;
};

export type CheckoutDecision =
  | { ok: true }
  | { ok: false; status: number; error: string };

const DUPLICATE_ACCESS_STATES = new Set(["paid", "trialing", "payment_recovery"]);

/**
 * Single server-side authority for who may start Checkout and when. Runs
 * before any Stripe call so unauthorized users, unconfirmed/unsupported
 * markets, duplicate subscriptions, and ungated managed-service purchases are
 * rejected without creating sessions.
 */
export function evaluateCheckoutRequest(
  input: { facts: CheckoutWorkspaceFacts | null; context: CheckoutRequestContext },
): CheckoutDecision {
  const { facts, context } = input;

  if (context.role !== "owner" && context.role !== "admin") {
    return { ok: false, status: 403, error: "Only an owner or admin can manage billing." };
  }
  if (!facts) {
    return { ok: false, status: 500, error: "Couldn't load the workspace billing market." };
  }
  if (!facts.countryConfirmedAt) {
    return { ok: false, status: 409, error: "Confirm the workspace country before starting Checkout." };
  }
  if (!isBillingMarket(facts.countryCode) || !isBillingCurrency(facts.billingCurrency)) {
    return { ok: false, status: 409, error: "Confirm the workspace country before starting Checkout." };
  }
  if (facts.billingCurrency !== currencyForMarket(facts.countryCode)) {
    return { ok: false, status: 409, error: "The workspace billing currency does not match its country." };
  }
  if (
    context.product === "managed" &&
    !facts.managedScopeApprovedAt
  ) {
    return {
      ok: false,
      status: 403,
      error:
        "Managed service needs a written scope approved with Blockwise before Checkout. Contact us to confirm scope.",
    };
  }
  if (DUPLICATE_ACCESS_STATES.has(facts.billingAccessState ?? "")) {
    return {
      ok: false,
      status: 409,
      error: "This workspace already has an active Blockwise subscription. Manage it from billing.",
    };
  }
  if (facts.stripeSubscriptionId && facts.billingAccessState !== "canceled") {
    return {
      ok: false,
      status: 409,
      error: "This workspace already has an active Blockwise subscription. Manage it from billing.",
    };
  }

  return { ok: true };
}
