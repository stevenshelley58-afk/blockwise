import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemoMonitorDashboardBundle,
  calculateValidCpl,
  calculateValidLeadRate,
  mergeProviderReportsWithDemo,
  resolveMonitorDateRange,
} from "../src/modules/monitor/dashboard-data.ts";

test("resolveMonitorDateRange returns inclusive AU dashboard periods", () => {
  const now = new Date("2026-05-27T05:30:00.000Z");

  assert.deepEqual(resolveMonitorDateRange("today", now), {
    key: "today",
    label: "Today",
    since: "2026-05-27",
    until: "2026-05-27",
    days: 1,
  });
  assert.deepEqual(resolveMonitorDateRange("yesterday", now), {
    key: "yesterday",
    label: "Yesterday",
    since: "2026-05-26",
    until: "2026-05-26",
    days: 1,
  });
  assert.equal(resolveMonitorDateRange("last_7", now).since, "2026-05-21");
  assert.equal(resolveMonitorDateRange("last_30", now).since, "2026-04-28");
});

test("valid lead metrics are zero-safe", () => {
  assert.equal(calculateValidLeadRate(100, 72), 0.72);
  assert.equal(calculateValidLeadRate(0, 0), 0);
  assert.equal(calculateValidCpl(3600, 90), 40);
  assert.equal(calculateValidCpl(3600, 0), 0);
});

test("demo dashboard bundle is deterministic and led by valid leads", () => {
  const bundle = buildDemoMonitorDashboardBundle({
    workspaceId: "workspace_demo",
    range: "last_30",
    now: new Date("2026-05-27T05:30:00.000Z"),
  });

  assert.equal(bundle.workspaceId, "workspace_demo");
  assert.equal(bundle.range.key, "last_30");
  assert.equal(bundle.totals.spendAud, 5940);
  assert.equal(bundle.totals.leads, 176);
  assert.equal(bundle.totals.validLeads, 118);
  assert.equal(bundle.totals.validLeadRate, 0.6705);
  assert.equal(bundle.totals.validCplAud, 50.34);
  assert.equal(bundle.providers.map((provider) => provider.provider).join(","), "meta,google");
  assert.equal(bundle.topRows[0].name, "Suburb appraisal pulse");
  assert.equal(bundle.leads.rows.length, 6);
});

test("live provider reports override matching demo provider data without breaking the other provider", () => {
  const demo = buildDemoMonitorDashboardBundle({
    workspaceId: "workspace_demo",
    range: "last_7",
    now: new Date("2026-05-27T05:30:00.000Z"),
  });

  const merged = mergeProviderReportsWithDemo(demo, [
    {
      provider: "meta",
      status: "connected",
      source: "live",
      accountName: "Northstar Meta",
      lastSyncAt: "2026-05-27T04:30:00.000Z",
      metrics: {
        spendAud: 100,
        impressions: 1000,
        clicks: 100,
        leads: 10,
        validLeads: 8,
      },
      daily: [],
      rows: [],
      creativePreviews: [],
    },
  ]);

  const meta = merged.providers.find((provider) => provider.provider === "meta");
  const google = merged.providers.find((provider) => provider.provider === "google");

  assert.equal(meta?.source, "live");
  assert.equal(meta?.metrics.validCplAud, 12.5);
  assert.equal(google?.source, "demo");
  assert.equal(merged.totals.spendAud, 2140);
});
