import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  recoverMissingTrialReminders,
  trialReminderAt,
} from "../src/lib/billing/trial-reminder.ts";
import { decideTrialReminderSend } from "../src/lib/billing/trial-reminder-state.ts";
import type { SetStageInput } from "../src/lib/mautic/flows.ts";

test("the trial-ending stage is due exactly 24 hours before the Stripe trial end", () => {
  const trialEnd = new Date("2026-09-22T06:30:00.000Z");
  assert.equal(trialReminderAt(trialEnd).toISOString(), "2026-09-21T06:30:00.000Z");
});

test("the pure stage guard suppresses ended, changed and superseded trials", () => {
  const end = "2026-09-22T06:30:00.000Z";
  const current = {
    subscriptionId: "sub_1",
    subscriptionStatus: "trialing",
    periodEndIso: end,
  };
  assert.deepEqual(decideTrialReminderSend({
    facts: { subscriptionId: "sub_1", trialEndIso: end, current },
    now: new Date("2026-09-21T06:30:00.000Z"),
  }), { action: "send" });
  assert.equal(decideTrialReminderSend({
    facts: { subscriptionId: "sub_1", trialEndIso: end, current },
    now: new Date(end),
  }).action, "suppress");
  assert.equal(decideTrialReminderSend({
    facts: { subscriptionId: "sub_1", trialEndIso: end, current: { ...current, subscriptionId: "sub_2" } },
    now: new Date("2026-09-21T06:30:00.000Z"),
  }).action, "suppress");
  assert.equal(decideTrialReminderSend({
    facts: { subscriptionId: "sub_1", trialEndIso: end, current: { ...current, periodEndIso: "2026-09-23T06:30:00.000Z" } },
    now: new Date("2026-09-21T06:30:00.000Z"),
  }).action, "suppress");
});

test("the due trial scan writes one correctly formatted Mautic stage per workspace", async () => {
  const now = new Date("2026-09-21T06:30:00.000Z");
  const calls: SetStageInput[] = [];
  let upperBound = "";
  const service = {
    from: (table: string) => {
      assert.equal(table, "workspaces");
      const result = {
        data: [{
          id: "workspace-1",
          billing_email: "owner@example.com",
          publishing_timezone: "Australia/Perth",
          stripe_subscription_id: "sub_1",
          stripe_subscription_status: "trialing",
          stripe_current_period_end: "2026-09-22T06:30:00.000Z",
          billing_offer_key: "ad_studio_AU",
        }],
        error: null,
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        gt: () => chain,
        lte: (_column: string, value: string) => {
          upperBound = value;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: typeof result) => void) => resolve(result),
      };
      return chain;
    },
  };

  const result = await recoverMissingTrialReminders(
    service as never,
    50,
    now,
    async (input) => {
      calls.push(input);
      return { id: "job-1" };
    },
  );

  assert.equal(upperBound, "2026-09-22T06:30:00.000Z");
  assert.deepEqual(result, { scanned: 1, queued: 1, failed: 0 });
  assert.deepEqual(calls, [{
    email: "owner@example.com",
    workspaceId: "workspace-1",
    subjectId: "sub_1:2026-09-22T06:30:00.000Z",
    stage: "trial_ending",
    periodEnd: new Date("2026-09-22T06:30:00.000Z"),
    plan: "Ad studio",
    amount: "A$249 per month",
    timeZone: "Australia/Perth",
    guard: {
      kind: "trial_ending",
      subscriptionId: "sub_1",
      trialEndIso: "2026-09-22T06:30:00.000Z",
    },
  }]);
});

test("the trial scan pages past a full first page", async () => {
  const rows = ["workspace-1", "workspace-2", "workspace-3"].map((id, index) => ({
    id,
    billing_email: `owner${index + 1}@example.com`,
    publishing_timezone: "Australia/Perth",
    stripe_subscription_id: `sub-${index + 1}`,
    stripe_subscription_status: "trialing",
    stripe_current_period_end: "2026-09-22T06:30:00.000Z",
    billing_offer_key: "ad_studio_AU",
  }));
  const cursors: string[] = [];
  const service = {
    from() {
      let afterId: string | null = null;
      let pageSize = 2;
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        not() { return chain; },
        gt(column: string, value: string) {
          if (column === "id") {
            afterId = value;
            cursors.push(value);
          }
          return chain;
        },
        lte() { return chain; },
        order() { return chain; },
        limit(value: number) { pageSize = value; return chain; },
        then(resolve: (value: unknown) => unknown) {
          const start = afterId ? rows.findIndex((row) => row.id === afterId) + 1 : 0;
          return Promise.resolve({ data: rows.slice(start, start + pageSize), error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  let queued = 0;
  const result = await recoverMissingTrialReminders(
    service as never,
    2,
    new Date("2026-09-21T06:30:00.000Z"),
    async () => {
      queued += 1;
      return { id: `job-${queued}` };
    },
  );

  assert.deepEqual(result, { scanned: 3, queued: 3, failed: 0 });
  assert.deepEqual(cursors, ["workspace-2"]);
});

test("the surviving provider-maintenance schedule runs the trial-ending scan", () => {
  const source = readFileSync("src/lib/providers/scheduled-maintenance.ts", "utf8");
  assert.match(source, /await recoverMissingTrialReminders\(service, 50\)/);
});
