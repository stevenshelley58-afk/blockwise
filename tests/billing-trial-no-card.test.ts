import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateCheckoutRequest } from "../src/lib/billing/checkout-policy.ts";
import {
  findReusableCheckoutSession,
  markCheckoutSession,
} from "../src/lib/billing/checkout-sessions.ts";
import { subscriptionRunsFullCheckoutTrial } from "../src/lib/billing/first-live-campaign.ts";
import {
  AD_STUDIO_CHECKOUT_TRIAL_VERSIONS,
  BILLING_OFFERS,
  getBillingOffer,
  offerRunsCheckoutTrial,
} from "../src/lib/billing/offers.ts";
import {
  buildCheckoutSessionRequest,
  validateStripePriceForOffer,
} from "../src/lib/billing/stripe-scaffold.ts";
import { reportIndicatesMetaDelivery } from "../src/lib/trial/first-delivery.ts";
import { loadTrialStatus } from "../src/lib/trial/trial-status.ts";

const migrationPath = "supabase/migrations/20260906010000_no_card_trial_delivery_start.sql";

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

// ---------------------------------------------------------------------------
// Migration contract: no-card trial starts on first Meta-reported delivery.
// ---------------------------------------------------------------------------

test("trial migration adds a server-controlled trial state machine anchored to delivery", () => {
  const sql = readMigration();

  assert.match(sql, /add column if not exists trial_state text not null default 'pending_delivery'/i);
  assert.match(sql, /check \(trial_state in \('pending_delivery', 'active'\)\)/i);
  assert.match(sql, /add column if not exists managed_scope_approved_at timestamptz/i);
  assert.match(sql, /create or replace function public\.start_trial_on_first_delivery/i);
  assert.match(sql, /p_delivery_at \+ interval '14 days'/i);
  assert.match(sql, /and w\.trial_state = 'pending_delivery'/i);
  // The transition is guarded to ad-studio trial-plan workspaces only.
  assert.match(sql, /wp\.key = 'trial'/i);
  assert.match(sql, /w\.mode = 'ad_studio'/i);
});

test("trial migration never starts the 14-day window at email verification", () => {
  const sql = readMigration();

  assert.doesNotMatch(sql, /interval '7 days'/i);
  // The pre-delivery wallet is a bounded setup window, explicitly pending.
  assert.match(sql, /interval '30 days'/i);
  assert.match(sql, /'phase', 'pending_delivery'/i);
});

test("trial migration records checkout sessions and protects managed-scope approval", () => {
  const sql = readMigration();

  assert.match(sql, /create table if not exists public\.billing_checkout_sessions/i);
  assert.match(sql, /status in \('open', 'completed', 'expired'\)/i);
  assert.match(sql, /unique \(workspace_id, offer_key, status\)|create index if not exists billing_checkout_sessions_workspace_status_idx/i);
  assert.match(sql, /new\.trial_state is distinct from old\.trial_state/i);
  assert.match(sql, /new\.managed_scope_approved_at is distinct from old\.managed_scope_approved_at/i);
  assert.match(sql, /grant execute on function public\.start_trial_on_first_delivery/i);
});

// ---------------------------------------------------------------------------
// Checkout policy: who may start Checkout, and when.
// ---------------------------------------------------------------------------

const okFacts = {
  countryConfirmedAt: "2026-09-06T00:00:00.000Z",
  countryCode: "AU",
  billingCurrency: "AUD",
  billingAccessState: "unbilled",
  stripeSubscriptionId: null,
  managedScopeApprovedAt: null,
  trialConsumedAt: null,
};

// Trial activation is a rollout control and is off unless explicitly enabled,
// so every trial-expecting case states the rollout state it is testing.
const trialOn = { activationEnabled: true } as const;

test("checkout requires an owner or admin", () => {
  for (const role of ["member", "viewer", "operator"]) {
    const decision = evaluateCheckoutRequest({
      facts: okFacts,
      context: { role, product: "ad_studio" },
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  }
  const owner = evaluateCheckoutRequest({
    facts: okFacts,
    context: { role: "owner", product: "ad_studio" },
    ...trialOn,
  });
  assert.equal(owner.ok, true);
  if (owner.ok) assert.equal(owner.trialDays, 7);
});

test("checkout rejects unconfirmed or unsupported billing markets", () => {
  const unconfirmed = evaluateCheckoutRequest({
    facts: { ...okFacts, countryConfirmedAt: null },
    context: { role: "owner", product: "ad_studio" },
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.status, 409);

  const usMarket = evaluateCheckoutRequest({
    facts: { ...okFacts, countryCode: "US", billingCurrency: "USD" },
    context: { role: "owner", product: "ad_studio" },
  });
  assert.equal(usMarket.ok, false);

  const currencyMismatch = evaluateCheckoutRequest({
    facts: { ...okFacts, billingCurrency: "USD" },
    context: { role: "owner", product: "ad_studio" },
  });
  assert.equal(currencyMismatch.ok, false);
});

test("managed checkout is blocked server-side without recorded written-scope approval", () => {
  const blocked = evaluateCheckoutRequest({
    facts: okFacts,
    context: { role: "owner", product: "managed" },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 403);

  const approved = evaluateCheckoutRequest({
    facts: { ...okFacts, managedScopeApprovedAt: "2026-09-06T00:00:00.000Z" },
    context: { role: "owner", product: "managed" },
  });
  assert.equal(approved.ok, true);
});

test("checkout prevents duplicate subscriptions for paid, trialing, or recovering workspaces", () => {
  for (const state of ["paid", "trialing", "payment_recovery"]) {
    const decision = evaluateCheckoutRequest({
      facts: { ...okFacts, billingAccessState: state },
      context: { role: "owner", product: "ad_studio" },
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 409);
  }

  const liveSubscription = evaluateCheckoutRequest({
    facts: { ...okFacts, stripeSubscriptionId: "sub_123", billingAccessState: null },
    context: { role: "owner", product: "ad_studio" },
  });
  assert.equal(liveSubscription.ok, false);

  // A fully canceled subscription may resubscribe, but never receives a
  // second trial: the trial is a one-per-workspace cohort, not a per-attempt
  // grant that reopens with Checkout.
  const resubscribe = evaluateCheckoutRequest({
    facts: { ...okFacts, stripeSubscriptionId: "sub_123", billingAccessState: "canceled" },
    context: { role: "owner", product: "ad_studio" },
    ...trialOn,
  });
  assert.equal(resubscribe.ok, true);
  if (resubscribe.ok) assert.equal(resubscribe.trialDays, 0);
});

test("trial activation is paused unless the rollout control is enabled", () => {
  const paused = evaluateCheckoutRequest({
    facts: okFacts,
    context: { role: "owner", product: "ad_studio" },
    activationEnabled: false,
  });
  assert.equal(paused.ok, false);
  if (!paused.ok) assert.equal(paused.status, 503);

  // Managed service is not part of the self-serve trial rollout and is
  // unaffected by the control.
  const managed = evaluateCheckoutRequest({
    facts: { ...okFacts, managedScopeApprovedAt: "2026-09-06T00:00:00.000Z" },
    context: { role: "owner", product: "managed" },
    activationEnabled: false,
  });
  assert.equal(managed.ok, true);
  if (managed.ok) assert.equal(managed.trialDays, 0);
});

test("a workspace that already consumed a trial subscribes without a second one", () => {
  const returning = evaluateCheckoutRequest({
    facts: { ...okFacts, trialConsumedAt: "2026-09-01T00:00:00.000Z" },
    context: { role: "owner", product: "ad_studio" },
    ...trialOn,
  });
  assert.equal(returning.ok, true);
  if (returning.ok) assert.equal(returning.trialDays, 0);
});

// ---------------------------------------------------------------------------
// Configured Stripe price must match the approved offer exactly.
// ---------------------------------------------------------------------------

const billingEnv = {
  ...process.env,
  STRIPE_AD_STUDIO_AUD_PRICE_ID: "price_self_au",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
} as NodeJS.ProcessEnv;

function pricePayload(overrides: Record<string, unknown>) {
  return {
    id: "price_self_au",
    active: true,
    currency: "aud",
    unit_amount: 24_900,
    type: "recurring",
    recurring: { interval: "month" },
    ...overrides,
  };
}

async function withFetch(payload: unknown, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("the configured Stripe price is validated for amount, currency, interval, and active status", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
  // The real approved offer, so the guard cannot drift from shipping terms.
  const offer = getBillingOffer("AU", "ad_studio");
  await withFetch(pricePayload({}), async () => {
    await assert.doesNotReject(() => validateStripePriceForOffer(offer, billingEnv));
  });

  for (const overrides of [
    { active: false },
    { unit_amount: 99_00 },
    { currency: "usd" },
    { recurring: { interval: "year" } },
    { type: "one_time", recurring: null },
  ]) {
    await withFetch(pricePayload(overrides), async () => {
      await assert.rejects(() => validateStripePriceForOffer(offer, billingEnv));
    });
  }
});

// ---------------------------------------------------------------------------
// Open Checkout session reuse: retries never create competing sessions.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeService(rows: Row[], capture?: { filters?: Record<string, unknown> }) {
  function builder() {
    const chain: Record<string, unknown> = {
      select: () => builder(),
      eq: (column: string, value: unknown) => {
        if (capture) capture.filters = { ...(capture.filters ?? {}), [column]: value };
        return builder();
      },
      gt: () => builder(),
      order: () => builder(),
      limit: () => builder(),
      update: () => builder(),
      then: (resolve: (value: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return chain;
  }
  return { from: () => builder() } as unknown as Parameters<typeof findReusableCheckoutSession>[0];
}

test("only an open, unexpired checkout session is reused", async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const reusable = await findReusableCheckoutSession(
    fakeService([{ stripe_checkout_session_id: "cs_open", url: "https://checkout.stripe.com/open", expires_at: future }]),
    "workspace-1",
    "ad_studio_AU",
  );
  assert.equal(reusable?.sessionId, "cs_open");

  const none = await findReusableCheckoutSession(fakeService([]), "workspace-1", "ad_studio_AU");
  assert.equal(none, null);
});

test("completed and expired sessions are re-marked only from open status", async () => {
  const captured: { values?: Row; filters?: Record<string, unknown> } = {};
  function captureBuilder() {
    const chain: Record<string, unknown> = {
      update: (values: Row) => {
        captured.values = values;
        return captureBuilder();
      },
      eq: (column: string, value: unknown) => {
        captured.filters = { ...(captured.filters ?? {}), [column]: value };
        return captureBuilder();
      },
      then: (resolve: (value: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    };
    return chain;
  }
  await markCheckoutSession(
    { from: () => captureBuilder() } as unknown as Parameters<typeof markCheckoutSession>[0],
    "cs_open",
    "expired",
  );
  assert.equal(captured.values?.status, "expired");
  assert.equal(captured.filters?.stripe_checkout_session_id, "cs_open");
  assert.equal(captured.filters?.status, "open");
});

// ---------------------------------------------------------------------------
// Meta-reported delivery predicate.
// ---------------------------------------------------------------------------

test("only live Meta data with real impressions indicates delivery", () => {
  assert.equal(
    reportIndicatesMetaDelivery({ source: "live", connected: true, summary: { impressions: 12 } }),
    true,
  );
  assert.equal(
    reportIndicatesMetaDelivery({ source: "live", connected: true, summary: { impressions: 0 } }),
    false,
  );
  assert.equal(
    reportIndicatesMetaDelivery({ source: "demo", connected: true, summary: { impressions: 500 } }),
    false,
  );
  assert.equal(
    reportIndicatesMetaDelivery({ source: "live", connected: false, summary: { impressions: 10 } }),
    false,
  );
  assert.equal(reportIndicatesMetaDelivery({ source: "live", connected: true, summary: null }), false);
});

// ---------------------------------------------------------------------------
// Trial status exposes the delivery-anchored state machine.
// ---------------------------------------------------------------------------

test("trial status passes through the pending-delivery state", async () => {
  const row = {
    plan_key: "trial",
    trial_state: "pending_delivery",
    trial_ends_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    credits_granted: 6,
    credits_consumed: 0,
    credits_reserved: 0,
    credits_expired: 0,
    ad_packs_used: 0,
    ad_packs_limit: 3,
    ad_packs_remaining: 3,
  };
  const status = await loadTrialStatus(
    (() => Promise.resolve({ data: row, error: null })) as unknown as Parameters<typeof loadTrialStatus>[0],
    "workspace-1",
  );
  assert.equal(status?.trialState, "pending_delivery");
  assert.equal(status?.trialExpired, false);
});

// ---------------------------------------------------------------------------
// Self-serve offer contract: 7-day card-collected trial, zero trial-start
// invoice, renewal at the approved price.
// ---------------------------------------------------------------------------

test("the self-serve offer is a 7-day card-collected trial that renews at the approved price", () => {
  const offer = BILLING_OFFERS.ad_studio_AU;

  assert.equal(offer.trialDays, 7);
  assert.equal(offer.trialStart, "stripe_checkout_trial");
  assert.equal(offerRunsCheckoutTrial(offer), true);
  // Zero due at trial start; the paid renewal is unchanged.
  assert.equal(offer.firstInvoiceAmount, 0);
  assert.equal(offer.recurringAmount, 24_900);
  assert.equal(offer.currency, "AUD");
  assert.equal(offer.taxBehavior, "inclusive");

  // Renewal terms must be visible at the point of consent.
  assert.match(offer.checkoutDisclosure, /renews automatically/i);
  assert.match(offer.checkoutDisclosure, /A\$249 per month/i);
  assert.match(offer.checkoutDisclosure, /Cancel any time/i);
  assert.match(offer.checkoutDisclosure, /Meta ad spend is separate/i);
});

test("self-serve copy never advertises a no-card trial", () => {
  const offer = BILLING_OFFERS.ad_studio_AU;
  for (const copy of [offer.triggeringRule, offer.checkoutDisclosure, offer.checkoutDisclosureNoTrial]) {
    assert.doesNotMatch(copy, /never requires a card/i);
    assert.doesNotMatch(copy, /no[- ]card trial/i);
  }
  // Download legitimately needs no card, and must stay stated.
  assert.match(offer.triggeringRule, /download/i);
});

test("the trial cohort is explicit and covers the current offer version", () => {
  assert.ok(
    AD_STUDIO_CHECKOUT_TRIAL_VERSIONS.includes(BILLING_OFFERS.ad_studio_AU.version),
    "bumping the ad studio offer version must be paired with a deliberate cohort decision",
  );
  // Legacy card-on-file trial cohorts, and the no-trial version that replaced them.
  assert.equal(AD_STUDIO_CHECKOUT_TRIAL_VERSIONS.includes("2026-07-27"), true);
  assert.equal(AD_STUDIO_CHECKOUT_TRIAL_VERSIONS.includes("2026-07-30"), true);
  assert.equal(AD_STUDIO_CHECKOUT_TRIAL_VERSIONS.includes("2026-09-06"), false);
  // Managed service never runs a Checkout trial.
  assert.equal(offerRunsCheckoutTrial(BILLING_OFFERS.managed_AU), false);
});

// ---------------------------------------------------------------------------
// Checkout request building: the trial is requested, and never invented.
// ---------------------------------------------------------------------------

function checkoutInput(
  overrides: Partial<Parameters<typeof buildCheckoutSessionRequest>[0]> = {},
): Parameters<typeof buildCheckoutSessionRequest>[0] {
  return {
    workspaceId: "workspace-1",
    market: "AU",
    currency: "AUD",
    product: "ad_studio",
    customerEmail: "owner@example.com",
    successUrl: "https://blockwise.sale/settings?billing=success",
    cancelUrl: "https://blockwise.sale/settings",
    ...overrides,
  };
}

test("Checkout requests a full 7-day trial with a zero trial-start invoice", () => {
  const { params } = buildCheckoutSessionRequest(checkoutInput(), billingEnv);

  assert.equal(params["subscription_data[trial_period_days]"], 7);
  assert.equal(
    params["subscription_data[trial_settings][end_behavior][missing_payment_method]"],
    "cancel",
  );
  assert.equal(params["metadata[trial_days]"], 7);
  assert.equal(params["metadata[first_invoice_amount]"], 0);
  assert.equal(params["metadata[renewal_amount]"], 24_900);
  // A card is always collected, and consent text describes the real terms.
  assert.equal(params["payment_method_collection"], "always");
  assert.equal(params["custom_text[submit][message]"], BILLING_OFFERS.ad_studio_AU.checkoutDisclosure);
});

test("Checkout requires Stripe terms-of-service consent by default", () => {
  const { params } = buildCheckoutSessionRequest(checkoutInput(), billingEnv);

  // Mastercard requires the terms to be accepted on the payment page, so the
  // Stripe checkbox is on unless an environment explicitly opts out.
  assert.equal(params["consent_collection[terms_of_service]"], "required");
});

test("Checkout can drop the Stripe terms checkbox only when told to", () => {
  const { params } = buildCheckoutSessionRequest(checkoutInput(), {
    ...billingEnv,
    BLOCKWISE_STRIPE_TOS_CONSENT: "off",
  });

  // Stripe rejects session creation outright when the account has no terms URL,
  // so the isolated test stack has to be able to turn the checkbox off. The
  // review screen records its own acceptance in that case.
  assert.equal(params["consent_collection[terms_of_service]"], undefined);
});

test("a non-trial Checkout charges at Checkout and discloses no trial", () => {
  const { params } = buildCheckoutSessionRequest(checkoutInput({ trialDays: 0 }), billingEnv);

  assert.equal(params["subscription_data[trial_period_days]"], undefined);
  assert.equal(params["metadata[trial_days]"], 0);
  assert.equal(params["metadata[first_invoice_amount]"], 24_900);
  assert.equal(
    params["custom_text[submit][message]"],
    BILLING_OFFERS.ad_studio_AU.checkoutDisclosureNoTrial,
  );
});

// ---------------------------------------------------------------------------
// Legacy hook containment: publishing must not end a new-cohort trial early.
// ---------------------------------------------------------------------------

test("first publish cannot end a new-cohort trial early", () => {
  const newCohort = {
    id: "sub_new",
    status: "trialing",
    metadata: { offer_key: "ad_studio_AU", offer_version: BILLING_OFFERS.ad_studio_AU.version },
  };
  assert.equal(subscriptionRunsFullCheckoutTrial(newCohort), true);

  // The version that replaced the legacy trial is not a trial cohort.
  const legacyNoTrial = {
    id: "sub_legacy",
    status: "trialing",
    metadata: { offer_key: "ad_studio_AU", offer_version: "2026-09-06" },
  };
  assert.equal(subscriptionRunsFullCheckoutTrial(legacyNoTrial), false);

  // Managed service is never in the self-serve trial cohort.
  const managed = { id: "sub_managed", status: "trialing", metadata: { offer_key: "managed_AU" } };
  assert.equal(subscriptionRunsFullCheckoutTrial(managed), false);

  // An unknown version must not be treated as a trial cohort.
  assert.equal(subscriptionRunsFullCheckoutTrial({ id: "sub_unknown" }), false);
});
