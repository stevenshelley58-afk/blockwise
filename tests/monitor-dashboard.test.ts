import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateValidCpl,
  calculateValidLeadRate,
  normalizeProviderReport,
  resolveMonitorDateRange,
} from "../src/lib/monitor/dashboard-data.ts";

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

test("resolveMonitorDateRange uses the AU dashboard day before UTC rolls over", () => {
  const now = new Date("2026-06-04T16:30:00.000Z");

  assert.deepEqual(resolveMonitorDateRange("today", now), {
    key: "today",
    label: "Today",
    since: "2026-06-05",
    until: "2026-06-05",
    days: 1,
  });
  assert.deepEqual(resolveMonitorDateRange("yesterday", now), {
    key: "yesterday",
    label: "Yesterday",
    since: "2026-06-04",
    until: "2026-06-04",
    days: 1,
  });
  assert.equal(resolveMonitorDateRange("last_7", now).since, "2026-05-30");
  assert.equal(resolveMonitorDateRange("last_30", now).since, "2026-05-07");
});

test("valid lead metrics are zero-safe", () => {
  assert.equal(calculateValidLeadRate(100, 72), 0.72);
  assert.equal(calculateValidLeadRate(0, 0), 0);
  assert.equal(calculateValidCpl(3600, 90), 40);
  assert.equal(calculateValidCpl(3600, 0), 0);
});

test("normalizeProviderReport derives metrics, daily points, and row rates", () => {
  const range = resolveMonitorDateRange("last_7", new Date("2026-05-27T05:30:00.000Z"));

  const report = normalizeProviderReport(
    {
      provider: "meta",
      status: "connected",
      source: "live",
      accountName: "Northstar Meta",
      lastSyncAt: "2026-05-27T04:30:00.000Z",
      metrics: { spendAud: 100, impressions: 1000, clicks: 100, leads: 10, validLeads: 8 },
      rows: [
        {
          id: "row_1",
          provider: "meta",
          type: "ad",
          name: "Suburb pulse",
          campaignName: "Seller lead ads",
          status: "active",
          spendAud: 100,
          impressions: 1000,
          clicks: 100,
          leads: 10,
          validLeads: 8,
          insight: "",
        },
      ],
      creativePreviews: [],
    },
    range,
  );

  assert.equal(report.metrics.validCplAud, 12.5);
  assert.equal(report.metrics.cplAud, 10);
  assert.equal(report.metrics.validLeadRate, 0.8);
  assert.equal(report.daily.length, range.days);
  assert.equal(report.daily.reduce((sum, point) => sum + point.spendAud, 0), 100);
  assert.equal(report.rows[0].ctr, 0.1);
  assert.equal(report.rows[0].cpcAud, 1);
});
