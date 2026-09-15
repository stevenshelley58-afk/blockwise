import {
  currencyForMarket,
  getBillingOffer,
  isBillingCurrency,
  isBillingMarket,
  offerRunsCheckoutTrial,
  type BillingProduct,
} from "./offers.ts";

export type CheckoutWorkspaceFacts = {
  countryConfirmedAt: string | boolean | null;
  countryCode: string | null;
  billingCurrency: string | null;
  billingAccessState: string | null;
  stripeSubscriptionId: string | null;
  managedScopeApprovedAt: string | null;
  /**
   * When this workspace first consumed a self-serve trial, if ever. A non-null
   * value means the trial has been used, so Checkout must not grant another
   * one. This is the explicit cohort fact that replaces inferring trial
   * eligibility from an offer version comparison.
   */
  trialConsumedAt: string | null;
};

export type CheckoutRequestContext = {
  role: string;
  product: BillingProduct;
};

export type CheckoutDecision =
  | {
      ok: true;
      /**
       * Trial days to grant for this Checkout. 0 for a returning customer who
       * has already used the trial, or for an offer with no trial.
       */
      trialDays: number;
    }
  | { ok: false; status: number; error: string };

const DUPLICATE_ACCESS_STATES = new Set(["paid", "trialing", "payment_recovery"]);

/**
 * Whether new self-serve trial activation is currently allowed.
 *
 * Rollout control. When disabled, no new card-collected trial Checkout is
 * created, so activation can be paused without touching existing trials,
 * accepted terms, or the download route. Checkout is refused rather than
 * silently charged without a trial: an unexpected immediate charge is worse
 * than a clear "not available yet", and download stays available either way.
 */
export function trialActivationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BLOCKWISE_SELF_SERVE_TRIAL_ENABLED?.trim().toLowerCase() === "true";
}

export type TrialIneligibilityReason =
  | "trial_activation_paused"
  | "missing_workspace_facts"
  | "trial_already_consumed"
  | "subscription_exists";

export type TrialEligibility =
  | { eligible: true }
  | { eligible: false; reason: TrialIneligibilityReason };

/**
 * Explicit trial eligibility. Each rule is a named fact, so a reason can be
 * surfaced and tested. Never infer eligibility from "not the current offer
 * version": that cannot express cohort membership and changes meaning every
 * time a version is bumped.
 *
 * Ineligible does not mean refused. A returning customer may still subscribe;
 * they simply do not receive a second trial.
 */
export function evaluateTrialEligibility(input: {
  facts: CheckoutWorkspaceFacts | null;
  activationEnabled: boolean;
}): TrialEligibility {
  if (!input.activationEnabled) return { eligible: false, reason: "trial_activation_paused" };

  const facts = input.facts;
  if (!facts) return { eligible: false, reason: "missing_workspace_facts" };
  if (facts.trialConsumedAt) return { eligible: false, reason: "trial_already_consumed" };
  if (facts.stripeSubscriptionId) return { eligible: false, reason: "subscription_exists" };

  return { eligible: true };
}

const TRIAL_PAUSED_MESSAGE =
  "Starting a free trial is temporarily unavailable. You can still download your ad and run it in your own Meta ad account.";

/**
 * Single server-side authority for who may start Checkout and when, and how
 * many trial days that Checkout grants. Runs before any Stripe call so
 * unauthorized users, unconfirmed/unsupported markets, duplicate
 * subscriptions, and ungated managed purchases are rejected without
 * creating sessions.
 */
export function evaluateCheckoutRequest(input: {
  facts: CheckoutWorkspaceFacts | null;
  context: CheckoutRequestContext;
  activationEnabled?: boolean;
}): CheckoutDecision {
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
  if (context.product === "managed" && !facts.managedScopeApprovedAt) {
    return {
      ok: false,
      status: 403,
      error:
        "Managed needs a written scope approved with Blockwise before Checkout. Contact us to confirm scope.",
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

  const offer = getBillingOffer("AU", context.product);
  if (!offerRunsCheckoutTrial(offer)) {
    return { ok: true, trialDays: 0 };
  }

  // The self-serve offer is a card-collected trial, so it only runs when
  // activation is enabled. Paused means no new Checkout at all: granting a
  // trial would breach the rollout control, and charging immediately would be
  // an unexpected charge.
  const activationEnabled = input.activationEnabled ?? trialActivationEnabled();
  if (!activationEnabled) {
    return { ok: false, status: 503, error: TRIAL_PAUSED_MESSAGE };
  }

  // A returning customer who already used the trial subscribes without one
  // rather than being granted a second trial or refused outright.
  const eligibility = evaluateTrialEligibility({ facts, activationEnabled });
  return { ok: true, trialDays: eligibility.eligible ? offer.trialDays : 0 };
}
