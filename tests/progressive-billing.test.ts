import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyStripeBillingEvent,
  reconciliationEventForSubscription,
} from "../src/lib/billing/billing-domain.ts";
import {
  AD_STUDIO_TRIAL_OFFER_VERSION,
  BILLING_OFFER_VERSION,
  BILLING_OFFERS,
  currencyForMarket,
} from "../src/lib/billing/offers.ts";
import {
  buildCheckoutSessionRequest,
  constructStripeWebhookEvent,
  StripeWebhookVerificationError,
  type StripeWebhookEvent,
} from "../src/lib/billing/stripe-scaffold.ts";

const billingEnv: NodeJS.ProcessEnv = {
  ...process.env,
  STRIPE_AD_STUDIO_AUD_PRICE_ID: "price_self_au",
  STRIPE_MANAGED_AUD_PRICE_ID: "price_managed_au",
} as NodeJS.ProcessEnv;

test("offer catalog encodes the approved A$ amounts and tax behavior (Australia only)", () => {
  // The self-serve offer is a card-collected 7-day trial: nothing is due at
  // trial start, and the paid renewal is the approved A$249.
  assert.equal(BILLING_OFFERS.ad_studio_AU.firstInvoiceAmount, 0);
  assert.equal(BILLING_OFFERS.ad_studio_AU.recurringAmount, 24_900);
  assert.equal(BILLING_OFFERS.ad_studio_AU.trialDays, 7);
  assert.equal(BILLING_OFFERS.ad_studio_AU.trialStart, "stripe_checkout_trial");
  assert.equal(BILLING_OFFERS.ad_studio_AU.taxBehavior, "inclusive");
  assert.equal(BILLING_OFFERS.managed_AU.recurringAmount, 150_000);
  assert.equal(BILLING_OFFERS.managed_AU.firstInvoiceAmount, 150_000);
  assert.equal(BILLING_OFFERS.managed_AU.trialDays, 0);
  assert.equal(BILLING_OFFERS.managed_AU.trialStart, "none");
  assert.equal(currencyForMarket("AU"), "AUD");
});

test("ad-studio Checkout starts a 7-day trial with a zero trial-start invoice", () => {
  const result = buildCheckoutSessionRequest(
    {
      workspaceId: "workspace-1",
      market: "AU",
      currency: "AUD",
      product: "ad_studio",
      stripeCustomerId: "cus_123",
      customerEmail: "owner@example.com",
      userId: "user-1",
      successUrl: "https://blockwise.sale/settings?billing=success",
      cancelUrl: "https://blockwise.sale/settings",
      acceptedAt: "2026-09-15T00:00:00.000Z",
    },
    billingEnv,
  );

  assert.equal(result.params["line_items[0][price]"], "price_self_au");
  assert.equal(result.params["discounts[0][coupon]"], undefined);
  // The trial is Stripe's, not an intro coupon or a discount.
  assert.equal(result.params["subscription_data[trial_period_days]"], 7);
  assert.equal(result.params.payment_method_collection, "always");
  assert.equal(result.params.billing_address_collection, "required");
  assert.equal(result.params["automatic_tax[enabled]"], true);
  assert.equal(result.params["tax_id_collection[enabled]"], true);
  assert.equal(result.params["consent_collection[terms_of_service]"], "required");
  assert.equal(result.params["metadata[offer_version]"], AD_STUDIO_TRIAL_OFFER_VERSION);
  assert.equal(result.params["metadata[trial_days]"], 7);
  assert.equal(result.params["metadata[first_invoice_amount]"], 0);
  assert.equal(result.params["metadata[renewal_amount]"], 24_900);
  // The triggering rule must state the card requirement, never a no-card trial.
  assert.match(String(result.params["metadata[triggering_rule]"]), /needs a card/);
  assert.doesNotMatch(String(result.params["metadata[triggering_rule]"]), /never requires a card/);
  assert.equal(result.params["customer_update[address]"], "auto");
});

test("managed Checkout uses the regional managed recurring price without a trial or intro coupon", () => {
  const result = buildCheckoutSessionRequest(
    {
      workspaceId: "workspace-2",
      market: "AU",
      currency: "AUD",
      product: "managed",
      customerEmail: "managed@example.com",
      successUrl: "https://blockwise.sale/settings?billing=success",
      cancelUrl: "https://blockwise.sale/settings",
      acceptedAt: "2026-07-27T00:00:00.000Z",
    },
    billingEnv,
  );

  assert.equal(result.params["line_items[0][price]"], "price_managed_au");
  assert.equal(result.params["discounts[0][coupon]"], undefined);
  assert.equal(result.params["subscription_data[trial_period_days]"], undefined);
  assert.equal(result.params["metadata[first_invoice_amount]"], 150_000);
  assert.match(String(result.params["custom_text[submit][message]"]), /Meta ad spend is separate/);
  assert.equal(result.params["managed_payments[enabled]"], false);
});

test("Checkout refuses a currency that does not match the confirmed workspace market", () => {
  assert.throws(
    () =>
      buildCheckoutSessionRequest(
        {
          workspaceId: "workspace-3",
          market: "AU",
          currency: "USD" as never,
          product: "ad_studio",
          customerEmail: null,
          successUrl: "https://blockwise.sale/settings",
          cancelUrl: "https://blockwise.sale/settings",
        },
        billingEnv,
      ),
    /does not match market/,
  );
});

test("Stripe webhook signatures are verified before payloads are accepted", () => {
  const secret = "whsec_test";
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    id: "evt_signature",
    type: "invoice.paid",
    data: { object: { id: "in_123" } },
  });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  assert.equal(constructStripeWebhookEvent(payload, `t=${timestamp},v1=${signature}`, secret).id, "evt_signature");
  assert.throws(
    () => constructStripeWebhookEvent(payload, `t=${timestamp},v1=deadbeef`, secret),
    StripeWebhookVerificationError,
  );
});

test("billing domain applies a Checkout event once and records its accepted offer", async () => {
  const mock = createBillingMock();
  const event = checkoutEvent("evt_checkout");

  const first = await applyStripeBillingEvent(mock.client as never, event);
  const replay = await applyStripeBillingEvent(mock.client as never, event);

  assert.equal(first.outcome, "applied");
  assert.equal(replay.outcome, "duplicate");
  assert.equal(mock.workspaceUpdates.length, 1);
  // The no-trial offer version grants no billing trial here: the subscription
  // events decide access.
  assert.equal("billing_access_state" in mock.workspaceUpdates[0].patch, false);
  assert.equal(mock.acceptances.length, 1);
  assert.equal(mock.acceptances[0].offer_version, BILLING_OFFER_VERSION);
  assert.equal(mock.eventStatuses.get("evt_checkout"), "applied");
});

test("a new-cohort Checkout event marks the workspace trialing from its offer cohort", async () => {
  const mock = createBillingMock();
  const event = checkoutEvent("evt_checkout_trial", AD_STUDIO_TRIAL_OFFER_VERSION);

  await applyStripeBillingEvent(mock.client as never, event);

  assert.equal(mock.workspaceUpdates[0].patch.billing_access_state, "trialing");
  assert.equal(mock.workspaceUpdates[0].patch.stripe_subscription_status, "trialing");
  assert.equal(mock.workspaceUpdates[0].patch.billing_offer_version, AD_STUDIO_TRIAL_OFFER_VERSION);
});

test("an unknown offer version is not treated as a trial cohort", async () => {
  const mock = createBillingMock();
  const event = checkoutEvent("evt_checkout_unknown", "2099-01-01");

  await applyStripeBillingEvent(mock.client as never, event);

  assert.equal("billing_access_state" in mock.workspaceUpdates[0].patch, false);
});

test("legacy ad-studio Checkout events still mark the workspace as trialing", async () => {
  const mock = createBillingMock();
  const event = checkoutEvent("evt_checkout_legacy", "2026-07-27");

  await applyStripeBillingEvent(mock.client as never, event);

  assert.equal(mock.workspaceUpdates[0].patch.billing_access_state, "trialing");
  assert.equal(mock.workspaceUpdates[0].patch.stripe_subscription_status, "trialing");
});

test("subscription and invoice events derive cancellation timing and payment recovery from Stripe", async () => {
  const mock = createBillingMock();
  const subscription: StripeWebhookEvent = {
    id: "evt_subscription",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        cancel_at_period_end: true,
        items: {
          data: [{ current_period_start: 1_785_100_000, current_period_end: 1_787_779_200 }],
        },
        latest_invoice: { id: "in_123", status: "paid" },
        metadata: { workspace_id: "workspace-1" },
      },
    },
  };
  const failedInvoice: StripeWebhookEvent = {
    id: "evt_failed_invoice",
    type: "invoice.payment_failed",
    data: { object: { id: "in_124", subscription: "sub_123", customer: "cus_123" } },
  };

  await applyStripeBillingEvent(mock.client as never, subscription);
  await applyStripeBillingEvent(mock.client as never, failedInvoice);

  assert.equal(mock.workspaceUpdates[0].patch.billing_access_state, "paid");
  assert.equal(mock.workspaceUpdates[0].patch.stripe_cancel_at_period_end, true);
  assert.match(String(mock.workspaceUpdates[0].patch.stripe_current_period_end), /^2026-/);
  assert.equal(mock.workspaceUpdates[1].patch.billing_access_state, "payment_recovery");
  assert.equal(mock.workspaceUpdates[1].patch.billing_payment_recovery_required, true);
});

test("billing transitions write each Mautic stage once and do not repeat paid on renewal", async () => {
  const stageCalls: Array<Record<string, unknown>> = [];
  const stageSetter = async (input: Record<string, unknown>) => {
    stageCalls.push(input);
    return { id: `job-${stageCalls.length}` };
  };
  const paid = createBillingMock({
    billingContact: { subscriptionStatus: "trialing" },
  });

  await applyStripeBillingEvent(paid.client as never, subscriptionEvent({
    id: "evt_first_active",
    created: 100,
    status: "active",
  }), { stageSetter: stageSetter as never });
  await applyStripeBillingEvent(paid.client as never, subscriptionEvent({
    id: "evt_renewal_active",
    created: 200,
    status: "active",
  }), { stageSetter: stageSetter as never });

  assert.equal(stageCalls.filter((call) => call.stage === "paid").length, 1);
  assert.deepEqual(stageCalls[0], {
    email: "owner@example.com",
    workspaceId: "workspace-1",
    subjectId: "sub_123",
    stage: "paid",
    periodEnd: new Date("2026-08-26T21:20:00.000Z"),
    plan: "Ad studio",
    amount: "A$249 per month",
    timeZone: "Australia/Perth",
    guard: {
      kind: "billing_transition",
      eventId: "evt_first_active",
      eventCreated: 100,
      expectedSubscriptionId: "sub_123",
      expectedSubscriptionStatus: "active",
      expectedCancelAtPeriodEnd: false,
    },
  });

  const endedCalls: Array<Record<string, unknown>> = [];
  const ended = createBillingMock({ billingContact: { subscriptionStatus: "trialing" } });
  await applyStripeBillingEvent(ended.client as never, subscriptionEvent({
    id: "evt_trial_ended",
    created: 100,
    status: "past_due",
  }), { stageSetter: (async (input: Record<string, unknown>) => {
    endedCalls.push(input);
    return { id: "job-ended" };
  }) as never });
  assert.equal(endedCalls.length, 1);
  assert.equal(endedCalls[0].stage, "trial_ended");

  const failedCalls: Array<Record<string, unknown>> = [];
  const failed = createBillingMock({ billingContact: { subscriptionStatus: "active" } });
  await applyStripeBillingEvent(failed.client as never, {
    id: "evt_payment_failed_stage",
    type: "invoice.payment_failed",
    created: 100,
    data: {
      object: {
        id: "in_failed_stage",
        subscription: "sub_123",
        lines: { data: [{ period: { start: 1_785_100_000, end: 1_787_779_200 } }] },
      },
    },
  }, { stageSetter: (async (input: Record<string, unknown>) => {
    failedCalls.push(input);
    return { id: "job-failed" };
  }) as never });
  assert.equal(failedCalls.length, 1);
  assert.equal(failedCalls[0].stage, "payment_failed");

  const cancelledCalls: Array<Record<string, unknown>> = [];
  const cancelled = createBillingMock({ billingContact: { subscriptionStatus: "active" } });
  const captureCancellation = (async (input: Record<string, unknown>) => {
    cancelledCalls.push(input);
    return { id: "job-cancelled" };
  }) as never;
  await applyStripeBillingEvent(cancelled.client as never, subscriptionEvent({
    id: "evt_cancel_at_end",
    created: 100,
    status: "active",
    cancelAtPeriodEnd: true,
  }), { stageSetter: captureCancellation });
  await applyStripeBillingEvent(cancelled.client as never, subscriptionEvent({
    id: "evt_deleted_after_cancel",
    created: 200,
    status: "canceled",
    type: "customer.subscription.deleted",
  }), { stageSetter: captureCancellation });
  assert.equal(cancelledCalls.length, 1);
  assert.equal(cancelledCalls[0].stage, "cancelled");

  const deletedCalls: Array<Record<string, unknown>> = [];
  const deleted = createBillingMock({ billingContact: { subscriptionStatus: "active" } });
  await applyStripeBillingEvent(deleted.client as never, subscriptionEvent({
    id: "evt_deleted_without_advance_notice",
    created: 100,
    status: "canceled",
    type: "customer.subscription.deleted",
  }), { stageSetter: (async (input: Record<string, unknown>) => {
    deletedCalls.push(input);
    return { id: "job-deleted" };
  }) as never });
  assert.equal(deletedCalls.length, 1);
  assert.equal(deletedCalls[0].stage, "cancelled");
});

test("a failed billing-stage enqueue leaves the transition retryable", async () => {
  const mock = createBillingMock({ billingContact: { subscriptionStatus: "trialing" } });
  const event = subscriptionEvent({ id: "evt_retry_paid_stage", created: 100, status: "active" });
  let attempts = 0;
  const stageSetter = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("queue unavailable");
    return { id: "mautic-job-1" };
  };

  await assert.rejects(
    applyStripeBillingEvent(mock.client as never, event, { stageSetter: stageSetter as never }),
    /queue unavailable/,
  );
  assert.equal(mock.workspaceUpdates.length, 0);
  assert.equal(mock.eventStatuses.get(event.id), "failed");

  const retried = await applyStripeBillingEvent(mock.client as never, event, { stageSetter: stageSetter as never });
  assert.equal(retried.outcome, "applied");
  assert.equal(mock.workspaceUpdates.length, 1);
  assert.equal(attempts, 2);
});

test("recovering an existing subscription does not announce paid again", async () => {
  const mock = createBillingMock({ billingContact: { subscriptionStatus: "past_due" } });
  let stageCalls = 0;
  await applyStripeBillingEvent(
    mock.client as never,
    subscriptionEvent({ id: "evt_recovered_active", created: 100, status: "active" }),
    {
      stageSetter: (async () => {
        stageCalls += 1;
        return { id: "unexpected" };
      }) as never,
    },
  );
  assert.equal(stageCalls, 0);
});

test("authoritative paid subscription invoices grant one 100-credit period wallet idempotently", async () => {
  const mock = createBillingMock();
  const paidInvoice: StripeWebhookEvent = {
    id: "evt_paid_invoice",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_paid_123",
        subscription: "sub_123",
        customer: "cus_123",
        amount_paid: 9_900,
        billing_reason: "subscription_create",
        lines: {
          data: [{ period: { start: 1_785_100_000, end: 1_787_779_200 } }],
        },
      },
    },
  };

  const first = await applyStripeBillingEvent(mock.client as never, paidInvoice);
  const replay = await applyStripeBillingEvent(mock.client as never, paidInvoice);

  assert.equal(first.outcome, "applied");
  assert.equal(replay.outcome, "duplicate");
  assert.equal(mock.creditGrants.length, 1);
  assert.equal(mock.creditGrants[0].p_credits, 100);
  assert.equal(mock.creditGrants[0].p_invoice_id, "in_paid_123");
  assert.equal(mock.creditGrants[0].p_subscription_id, "sub_123");
  assert.equal(mock.creditGrants[0].p_period_start, "2026-07-26T21:06:40.000Z");
});

test("an invoice paid before local subscription identity resolves through retrieved subscription metadata", async () => {
  const mock = createBillingMock();
  const result = await applyStripeBillingEvent(mock.client as never, {
    id: "evt_paid_before_subscription",
    type: "invoice.paid",
    created: 1_785_100_100,
    data: {
      object: {
        id: "in_paid_before_subscription",
        subscription: {
          id: "sub_new",
          metadata: { workspace_id: "workspace-1" },
        },
        amount_paid: 9_900,
        billing_reason: "subscription_create",
        lines: {
          data: [{ period: { start: 1_785_100_000, end: 1_787_779_200 } }],
        },
      },
    },
  });

  assert.equal(result.outcome, "applied");
  assert.equal(mock.workspaceUpdates[0].column, "id");
  assert.equal(mock.workspaceUpdates[0].value, "workspace-1");
  assert.equal(mock.creditGrants.length, 1);
});

test("an unresolved paid invoice stays retryable instead of being acknowledged as ignored", async () => {
  const mock = createBillingMock({ workspaceFound: false });
  const event: StripeWebhookEvent = {
    id: "evt_unresolved_paid_invoice",
    type: "invoice.paid",
    created: 1_785_100_100,
    data: {
      object: {
        id: "in_unresolved",
        subscription: "sub_unresolved",
        amount_paid: 9_900,
        billing_reason: "subscription_create",
        lines: {
          data: [{ period: { start: 1_785_100_000, end: 1_787_779_200 } }],
        },
      },
    },
  };

  await assert.rejects(() => applyStripeBillingEvent(mock.client as never, event), /could not yet be linked/);
  assert.equal(mock.eventStatuses.get(event.id), "failed");
  await assert.rejects(() => applyStripeBillingEvent(mock.client as never, event), /could not yet be linked/);
  assert.equal(mock.claimAttempts.get(event.id), 2);
  assert.equal(mock.creditGrants.length, 0);
});

test("full refunds and disputes suspend new paid access pending reconciliation", async () => {
  const mock = createBillingMock();
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_refund",
    type: "charge.refunded",
    data: {
      object: { id: "ch_123", customer: "cus_123", amount: 9_900, amount_refunded: 9_900, refunded: true },
    },
  });
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_dispute",
    type: "charge.dispute.created",
    data: { object: { id: "dp_123", charge: { id: "ch_123", customer: "cus_123" } } },
  });

  assert.equal(mock.workspaceUpdates[0].patch.billing_access_state, "refunded");
  assert.equal(mock.workspaceUpdates[0].patch.billing_reconciliation_required, true);
  assert.equal(mock.workspaceUpdates[1].patch.billing_access_state, "disputed");
});

test("refund risk remains latched across newer active subscription reconciliation until a paid invoice recovers it", async () => {
  const mock = createBillingMock();
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_refund_latch",
    type: "charge.refunded",
    created: 200,
    data: {
      object: { id: "ch_latch", customer: "cus_123", amount: 9_900, amount_refunded: 9_900, refunded: true },
    },
  });
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_active_after_refund",
    type: "customer.subscription.updated",
    created: 300,
    data: {
      object: {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        metadata: { workspace_id: "workspace-1" },
      },
    },
  });

  assert.equal(mock.workspaceUpdates.at(-1)?.patch.billing_access_state, "refunded");
  assert.equal(mock.workspaceRiskState(), "refunded");

  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_recovery_paid",
    type: "invoice.paid",
    created: 400,
    data: {
      object: {
        id: "in_recovery",
        subscription: "sub_123",
        customer: "cus_123",
        amount_paid: 9_900,
        billing_reason: "subscription_cycle",
        lines: {
          data: [{ period: { start: 1_785_100_000, end: 1_787_779_200 } }],
        },
      },
    },
  });

  assert.equal(mock.workspaceUpdates.at(-1)?.patch.billing_access_state, "paid");
  assert.equal(mock.workspaceRiskState(), null);
});

test("Stripe event high-water ordering rejects stale state snapshots", async () => {
  const mock = createBillingMock();
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_new_failed_invoice",
    type: "invoice.payment_failed",
    created: 500,
    data: { object: { id: "in_new", subscription: "sub_123" } },
  });
  const stale = await applyStripeBillingEvent(mock.client as never, {
    id: "evt_stale_active_subscription",
    type: "customer.subscription.updated",
    created: 400,
    data: {
      object: {
        id: "sub_123",
        status: "active",
        metadata: { workspace_id: "workspace-1" },
      },
    },
  });

  assert.equal(stale.outcome, "ignored");
  assert.equal(mock.workspaceUpdates.length, 1);
  assert.equal(mock.workspaceUpdates[0].patch.billing_access_state, "payment_recovery");
});

test("a late paid invoice cannot supersede or expire a newer active credit wallet", async () => {
  const mock = createBillingMock({ activeWalletPeriodStart: "2026-08-26T21:06:40.000Z" });
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_newer_failure",
    type: "invoice.payment_failed",
    created: 500,
    data: { object: { id: "in_newer_failure", subscription: "sub_123" } },
  });
  await applyStripeBillingEvent(mock.client as never, {
    id: "evt_late_paid",
    type: "invoice.paid",
    created: 400,
    data: {
      object: {
        id: "in_late_paid",
        subscription: "sub_123",
        amount_paid: 9_900,
        billing_reason: "subscription_cycle",
        lines: {
          data: [{ period: { start: 1_785_100_000, end: 1_787_779_200 } }],
        },
      },
    },
  });

  assert.equal(mock.workspaceUpdates.length, 1);
  assert.equal(mock.workspaceUpdates[0].patch.billing_access_state, "payment_recovery");
  assert.equal(mock.creditGrants.length, 0);
});

test("reconciliation events are stable for the same authoritative Stripe snapshot", () => {
  const subscription = {
    id: "sub_123",
    status: "active",
    current_period_end: 1_787_779_200,
    cancel_at_period_end: false,
    latest_invoice: { status: "paid" },
  };
  assert.equal(
    reconciliationEventForSubscription(subscription).id,
    reconciliationEventForSubscription(subscription).id,
  );
});

test("billing migration stores Stripe event IDs and locks workspace billing fields to service code", () => {
  const sql = readFileSync(
    "supabase/migrations/20260727022000_progressive_billing_foundation.sql",
    "utf8",
  );
  assert.match(sql, /stripe_event_id text primary key/i);
  assert.match(sql, /claim_stripe_webhook_event/i);
  assert.match(sql, /processing_status = 'failed'/i);
  assert.match(sql, /billing_offer_acceptances/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.stripe_webhook_events from public, anon, authenticated/i);
  assert.match(sql, /protect_stripe_billing_columns/i);
  assert.match(sql, /country_code = 'US' and billing_currency = 'USD'/i);
  assert.match(sql, /country_code = 'AU' and billing_currency = 'AUD'/i);

  const hardeningSql = readFileSync(
    "supabase/migrations/20260727026000_billing_event_security_hardening.sql",
    "utf8",
  );
  assert.match(hardeningSql, /processing_attempt_id uuid/i);
  assert.match(hardeningSql, /processing_lease_expires_at <= now\(\)/i);
  assert.match(hardeningSql, /processing_attempt_id = p_attempt_id/i);
  assert.match(hardeningSql, /billing_risk_state/i);
  assert.match(hardeningSql, /enforce_billing_risk_precedence/i);
  assert.match(hardeningSql, /billing_event_created bigint/i);
  assert.match(hardeningSql, /v_workspace_period_start > p_period_start/i);
  assert.match(hardeningSql, /v_wallet_period_start > p_period_start/i);
  assert.match(hardeningSql, /grant_stripe_invoice_period_credits/i);
});

test("Checkout requires the recorded country confirmation milestone, not only default market columns", () => {
  const route = readFileSync("src/app/api/settings/billing/checkout/route.ts", "utf8");
  assert.match(route, /from\("customer_activations"\)/);
  assert.match(route, /select\("country_confirmed_at"\)/);
  const policy = readFileSync("src/lib/billing/checkout-policy.ts", "utf8");
  assert.match(policy, /Confirm the workspace country before starting Checkout/);
});

test("invoice webhooks retrieve subscription metadata before applying billing state", () => {
  const route = readFileSync("src/app/api/settings/billing/webhook/route.ts", "utf8");
  assert.match(route, /event\.type === "invoice\.paid"/);
  assert.match(route, /retrieveStripeSubscription/);
});

function checkoutEvent(id: string, offerVersion: string = BILLING_OFFER_VERSION): StripeWebhookEvent {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        customer: "cus_123",
        subscription: "sub_123",
        client_reference_id: "workspace-1",
        metadata: {
          workspace_id: "workspace-1",
          offer_key: "ad_studio_US",
          offer_version: offerVersion,
          accepted_at: "2026-09-06T00:00:00.000Z",
          market: "US",
          currency: "USD",
          first_invoice_amount: "14900",
          renewal_amount: "14900",
          triggering_rule: "starts when Checkout completes",
        },
      },
    },
  };
}

function subscriptionEvent(input: {
  id: string;
  created: number;
  status: string;
  cancelAtPeriodEnd?: boolean;
  type?: StripeWebhookEvent["type"];
}): StripeWebhookEvent {
  return {
    id: input.id,
    type: input.type ?? "customer.subscription.updated",
    created: input.created,
    data: {
      object: {
        id: "sub_123",
        customer: "cus_123",
        status: input.status,
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        current_period_start: 1_785_100_000,
        current_period_end: 1_787_779_200,
        metadata: { workspace_id: "workspace-1" },
      },
    },
  };
}

function createBillingMock(options: {
  workspaceFound?: boolean;
  activeWalletPeriodStart?: string;
  billingContact?: {
    email?: string;
    timeZone?: string;
    offerKey?: string;
    subscriptionStatus?: string;
    cancelAtPeriodEnd?: boolean;
  };
} = {}) {
  const claimed = new Set<string>();
  const eventStatuses = new Map<string, string>();
  const claimAttempts = new Map<string, number>();
  const attemptIds = new Map<string, string>();
  const workspaceUpdates: Array<{ column: string; value: string; patch: Record<string, unknown> }> = [];
  const acceptances: Array<Record<string, unknown>> = [];
  const creditGrants: Array<Record<string, unknown>> = [];
  let eventHighWater = 0;
  let riskState: string | null = null;
  let accessState = "unbilled";
  let subscriptionStatus = options.billingContact?.subscriptionStatus ?? null;
  let cancelAtPeriodEnd = options.billingContact?.cancelAtPeriodEnd ?? false;
  let activeWalletPeriodStart = options.activeWalletPeriodStart
    ? Date.parse(options.activeWalletPeriodStart)
    : null;

  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_stripe_webhook_event") {
        const eventId = String(args.p_event_id);
        claimAttempts.set(eventId, (claimAttempts.get(eventId) ?? 0) + 1);
        if (claimed.has(eventId) && eventStatuses.get(eventId) !== "failed") {
          return { data: false, error: null };
        }
        claimed.add(eventId);
        attemptIds.set(eventId, String(args.p_attempt_id));
        eventStatuses.set(eventId, "processing");
        return { data: true, error: null };
      }
      if (name === "finish_stripe_webhook_event") {
        const eventId = String(args.p_event_id);
        if (attemptIds.get(eventId) === args.p_attempt_id) {
          eventStatuses.set(eventId, String(args.p_status));
        }
        return { data: null, error: null };
      }
      if (name === "grant_stripe_invoice_period_credits") {
        const incomingPeriodStart = Date.parse(String(args.p_period_start));
        if (activeWalletPeriodStart === null || incomingPeriodStart >= activeWalletPeriodStart) {
          creditGrants.push(args);
          activeWalletPeriodStart = incomingPeriodStart;
        }
        return {
          data: true,
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      if (table === "billing_offer_acceptances") {
        return {
          upsert: async (row: Record<string, unknown>) => {
            if (!acceptances.some((existing) => existing.stripe_checkout_session_id === row.stripe_checkout_session_id)) {
              acceptances.push(row);
            }
            return { error: null };
          },
        };
      }
      if (table === "workspaces") {
        return {
          select: (columns: string) => ({
            eq: async (_column: string, _value: string) => ({
              data: options.workspaceFound === false
                ? []
                : [columns === "id" || !options.billingContact
                    ? { id: "workspace-1" }
                    : {
                        id: "workspace-1",
                        billing_email: options.billingContact.email ?? "owner@example.com",
                        publishing_timezone: options.billingContact.timeZone ?? "Australia/Perth",
                        billing_offer_key: options.billingContact.offerKey ?? "ad_studio_AU",
                        stripe_subscription_status: subscriptionStatus,
                        stripe_cancel_at_period_end: cancelAtPeriodEnd,
                        billing_event_created: eventHighWater,
                      }],
              error: null,
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (column: string, value: string) => ({
              lte: (_highWaterColumn: string, incomingCreated: number) => ({
                select: async () => {
                  if (options.workspaceFound === false || eventHighWater > incomingCreated) {
                    return { data: [], error: null };
                  }

                  const effectivePatch = { ...patch };
                  const incomingRisk = Object.prototype.hasOwnProperty.call(patch, "billing_risk_state")
                    ? (patch.billing_risk_state as string | null)
                    : riskState;
                  if (
                    riskState &&
                    incomingRisk === riskState &&
                    typeof effectivePatch.billing_access_state === "string" &&
                    !["refunded", "disputed"].includes(effectivePatch.billing_access_state)
                  ) {
                    effectivePatch.billing_access_state = accessState;
                    effectivePatch.billing_payment_recovery_required = true;
                  }

                  riskState = incomingRisk;
                  if (typeof effectivePatch.billing_access_state === "string") {
                    accessState = effectivePatch.billing_access_state;
                  }
                  if (typeof effectivePatch.stripe_subscription_status === "string") {
                    subscriptionStatus = effectivePatch.stripe_subscription_status;
                  }
                  if (typeof effectivePatch.stripe_cancel_at_period_end === "boolean") {
                    cancelAtPeriodEnd = effectivePatch.stripe_cancel_at_period_end;
                  }
                  eventHighWater = incomingCreated;
                  workspaceUpdates.push({ column, value, patch: effectivePatch });
                  return { data: [{ id: "workspace-1" }], error: null };
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  return {
    client,
    eventStatuses,
    claimAttempts,
    workspaceUpdates,
    acceptances,
    creditGrants,
    workspaceRiskState: () => riskState,
  };
}
