import assert from "node:assert/strict";
import test from "node:test";

import { extractMetaLeadCount, normalizeMetaInsightRows } from "../src/lib/providers/meta-reporting.ts";
import { normalizeGoogleAdsRows } from "../src/lib/providers/google-reporting.ts";

test("Meta lead actions are normalized into lead counts", () => {
  assert.equal(
    extractMetaLeadCount([
      { action_type: "link_click", value: "42" },
      { action_type: "lead", value: "7" },
      { action_type: "onsite_conversion.lead_grouped", value: "3" },
    ]),
    10,
  );
});

test("Meta insight rows normalize spend, clicks, leads, and valid lead placeholders", () => {
  const report = normalizeMetaInsightRows([
    {
      ad_id: "ad_1",
      ad_name: "Seller report",
      campaign_id: "camp_1",
      campaign_name: "Suburb pulse",
      spend: "120.50",
      impressions: "1000",
      clicks: "80",
      actions: [{ action_type: "lead", value: "6" }],
      date_start: "2026-05-27",
    },
  ]);

  assert.equal(report.metrics.spendAud, 120.5);
  assert.equal(report.metrics.leads, 6);
  assert.equal(report.metrics.validLeads, 4);
  assert.equal(report.rows[0].validCplAud, 30.13);
});

test("Google Ads rows normalize micros, conversions, CTR, and campaign labels", () => {
  const report = normalizeGoogleAdsRows([
    {
      campaign: { id: "123", name: "Appraisal search" },
      adGroup: { id: "456", name: "Subiaco" },
      metrics: {
        costMicros: "50000000",
        impressions: "2000",
        clicks: "100",
        conversions: 12,
        ctr: 0.05,
        averageCpc: 500000,
      },
      segments: { date: "2026-05-27" },
    },
  ]);

  assert.equal(report.metrics.spendAud, 50);
  assert.equal(report.metrics.clicks, 100);
  assert.equal(report.metrics.leads, 12);
  assert.equal(report.rows[0].name, "Appraisal search / Subiaco");
  assert.equal(report.rows[0].ctr, 0.05);
  assert.equal(report.rows[0].cpcAud, 0.5);
});
