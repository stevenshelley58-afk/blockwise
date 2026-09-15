import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fireNewLeadsEvent, queuePendingNewLeadsEvent } from "../src/lib/providers/meta-leads-worker.ts";
import { fireCampaignLiveEvent } from "../src/lib/providers/meta-publish-worker.ts";
import {
  campaignPeriodSpendAndBudget,
  queueBudgetAlerts,
} from "../src/lib/meta-monitor/budget-alert.ts";
import type { MetaAdPerformance, MetaMonitorPayload } from "../src/lib/meta-monitor/types.ts";
import type { MetaPublishPlan } from "../src/lib/providers/meta-execution.ts";

test("campaign activation queues one campaign_live event with the plan identity", async () => {
  const calls: Record<string, unknown>[] = [];
  const plan = {
    planId: "plan-1",
    workspaceId: "workspace-1",
    controls: { dailyBudgetMinorUnits: 2_000 },
    adSets: [],
    campaign: { name: "Spring appraisal", budgetMode: "campaign" },
    setup: { currency: "AUD" },
  } as unknown as MetaPublishPlan;

  const queued = await fireCampaignLiveEvent({
    serviceSupabase: contactService() as never,
    plan,
    fireEventImpl: async (input) => { calls.push(input); return { id: "job-1" }; },
  });

  assert.equal(queued, true);
  assert.deepEqual(calls, [{
    email: "owner@example.com",
    workspaceId: "workspace-1",
    event: "campaign_live",
    subjectId: "plan-1",
    campaignName: "Spring appraisal",
    campaignUrl: "https://blockwise.sale/performance?planId=plan-1",
    budget: "A$140 per week",
  }]);
});

test("one finalized lead batch queues one new_leads event without lead emails", async () => {
  const calls: Record<string, unknown>[] = [];
  const queued = await fireNewLeadsEvent({
    serviceSupabase: contactService() as never,
    workspaceId: "workspace-1",
    planId: "plan-1",
    campaignName: "Spring appraisal",
    leads: [
      lead("meta-2", "Grace Hopper", "Como", "0400 000 002", "grace@example.com"),
      lead("meta-1", "Ada Lovelace", "Perth", "0400 000 001", "ada@example.com"),
    ],
    fireEventImpl: async (input) => { calls.push(input); return { id: "job-2" }; },
  });

  assert.equal(queued, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    email: "owner@example.com",
    workspaceId: "workspace-1",
    event: "new_leads",
    subjectId: "plan-1:meta-1,meta-2",
    campaignName: "Spring appraisal",
    leadsCount: 2,
    leadsSummary: "Grace Hopper · Como · 0400 000 002\nAda Lovelace · Perth · 0400 000 001",
  });
  assert.doesNotMatch(String(calls[0]?.leadsSummary), /@/);
});

test("a failed new-leads enqueue is reconstructed from pending captured leads", async () => {
  const fixture = pendingLeadService();
  let attempts = 0;
  const fireEventImpl = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("queue unavailable");
    return { id: "job-2" };
  };
  const input = {
    serviceSupabase: fixture.service as never,
    workspaceId: "workspace-1",
    planId: "plan-1",
    campaignName: "Spring appraisal",
    fireEventImpl: fireEventImpl as never,
  };

  await assert.rejects(queuePendingNewLeadsEvent(input), /queue unavailable/);
  assert.equal(fixture.marked(), false);
  assert.equal(await queuePendingNewLeadsEvent(input), true);
  assert.equal(fixture.marked(), true);
  assert.equal(await queuePendingNewLeadsEvent(input), false);
  assert.equal(attempts, 2);
});

test("weekly budget alerts queue once at 80 percent and persist the period marker", async () => {
  const plan = {
    id: "plan-1",
    currency: "AUD",
    budget_alert_period_key: null,
    plan_json: {
      campaign: { name: "Spring appraisal", budgetMode: "adset" },
      adSets: [{ localId: "set-1", dailyBudgetMinorUnits: 2_000 }],
      controls: { dailyBudgetMinorUnits: 2_000 },
    },
    reconciled_objects_json: { campaignId: "campaign-1" },
  };
  const updates: Record<string, unknown>[] = [];
  const service = budgetService(plan, updates);
  const calls: Record<string, unknown>[] = [];
  const payload = monitorPayload("last_7", 112);
  const fireEventImpl = async (input: Record<string, unknown>) => { calls.push(input); return { id: "job-3" }; };

  assert.equal(await queueBudgetAlerts({ serviceSupabase: service as never, workspaceId: "workspace-1", payload, fireEventImpl: fireEventImpl as never, now: new Date("2026-09-15T12:00:00Z") }), 1);
  assert.equal(await queueBudgetAlerts({ serviceSupabase: service as never, workspaceId: "workspace-1", payload, fireEventImpl: fireEventImpl as never, now: new Date("2026-09-15T12:01:00Z") }), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.event, "budget_alert");
  assert.equal(calls[0]?.subjectId, "campaign-1:2026-09-09:2026-09-15");
  assert.equal(calls[0]?.threshold, "80%");
  assert.equal(calls[0]?.spend, "A$112");
  assert.equal(calls[0]?.budget, "A$140 per week");
  assert.deepEqual(updates, [{
    budget_alert_period_key: "2026-09-09:2026-09-15",
    budget_alerted_at: "2026-09-15T12:00:00.000Z",
  }]);
});

test("budget alert ignores noncanonical reporting ranges", async () => {
  const payload = monitorPayload("last_30", 600);
  const service = { from() { throw new Error("range gate must run before storage"); } };
  assert.equal(await queueBudgetAlerts({ serviceSupabase: service as never, workspaceId: "workspace-1", payload }), 0);
});

test("budget calculation deduplicates a shared ad set budget", () => {
  const result = campaignPeriodSpendAndBudget({
    ads: [ad("ad-1", 60), ad("ad-2", 52)],
    campaignId: "campaign-1",
    periodDays: 7,
    plan: null,
  });
  assert.deepEqual(result, {
    spendMinorUnits: 11_200,
    periodBudgetMinorUnits: 14_000,
    weeklyBudgetMinorUnits: 14_000,
  });
});

test("budget marker migration is additive and workspace-fenced callers persist by workspace and plan", () => {
  const sql = readFileSync("supabase/migrations/20260915120000_meta_publish_budget_alert_marker.sql", "utf8");
  const source = readFileSync("src/lib/meta-monitor/budget-alert.ts", "utf8");
  assert.match(sql, /alter table public\.meta_publish_plans[\s\S]*add column if not exists budget_alert_period_key text/i);
  assert.doesNotMatch(sql, /drop table|disable row level security/i);
  assert.match(source, /\.eq\("workspace_id", input\.workspaceId\)[\s\S]*\.eq\("id", row\.id\)/);
});

test("the publish, reporting, and lead-sync workers call their Mautic event bridges", () => {
  const publish = readFileSync("src/lib/providers/meta-publish-worker.ts", "utf8");
  const reporting = readFileSync("src/lib/meta-monitor/reporting-snapshots.ts", "utf8");
  const leads = readFileSync("src/lib/providers/meta-leads-worker.ts", "utf8");
  assert.match(publish, /await fireCampaignLiveEvent\(\{/);
  assert.match(reporting, /await queueBudgetAlerts\(\{/);
  assert.match(leads, /await queuePendingNewLeadsEvent\(\{/);
});

function contactService() {
  return {
    from(table: string) {
      assert.equal(table, "workspaces");
      return {
        select() {
          return {
            eq(column: string, value: string) {
              assert.equal(column, "id");
              assert.equal(value, "workspace-1");
              return { maybeSingle: async () => ({ data: { billing_email: "owner@example.com" }, error: null }) };
            },
          };
        },
      };
    },
  };
}

function budgetService(plan: Record<string, unknown>, updates: Record<string, unknown>[]) {
  return {
    from(table: string) {
      if (table === "workspaces") return contactService().from(table);
      assert.equal(table, "meta_publish_plans");
      return {
        select() {
          const chain = {
            eq() { return chain; },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({ data: [plan], error: null }).then(resolve);
            },
          };
          return chain;
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          plan.budget_alert_period_key = patch.budget_alert_period_key;
          const chain = {
            eq() { return chain; },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  };
}

function pendingLeadService() {
  let marked = false;
  const service = {
    from(table: string) {
      if (table === "workspaces") return contactService().from(table);
      if (table === "leads") {
        return {
          select() {
            const chain = {
              eq() { return chain; },
              in() { return chain; },
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve({
                  data: [{ id: "lead-1", full_name: "Ada Lovelace", suburb: "Perth", phone: "0400" }],
                  error: null,
                }).then(resolve);
              },
            };
            return chain;
          },
        };
      }
      assert.equal(table, "meta_leads");
      return {
        select() {
          const chain = {
            eq() { return chain; },
            in() { return chain; },
            is() { return chain; },
            order() { return chain; },
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({
                data: marked ? [] : [{ meta_lead_id: "meta-1", lead_id: "lead-1", mautic_batch_key: "batch-1" }],
                error: null,
              }).then(resolve);
            },
          };
          return chain;
        },
        update() {
          const chain = {
            eq() { return chain; },
            in() { return chain; },
            is() {
              marked = true;
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return { service, marked: () => marked };
}

function monitorPayload(key: "last_7" | "last_30", spend: number): MetaMonitorPayload {
  return {
    connected: true,
    source: "live",
    currencyCode: "AUD",
    range: { key, label: key, since: key === "last_7" ? "2026-09-09" : "2026-08-17", until: "2026-09-15", days: key === "last_7" ? 7 : 30 },
    issue: null,
    summary: null,
    daily: [],
    suburbPerformance: [],
    ads: [ad("ad-1", spend)],
  };
}

function ad(adId: string, spend: number): MetaAdPerformance {
  return {
    adId,
    campaignId: "campaign-1",
    campaignName: "Spring appraisal",
    adsetId: "set-1",
    metrics: { spend },
    management: { managedByBlockwise: true, adsetDailyBudgetDollars: 20 },
  } as MetaAdPerformance;
}

function lead(externalId: string, fullName: string, suburb: string, phone: string, email: string) {
  return {
    externalId,
    createdTime: "2026-09-15T00:00:00Z",
    adId: "ad-1",
    adSetId: "set-1",
    campaignId: "campaign-1",
    formId: "form-1",
    email,
    phone,
    fullName,
    suburb,
    rawPayload: { id: externalId },
  };
}
