import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMetaLeadCount,
  fetchMetaAdSetEntities,
  fetchMetaInsightRows,
  normalizeMetaInsightRows,
} from "../src/lib/providers/meta-reporting.ts";
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

test("Meta insight rows normalize spend, clicks, and leads without fabricating valid leads", () => {
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
  assert.equal(report.metrics.validLeads, 0);
  assert.equal(report.rows[0].validLeads, 0);
  assert.equal(report.rows[0].validCplAud, 0);
});

test("Meta single-day insight reads use Ads Manager date presets", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));

    return new Response(
      JSON.stringify({
        data: [
          {
            ad_id: "ad_1",
            spend: "0.42",
            reach: "101",
            impressions: "201",
            clicks: "12",
            date_start: "2026-06-05",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const rows = await fetchMetaInsightRows({
      accessToken: "token",
      accountId: "998540809306211",
      since: "2026-06-05",
      until: "2026-06-05",
      datePreset: "today",
    });
    const requestUrl = new URL(urls[0]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.reach, "101");
    assert.equal(rows[0]?.impressions, "201");
    assert.equal(rows[0]?.clicks, "12");
    assert.match(requestUrl.pathname, /\/act_998540809306211\/insights$/);
    assert.equal(requestUrl.searchParams.get("date_preset"), "today");
    assert.equal(requestUrl.searchParams.has("time_range"), false);
    assert.match(requestUrl.searchParams.get("fields") ?? "", /\breach\b/);
    assert.match(requestUrl.searchParams.get("fields") ?? "", /\bimpressions\b/);
    assert.match(requestUrl.searchParams.get("fields") ?? "", /\bclicks\b/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Meta ad set entity reads include daily budget for inline management", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));

    return new Response(
      JSON.stringify({
        data: [
          {
            id: "set_1",
            name: "Seller prep",
            effective_status: "ACTIVE",
            daily_budget: "4000",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const rows = await fetchMetaAdSetEntities({
      accessToken: "token",
      accountId: "998540809306211",
    });
    const requestUrl = new URL(urls[0]);

    assert.equal(rows[0]?.daily_budget, "4000");
    assert.match(requestUrl.pathname, /\/act_998540809306211\/adsets$/);
    assert.match(requestUrl.searchParams.get("fields") ?? "", /\bdaily_budget\b/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
