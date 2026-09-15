import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BILLING_OFFERS } from "../src/lib/billing/offers.ts";
import {
  buildTrialReminderContent,
  formatOfferAmount,
  formatTrialEnd,
  recoverMissingTrialReminders,
  resolveTimeZone,
  scheduleTrialEndingReminder,
  trialReminderAt,
  trialReminderIdempotencyKey,
} from "../src/lib/billing/trial-reminder.ts";
import {
  TRIAL_REMINDER_MESSAGE_TYPE,
  decideTrialReminderSend,
  evaluateTrialReminderSend,
} from "../src/lib/billing/trial-reminder-state.ts";

// ---------------------------------------------------------------------------
// Timing: the reminder is anchored to trial_end - 24 hours, in UTC.
// ---------------------------------------------------------------------------

test("the reminder is scheduled 24 hours before the trial ends", () => {
  const trialEnd = new Date("2026-09-22T06:30:00.000Z");
  assert.equal(trialReminderAt(trialEnd).toISOString(), "2026-09-21T06:30:00.000Z");
  // Six elapsed days after activation, renewal one day later.
  const activatedAt = new Date("2026-09-15T06:30:00.000Z");
  assert.equal(trialEnd.getTime() - activatedAt.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(trialReminderAt(trialEnd).getTime() - activatedAt.getTime(), 6 * 24 * 60 * 60 * 1000);
});

test("the reminder key is unique per subscription, trial end and reminder type", () => {
  const base = { subscriptionId: "sub_123", trialEndIso: "2026-09-22T06:30:00.000Z" };
  const key = trialReminderIdempotencyKey(base);

  assert.equal(key, trialReminderIdempotencyKey(base));
  assert.match(key, /^trial-reminder:sub_123:2026-09-22T06:30:00\.000Z:day6$/);
  // A moved trial end is a different reminder, so the customer hears about the
  // real deadline.
  assert.notEqual(key, trialReminderIdempotencyKey({ ...base, trialEndIso: "2026-09-25T06:30:00.000Z" }));
  // A different subscription never collapses onto this one.
  assert.notEqual(key, trialReminderIdempotencyKey({ ...base, subscriptionId: "sub_999" }));
});

test("the trial end renders in the customer timezone and falls back safely", () => {
  const trialEnd = new Date("2026-09-22T06:30:00.000Z");

  const perth = formatTrialEnd(trialEnd, "Australia/Perth");
  const utc = formatTrialEnd(trialEnd, "UTC");
  assert.notEqual(perth, utc);
  assert.match(perth, /2026/);
  // An unusable zone must not throw during a drain.
  assert.equal(resolveTimeZone("Not/AZone"), "Australia/Perth");
  assert.equal(resolveTimeZone(null), "Australia/Perth");
  assert.equal(resolveTimeZone("  "), "Australia/Perth");
  assert.equal(resolveTimeZone("Australia/Perth"), "Australia/Perth");
  assert.match(formatTrialEnd(trialEnd, "Not/AZone"), /2026/);
});

// ---------------------------------------------------------------------------
// Content: real offer and recipient data, no placeholders.
// ---------------------------------------------------------------------------

test("the reminder states the deadline, the renewal, the cancellation route and separate Meta spend", () => {
  const offer = BILLING_OFFERS.ad_studio_AU;
  const trialEnd = new Date("2026-09-22T06:30:00.000Z");
  const content = buildTrialReminderContent({
    recipientName: "Sam",
    offer,
    trialEnd,
    timeZone: "Australia/Perth",
    manageUrl: "https://blockwise.sale/settings#billing",
  });

  const when = formatTrialEnd(trialEnd, "Australia/Perth");
  assert.ok(content.text.includes(when), "the exact trial end must appear");
  assert.ok(content.subject.includes(when), "the subject must carry the deadline");
  assert.ok(content.text.includes(`${formatOfferAmount(offer)} per month`));
  assert.ok(content.text.includes("renews automatically"));
  assert.ok(content.text.includes("https://blockwise.sale/settings#billing"));
  assert.ok(content.text.includes("Meta ad spend is separate"));
  assert.ok(content.text.includes("Hi Sam,"));
  assert.ok(content.html.includes(when));
  assert.ok(content.html.includes("Settings, billing"));

  // The amount comes from the accepted offer, not a hardcoded placeholder.
  assert.equal(formatOfferAmount(offer), "A$249");
  assert.equal(formatOfferAmount(BILLING_OFFERS.managed_AU), "A$1,500");
});

test("reminder copy uses no em dashes and no unfilled placeholders", () => {
  const content = buildTrialReminderContent({
    recipientName: null,
    offer: BILLING_OFFERS.ad_studio_AU,
    trialEnd: new Date("2026-09-22T06:30:00.000Z"),
    timeZone: "Australia/Perth",
    manageUrl: "https://blockwise.sale/settings#billing",
  });

  for (const body of [content.subject, content.text, content.html]) {
    assert.doesNotMatch(body, /\u2014/, "authored copy must not use em dashes");
    assert.doesNotMatch(body, /\{\{|\}\}|undefined|NaN|\[object Object\]/);
  }
  // A missing name degrades to a neutral greeting rather than "Hi ,".
  assert.match(content.text, /^Hi,/);
});

// ---------------------------------------------------------------------------
// Send-time decision: suppress rather than deliver a stale reminder.
// ---------------------------------------------------------------------------

const trialEndIso = "2026-09-22T06:30:00.000Z";
const duringTrial = new Date("2026-09-21T06:30:00.000Z");

function facts(overrides: {
  subscriptionId?: string | null;
  trialEnd?: string | null;
  current?: { subscriptionId: string | null; subscriptionStatus: string | null; periodEndIso: string | null } | null;
} = {}) {
  return {
    subscriptionId: overrides.subscriptionId === undefined ? "sub_123" : overrides.subscriptionId,
    trialEndIso: overrides.trialEnd === undefined ? trialEndIso : overrides.trialEnd,
    current:
      overrides.current === undefined
        ? { subscriptionId: "sub_123", subscriptionStatus: "trialing", periodEndIso: trialEndIso }
        : overrides.current,
  };
}

test("a due reminder sends only while the same trial is still running", () => {
  assert.deepEqual(decideTrialReminderSend({ facts: facts(), now: duringTrial }), { action: "send" });
});

test("a stale reminder is suppressed rather than describing a deadline that no longer applies", () => {
  const cases: Array<[string, Parameters<typeof decideTrialReminderSend>[0], string]> = [
    ["missing subscription", { facts: facts({ subscriptionId: null }), now: duringTrial }, "reminder_missing_identity"],
    ["missing trial end", { facts: facts({ trialEnd: null }), now: duringTrial }, "reminder_missing_identity"],
    ["invalid trial end", { facts: facts({ trialEnd: "not-a-date" }), now: duringTrial }, "reminder_invalid_trial_end"],
    ["workspace gone", { facts: facts({ current: null }), now: duringTrial }, "workspace_not_found"],
    [
      "superseded subscription",
      { facts: facts({ current: { subscriptionId: "sub_other", subscriptionStatus: "trialing", periodEndIso: trialEndIso } }), now: duringTrial },
      "superseded_subscription",
    ],
    [
      "renewed or cancelled",
      { facts: facts({ current: { subscriptionId: "sub_123", subscriptionStatus: "active", periodEndIso: trialEndIso } }), now: duringTrial },
      "subscription_not_trialing",
    ],
    [
      "cancelled subscription",
      { facts: facts({ current: { subscriptionId: "sub_123", subscriptionStatus: "canceled", periodEndIso: trialEndIso } }), now: duringTrial },
      "subscription_not_trialing",
    ],
    [
      "trial end moved",
      { facts: facts({ current: { subscriptionId: "sub_123", subscriptionStatus: "trialing", periodEndIso: "2026-09-29T06:30:00.000Z" } }), now: duringTrial },
      "trial_end_changed",
    ],
    [
      "trial already ended",
      { facts: facts(), now: new Date("2026-09-22T06:30:01.000Z") },
      "trial_already_ended",
    ],
  ];

  for (const [label, input, reason] of cases) {
    const decision = decideTrialReminderSend(input);
    assert.equal(decision.action, "suppress", label);
    if (decision.action === "suppress") assert.equal(decision.reason, reason, label);
  }
});

test("a reminder due exactly at the trial end is already too late", () => {
  const decision = decideTrialReminderSend({ facts: facts(), now: new Date(trialEndIso) });
  assert.equal(decision.action, "suppress");
});

// ---------------------------------------------------------------------------
// Scheduling and the catch-up scan.
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: { message: string } | null };

function fakeService(options: {
  workspaces?: unknown[];
  single?: unknown;
  outboxInsert?: Result;
  onUpsert?: (row: Record<string, unknown>) => void;
  onTable?: (table: string) => void;
}) {
  function chain(result: Result) {
    const c: Record<string, unknown> = {
      select: () => chain(result),
      eq: () => chain(result),
      not: () => chain(result),
      gt: () => chain(result),
      is: () => chain(result),
      order: () => chain(result),
      limit: () => chain(result),
      upsert: (row: Record<string, unknown>) => {
        options.onUpsert?.(row);
        return chain(options.outboxInsert ?? { data: [{ id: "outbox-1" }], error: null });
      },
      maybeSingle: () => Promise.resolve({ data: options.single ?? null, error: null }),
      then: (resolve: (value: Result) => void) => resolve(result),
    };
    return c;
  }
  return {
    from: (table: string) => {
      options.onTable?.(table);
      return table === "email_outbox"
        ? chain({ data: null, error: null })
        : chain({ data: options.workspaces ?? [], error: null });
    },
  };
}

function serviceFor(options: Parameters<typeof fakeService>[0]) {
  return fakeService(options) as unknown as Parameters<typeof recoverMissingTrialReminders>[0];
}

test("scheduling sets the not-before time to the trial end less 24 hours", async () => {
  let inserted: Record<string, unknown> | undefined;
  const service = serviceFor({ onUpsert: (row) => { inserted = row; } });

  const result = await scheduleTrialEndingReminder({
    service,
    workspaceId: "workspace-1",
    subscriptionId: "sub_123",
    trialEnd: new Date(trialEndIso),
    recipient: "owner@example.com",
    timeZone: "Australia/Perth",
    now: new Date("2026-09-15T06:30:00.000Z"),
  });

  assert.equal(result.queued, true);
  assert.equal(inserted?.message_type, TRIAL_REMINDER_MESSAGE_TYPE);
  assert.equal(inserted?.next_attempt_at, "2026-09-21T06:30:00.000Z");
  assert.equal(inserted?.recipient, "owner@example.com");
  assert.equal(inserted?.timezone, "Australia/Perth");
  assert.equal(inserted?.idempotency_key, `trial-reminder:sub_123:${trialEndIso}:day6`);
  const payload = inserted?.payload as Record<string, unknown>;
  assert.equal(payload.subscriptionId, "sub_123");
  assert.equal(payload.trialEnd, trialEndIso);
  assert.equal(payload.renewalAmount, 24_900);
  assert.equal(payload.offerVersion, BILLING_OFFERS.ad_studio_AU.version);
});

test("a trial already inside the window is due immediately, not skipped", async () => {
  let inserted: Record<string, unknown> | undefined;
  const service = serviceFor({ onUpsert: (row) => { inserted = row; } });
  const now = new Date("2026-09-21T20:00:00.000Z");

  const result = await scheduleTrialEndingReminder({
    service,
    workspaceId: "workspace-1",
    subscriptionId: "sub_123",
    trialEnd: new Date(trialEndIso),
    recipient: "owner@example.com",
    now,
  });

  assert.equal(result.queued, true);
  assert.equal(inserted?.next_attempt_at, now.toISOString());
});

test("a duplicate schedule is a no-op that keeps the original message", async () => {
  // An empty upsert result is how the outbox reports a duplicate idempotency key.
  const service = serviceFor({
    outboxInsert: { data: [], error: null },
    single: { id: "existing-1" },
  });

  const result = await scheduleTrialEndingReminder({
    service,
    workspaceId: "workspace-1",
    subscriptionId: "sub_123",
    trialEnd: new Date(trialEndIso),
    recipient: "owner@example.com",
  });

  assert.equal(result.queued, false);
  assert.equal(result.reason, "already_scheduled");
  if (!result.queued) assert.equal(result.duplicateOf, "existing-1");
});

test("the catch-up scan reminds every trialing workspace and surfaces one with no contact", async () => {
  const scheduled: string[] = [];
  const service = serviceFor({
    workspaces: [
      {
        id: "workspace-1",
        billing_email: "one@example.com",
        publishing_timezone: "Australia/Perth",
        stripe_subscription_id: "sub_1",
        stripe_subscription_status: "trialing",
        stripe_current_period_end: trialEndIso,
      },
      {
        id: "workspace-2",
        billing_email: null,
        publishing_timezone: null,
        stripe_subscription_id: "sub_2",
        stripe_subscription_status: "trialing",
        stripe_current_period_end: trialEndIso,
      },
    ],
    onUpsert: (row) => scheduled.push(String(row.recipient)),
  });

  const result = await recoverMissingTrialReminders(service, 50);

  assert.equal(result.scanned, 2);
  assert.equal(result.queued, 1);
  // A trial with no billing contact cannot be reminded, and must not be silent.
  assert.equal(result.failed, 1);
  assert.deepEqual(scheduled, ["one@example.com"]);
});

test("the send-time check reads current subscription truth and defers when it cannot", async () => {
  const row = { payload: { workspaceId: "workspace-1", subscriptionId: "sub_123", trialEnd: trialEndIso } };

  const send = await evaluateTrialReminderSend(
    serviceFor({ single: { stripe_subscription_id: "sub_123", stripe_subscription_status: "trialing", stripe_current_period_end: trialEndIso } }),
    row,
    duringTrial,
  );
  assert.deepEqual(send, { action: "send" });

  const stale = await evaluateTrialReminderSend(
    serviceFor({ single: { stripe_subscription_id: "sub_123", stripe_subscription_status: "active", stripe_current_period_end: trialEndIso } }),
    row,
    duringTrial,
  );
  assert.equal(stale.action, "suppress");

  // An unreadable state must throw so the caller defers, never sends.
  const broken = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "down" } }) }),
      }),
    }),
  } as unknown as Parameters<typeof evaluateTrialReminderSend>[0];
  await assert.rejects(() => evaluateTrialReminderSend(broken, row, duringTrial));
});

// ---------------------------------------------------------------------------
// Wiring: the drain must actually consult the guard and run the scan.
// ---------------------------------------------------------------------------

test("the outbox consults the trial reminder guard before delivering", () => {
  const outbox = readFileSync("src/lib/email/outbox.ts", "utf8");
  assert.match(outbox, /TRIAL_REMINDER_MESSAGE_TYPE/);
  assert.match(outbox, /evaluateTrialReminderSend\(supabase, row\)/);
  assert.match(outbox, /trial_reminder_state_check_unavailable/);
});

test("the drain route runs the trial reminder catch-up scan and isolates its failure", () => {
  const route = readFileSync("src/app/api/internal/email/drain/route.ts", "utf8");
  assert.match(route, /recoverMissingTrialReminders\(service, 50\)/);
  assert.match(route, /trialReminders/);
  // A reminder scan failure must not stop the rest of the outbox draining.
  assert.match(route, /trial reminder recovery failed/);
});

test("no cron route is required for delivery because the drain timer is already registered", () => {
  // The reminder is delivered by the per-minute outbox drain, so it needs no new
  // timer. Guard that assumption explicitly.
  const timer = readFileSync("infra/product/systemd/blockwise-email-outbox-drain.timer", "utf8");
  assert.match(timer, /OnUnitActiveSec=1min/);
  assert.match(timer, /Persistent=true/);
});
