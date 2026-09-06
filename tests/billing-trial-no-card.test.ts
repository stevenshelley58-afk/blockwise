import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateCheckoutRequest } from "../src/lib/billing/checkout-policy.ts";
import {
  findReusableCheckoutSession,
  markCheckoutSession,
} from "../src/lib/billing/checkout-sessions.ts";
import { validateStripePriceForOffer } from "../src/lib/billing/stripe-scaffold.ts";
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
  // The transition is guarded to self-serve trial-plan workspaces only.
  assert.match(sql, /wp\.key = 'trial'/i);
  assert.match(sql, /w\.mode = 'self_serve'/i);
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
};

test("checkout requires an owner or admin", () => {
  for (const role of ["member", "viewer", "operator"]) {
    const decision = evaluateCheckoutRequest({
      facts: okFacts,
      context: { role, product: "self_serve" },
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  }
  const owner = evaluateCheckoutRequest({
    facts: okFacts,
    context: { role: "owner", product: "self_serve" },
  });
  assert.equal(owner.ok, true);
});

test("checkout rejects unconfirmed or unsupported billing markets", () => {
  const unconfirmed = evaluateCheckoutRequest({
    facts: { ...okFacts, countryConfirmedAt: null },
    context: { role: "owner", product: "self_serve" },
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.status, 409);

  const usMarket = evaluateCheckoutRequest({
    facts: { ...okFacts, countryCode: "US", billingCurrency: "USD" },
    context: { role: "owner", product: "self_serve" },
  });
  assert.equal(usMarket.ok, false);

  const currencyMismatch = evaluateCheckoutRequest({
    facts: { ...okFacts, billingCurrency: "USD" },
    context: { role: "owner", product: "self_serve" },
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
      context: { role: "owner", product: "self_serve" },
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 409);
  }

  const liveSubscription = evaluateCheckoutRequest({
    facts: { ...okFacts, stripeSubscriptionId: "sub_123", billingAccessState: null },
    context: { role: "owner", product: "self_serve" },
  });
  assert.equal(liveSubscription.ok, false);

  // A fully canceled subscription may resubscribe.
  const resubscribe = evaluateCheckoutRequest({
    facts: { ...okFacts, stripeSubscriptionId: "sub_123", billingAccessState: "canceled" },
    context: { role: "owner", product: "self_serve" },
  });
  assert.equal(resubscribe.ok, true);
});

// ---------------------------------------------------------------------------
// Configured Stripe price must match the approved offer exactly.
// ---------------------------------------------------------------------------

const billingEnv = {
  ...process.env,
  STRIPE_SELF_SERVE_AUD_PRICE_ID: "price_self_au",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
} as NodeJS.ProcessEnv;

function pricePayload(overrides: Record<string, unknown>) {
  return {
    id: "price_self_au",
    active: true,
    currency: "aud",
    unit_amount: 24_900,
    type: "subscription",
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
  await withFetch(pricePayload({}), async () => {
    await assert.doesNotReject(() =>
      validateStripePriceForOffer(
        {
          key: "self_serve_AU",
          version: "2026-09-06",
          market: "AU",
          currency: "AUD",
          product: "self_serve",
          recurringAmount: 24_900,
          firstInvoiceAmount: 24_900,
          trialDays: 0,
          taxBehavior: "inclusive",
          priceEnvKey: "STRIPE_SELF_SERVE_AUD_PRICE_ID",
          triggeringRule: "trigger",
          checkoutDisclosure: "disclosure",
        },
        billingEnv,
      ),
    );
  });

  for (const overrides of [
    { active: false },
    { unit_amount: 99_00 },
    { currency: "usd" },
    { recurring: { interval: "year" } },
    { type: "one_off", recurring: null },
  ]) {
    await withFetch(pricePayload(overrides), async () => {
      await assert.rejects(() =>
        validateStripePriceForOffer(
          {
            key: "self_serve_AU",
            version: "2026-09-06",
            market: "AU",
            currency: "AUD",
            product: "self_serve",
            recurringAmount: 24_900,
            firstInvoiceAmount: 24_900,
            trialDays: 0,
            taxBehavior: "inclusive",
            priceEnvKey: "STRIPE_SELF_SERVE_AUD_PRICE_ID",
            triggeringRule: "trigger",
            checkoutDisclosure: "disclosure",
          },
          billingEnv,
        ),
      );
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
    "self_serve_AU",
  );
  assert.equal(reusable?.sessionId, "cs_open");

  const none = await findReusableCheckoutSession(fakeService([]), "workspace-1", "self_serve_AU");
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
