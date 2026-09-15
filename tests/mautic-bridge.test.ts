import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mauticRequest } from "../src/lib/mautic/client.ts";
import { upsertContact } from "../src/lib/mautic/contacts.ts";
import {
  formatAmountField,
  formatBudget,
  formatLeadsSummary,
  formatMoney,
  formatPeriodEnd,
  formatRecurringAmount,
  executeMauticSync,
  fireEvent,
  setStage,
} from "../src/lib/mautic/flows.ts";
import { resolveHandler } from "../worker/index.ts";

const configuredEnv = {
  MAUTIC_API_URL: "https://mautic.test",
  MAUTIC_API_USER: "api-user",
  MAUTIC_API_PASSWORD: "api-password",
};

test("Mautic requests are logged no-ops when any API setting is missing", async () => {
  let fetched = false;
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => logs.push(values.join(" "));
  try {
    const result = await mauticRequest("POST", "/api/contacts/new", {
      env: { MAUTIC_API_URL: "https://mautic.test", MAUTIC_API_USER: "api-user" },
      fetchImpl: async () => {
        fetched = true;
        throw new Error("network must not be reached");
      },
      context: { emailDomain: "example.com", flow: "signed_up" },
    });
    assert.deepEqual(result, { skipped: true });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(fetched, false);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /flow=signed_up/);
  assert.match(logs[0] ?? "", /email_domain=example\.com/);
  assert.doesNotMatch(logs[0] ?? "", /api-user|api-password|person@/);
});

test("contact upsert exactly matches email and patches the existing contact", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (calls.length === 1) {
      return Response.json({
        contacts: {
          "42": { id: 42, fields: { core: { email: { value: "Person@Example.com" } } } },
        },
      });
    }
    return Response.json({ contact: { id: 42 } });
  };

  const result = await upsertContact({
    email: "person@example.com",
    firstName: "Pat",
    workspaceId: "workspace-1",
    profileId: "profile-1",
    fields: { blockwise_stage: "paid" },
  }, { env: configuredEnv, fetchImpl, flow: "paid" });

  assert.deepEqual(result, { skipped: false, contactId: "42" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://mautic.test/api/contacts?search=email:person%40example.com&limit=1");
  assert.equal(calls[1]?.url, "https://mautic.test/api/contacts/42/edit");
  assert.equal(calls[1]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    blockwise_stage: "paid",
    email: "person@example.com",
    firstname: "Pat",
    blockwise_workspace_id: "workspace-1",
    blockwise_profile_id: "profile-1",
  });
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("authorization"), "Basic YXBpLXVzZXI6YXBpLXBhc3N3b3Jk");
});

test("contact upsert creates when the returned contact is not an exact email match", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json({ contacts: { "7": { id: 7, email: "someone-else@example.com" } } })
      : Response.json({ contact: { id: 99 } });
  };

  const result = await upsertContact({
    email: "new@example.com",
    lastName: "Lee",
    fields: { blockwise_event: "new_leads" },
  }, { env: configuredEnv, fetchImpl, flow: "new_leads" });

  assert.deepEqual(result, { skipped: false, contactId: "99" });
  assert.equal(calls[1]?.url, "https://mautic.test/api/contacts/new");
  assert.equal(calls[1]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    blockwise_event: "new_leads",
    email: "new@example.com",
    lastname: "Lee",
  });
});

test("contact upsert waits for Mautic to clear an earlier event and recognizes a replay", async () => {
  const fields = {
    core: { email: { value: "owner@example.com" } },
    all: {
      blockwise_event: { value: "campaign_live" },
      blockwise_event_at: { value: "2026-09-15T01:00:00.000Z" },
    },
  };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return Response.json({ contacts: { "42": { id: 42, fields } } });
  };

  await assert.rejects(
    upsertContact({
      email: "owner@example.com",
      fields: {
        blockwise_event: "new_leads",
        blockwise_event_at: "2026-09-15T02:00:00.000Z",
      },
    }, { env: configuredEnv, fetchImpl, flow: "new_leads" }),
    /pending flow transition/,
  );
  assert.equal(calls, 1);

  const replay = await upsertContact({
    email: "owner@example.com",
    fields: {
      blockwise_event: "campaign_live",
      blockwise_event_at: "2026-09-15T01:00:00.000Z",
    },
  }, { env: configuredEnv, fetchImpl, flow: "campaign_live" });
  assert.deepEqual(replay, { skipped: false, contactId: "42" });
  assert.equal(calls, 2);
});

test("stage and event flows enqueue exact durable Mautic jobs", async () => {
  const jobs: Array<Record<string, unknown>> = [];
  const enqueueImpl = async (input: Record<string, unknown>) => {
    jobs.push(input);
    return { id: `job-${jobs.length}` };
  };

  await setStage({
    email: "owner@example.com",
    workspaceId: "workspace-1",
    stage: "paid",
    subjectId: "subscription-1",
    periodEnd: new Date("2026-09-30T00:00:00.000Z"),
    amount: "14900:aud:month",
  }, { enqueueImpl: enqueueImpl as never });
  await fireEvent({
    email: "owner@example.com",
    workspaceId: "workspace-1",
    event: "new_leads",
    subjectId: "batch-1",
    leadsCount: 2,
    leadsSummary: "Ada · Perth · 0400",
  }, { enqueueImpl: enqueueImpl as never });

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]?.kind, "mautic_sync");
  assert.equal(jobs[0]?.workspaceId, "workspace-1");
  assert.equal(jobs[0]?.maxAttempts, 25);
  assert.equal(
    jobs[0]?.dedupeKey,
    `mautic_sync:paid:${createHash("sha256").update("subscription-1").digest("hex").slice(0, 32)}`,
  );
  const stagePayload = jobs[0]?.payload as Record<string, unknown>;
  assert.equal(stagePayload.flow, "paid");
  assert.equal((stagePayload.fields as Record<string, unknown>).blockwise_amount, "A$149 per month");
  assert.equal((stagePayload.fields as Record<string, unknown>).blockwise_period_end, "30 September 2026");
  assert.equal(jobs[1]?.kind, "mautic_sync");
  assert.equal(
    jobs[1]?.dedupeKey,
    `mautic_sync:new_leads:${createHash("sha256").update("batch-1").digest("hex").slice(0, 32)}`,
  );
  assert.equal(((jobs[1]?.payload as Record<string, unknown>).fields as Record<string, unknown>).blockwise_leads_count, 2);
});

test("guarded trial jobs recheck authoritative state at worker execution", async () => {
  let fetched = false;
  const service = guardService({
    stripe_subscription_id: "sub-1",
    stripe_subscription_status: "active",
    stripe_current_period_end: "2026-09-30T00:00:00.000Z",
  });
  const result = await executeMauticSync({
    workspaceId: "workspace-1",
    flow: "trial_ending",
    email: "owner@example.com",
    fields: { blockwise_stage: "trial_ending" },
    guard: {
      kind: "trial_ending",
      subscriptionId: "sub-1",
      trialEndIso: "2026-09-30T00:00:00.000Z",
    },
  }, {
    serviceSupabase: service as never,
    now: new Date("2026-09-29T00:00:00.000Z"),
    fetchImpl: async () => {
      fetched = true;
      throw new Error("stale trial must not reach Mautic");
    },
  });
  assert.deepEqual(result, { skipped: true });
  assert.equal(fetched, false);
});

test("a later compatible billing transition does not erase a queued cancellation", async () => {
  const calls: string[] = [];
  const result = await executeMauticSync({
    workspaceId: "workspace-1",
    flow: "cancelled",
    email: "owner@example.com",
    fields: {
      blockwise_stage: "cancelled",
      blockwise_stage_at: "2026-09-15T01:00:00.000Z",
    },
    guard: {
      kind: "billing_transition",
      eventId: "evt-cancel-at-end",
      eventCreated: 100,
      expectedSubscriptionId: "sub-1",
      expectedSubscriptionStatus: "active",
      expectedCancelAtPeriodEnd: true,
    },
  }, {
    serviceSupabase: guardService({
      billing_event_created: 200,
      billing_event_id: "evt-deleted",
      stripe_subscription_id: "sub-1",
      stripe_subscription_status: "canceled",
      stripe_cancel_at_period_end: false,
      billing_access_state: "canceled",
    }) as never,
    env: configuredEnv,
    fetchImpl: (async (input: string | URL | Request) => {
      calls.push(String(input));
      return calls.length === 1
        ? Response.json({ contacts: {} })
        : Response.json({ contact: { id: 42 } });
    }) as typeof fetch,
  });

  assert.deepEqual(result, { skipped: false, contactId: "42" });
  assert.equal(calls.length, 2);
});

test("worker dispatch executes mautic_sync with the service database", async () => {
  const previous = {
    url: process.env.MAUTIC_API_URL,
    user: process.env.MAUTIC_API_USER,
    password: process.env.MAUTIC_API_PASSWORD,
  };
  process.env.MAUTIC_API_URL = configuredEnv.MAUTIC_API_URL;
  process.env.MAUTIC_API_USER = configuredEnv.MAUTIC_API_USER;
  process.env.MAUTIC_API_PASSWORD = configuredEnv.MAUTIC_API_PASSWORD;
  const calls: string[] = [];
  try {
    const handler = await resolveHandler("mautic_sync");
    assert.ok(handler);
    await handler({
      workspaceId: "workspace-1",
      flow: "paid",
      email: "owner@example.com",
      fields: { blockwise_stage: "paid" },
    }, guardService(null) as never, {
      signal: new AbortController().signal,
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return calls.length === 1
          ? Response.json({ contacts: {} })
          : Response.json({ contact: { id: 77 } });
      }) as typeof fetch,
    });
  } finally {
    restoreEnv("MAUTIC_API_URL", previous.url);
    restoreEnv("MAUTIC_API_USER", previous.user);
    restoreEnv("MAUTIC_API_PASSWORD", previous.password);
  }
  assert.deepEqual(calls, [
    "https://mautic.test/api/contacts?search=email:owner%40example.com&limit=1",
    "https://mautic.test/api/contacts/new",
  ]);
});

test("Mautic display fields format dates, money, budgets, and encoded amounts", () => {
  const instant = new Date("2026-09-29T16:30:00.000Z");
  assert.equal(formatPeriodEnd(instant), "30 September 2026");
  assert.equal(formatPeriodEnd(instant, "Invalid/Zone"), "30 September 2026");
  assert.equal(formatRecurringAmount({ minorUnits: 14_900, currency: "AUD", interval: "month" }), "A$149 per month");
  assert.equal(formatAmountField("14900:aud:month"), "A$149 per month");
  assert.equal(formatAmountField("A$149 per month"), "A$149 per month");
  assert.equal(formatAmountField("not:a:money"), "not:a:money");
  assert.equal(formatBudget({ minorUnits: 20_000, currency: "AUD" }), "A$200 per week");
  assert.equal(formatMoney(12_345, "AUD"), "A$123.45");
  assert.throws(() => formatMoney(12.5, "AUD"), /integer minor units/);
});

test("lead summaries contain no email field and cap batches at ten leads", () => {
  const leads = Array.from({ length: 12 }, (_, index) => ({
    name: `Lead ${index + 1}`,
    suburb: "Perth",
    phone: `0400 000 ${String(index).padStart(3, "0")}`,
    email: `lead-${index}@example.com`,
  }));
  const summary = formatLeadsSummary(leads);
  assert.equal(summary.split("\n").length, 11);
  assert.match(summary, /^Lead 1 · Perth · 0400 000 000/m);
  assert.match(summary, /\+2 more$/);
  assert.doesNotMatch(summary, /@example\.com/);
});

test("Mautic provisioning declares the bridge identity fields", () => {
  const provision = readFileSync("mautic/provision.py", "utf8");
  assert.match(provision, /\("blockwise_workspace_id", "Blockwise workspace ID", "text"\)/);
  assert.match(provision, /\("blockwise_profile_id", "Blockwise profile ID", "text"\)/);
  assert.match(provision, /field = "blockwise_stage" if kind == "stage" else "blockwise_event"[\s\S]*"properties": \{field: "done"\}/);
});

test("Mautic queue receipts and producer recovery markers are installed additively", () => {
  const sql = readFileSync("supabase/migrations/20260915130000_mautic_sync_durability.sql", "utf8");
  assert.match(sql, /job_queue_mautic_sync_receipt_idx[\s\S]*where kind = 'mautic_sync'/i);
  assert.match(sql, /if p_kind = 'mautic_sync'[\s\S]*on conflict \(workspace_id, kind, dedupe_key\)/i);
  assert.match(sql, /mautic_signed_up_queued_at/i);
  assert.match(sql, /mautic_new_leads_queued_at/i);
  assert.doesNotMatch(sql, /drop table|disable row level security/i);
});

function guardService(data: Record<string, unknown> | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data, error: null }) };
            },
          };
        },
      };
    },
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
