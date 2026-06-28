import assert from "node:assert/strict";
import test from "node:test";

import { safeRate } from "../../src/lib/meta-monitor/calculations.ts";
import { buildSampleMetaMonitorPayload } from "../../src/lib/meta-monitor/sampleMetaMonitorData.ts";
import {
  parseSuburbFromAdsetName,
  parseSuburbFromCampaignName,
  resolveSuburb,
} from "../../src/lib/meta-monitor/suburbAttribution.ts";

test("sample payload is internally consistent for the 30-day range", () => {
  const payload = buildSampleMetaMonitorPayload({ range: "last_30", now: new Date("2026-06-04T10:00:00+10:00") });
  const summary = payload.summary;

  assert.ok(summary);
  assert.equal(summary.spend, 5940);
  assert.ok(summary.reach > 0);
  assert.equal(summary.leads, 176);
  assert.equal(summary.validLeads, 118);

  const dailySpend = payload.daily.reduce((total, point) => total + point.spend, 0);
  const dailyReach = payload.daily.reduce((total, point) => total + point.reach, 0);
  const dailyImpressions = payload.daily.reduce((total, point) => total + point.impressions, 0);
  const dailyClicks = payload.daily.reduce((total, point) => total + point.clicks, 0);
  const dailyValid = payload.daily.reduce((total, point) => total + point.validLeads, 0);
  const dailyLeads = payload.daily.reduce((total, point) => total + point.leads, 0);

  assert.equal(dailySpend, summary.spend);
  assert.equal(dailyReach, summary.reach);
  assert.equal(dailyImpressions, summary.impressions);
  assert.equal(dailyClicks, summary.clicks);
  assert.equal(dailyValid, summary.validLeads);
  assert.equal(dailyLeads, summary.leads);

  const adSpend = payload.ads.reduce((total, ad) => total + ad.metrics.spend, 0);
  const adReach = payload.ads.reduce((total, ad) => total + ad.metrics.reach, 0);
  const adValid = payload.ads.reduce((total, ad) => total + ad.metrics.validLeads, 0);

  assert.equal(adSpend, summary.spend);
  assert.equal(adReach, summary.reach);
  assert.equal(adValid, summary.validLeads);

  const suburbValid = payload.suburbPerformance.reduce((total, row) => total + row.validLeads, 0);

  assert.equal(suburbValid, summary.validLeads);
});

test("sample payload never plots a fake $0 CPL on zero-valid-lead days", () => {
  const payload = buildSampleMetaMonitorPayload({ range: "last_30" });

  for (const point of payload.daily) {
    if (point.validLeads === 0) {
      assert.equal(point.validCpl, null);
    } else {
      assert.equal(point.validCpl, point.spend / point.validLeads);
    }

    assert.ok(point.leads >= point.validLeads);
    assert.equal(point.ctr, safeRate(point.clicks, point.impressions));
  }
});

test("sample payload scales to shorter ranges without breaking invariants", () => {
  for (const range of ["last_7", "yesterday"] as const) {
    const payload = buildSampleMetaMonitorPayload({ range });
    const summary = payload.summary;

    assert.ok(summary);
    assert.equal(payload.daily.length, payload.range.days);
    assert.equal(summary.spend, payload.daily.reduce((total, point) => total + point.spend, 0));
    assert.ok(summary.leads >= summary.validLeads);

    for (const ad of payload.ads) {
      assert.ok(ad.metrics.leads >= ad.metrics.validLeads);
      assert.equal(typeof ad.management.managedByBlockwise, "boolean");
      assert.ok(ad.management.adsetDailyBudgetDollars == null || ad.management.adsetDailyBudgetDollars > 0);
    }
  }
});

test("suburb resolution follows the priority chain", () => {
  assert.equal(
    resolveSuburb({ leadSuburb: "Epping", adsetName: "Suburb - Carlingford" }),
    "Epping",
  );
  assert.equal(
    resolveSuburb({ leadSuburb: null, blockwiseSuburbMapping: "Subiaco", adsetName: "Suburb - Carlingford" }),
    "Subiaco",
  );
  assert.equal(resolveSuburb({ adsetName: "Suburb - Carlingford" }), "Carlingford");
  assert.equal(
    resolveSuburb({ adsetName: "Retargeting AU", campaignName: "Suburb Appraisal - Parramatta" }),
    "Parramatta",
  );
  assert.equal(resolveSuburb({ adsetName: "Broad AU", campaignName: "Lead Gen AU" }), null);
});

test("suburb name parsing handles convention variants and rejects junk", () => {
  assert.equal(parseSuburbFromAdsetName("Suburb - North Ryde"), "North Ryde");
  assert.equal(parseSuburbFromAdsetName("suburb – West Ryde"), "West Ryde");
  assert.equal(parseSuburbFromAdsetName("Suburb: Meadowbank"), "Meadowbank");
  assert.equal(parseSuburbFromAdsetName("Lookalike 1%"), null);
  assert.equal(parseSuburbFromAdsetName(null), null);
  assert.equal(parseSuburbFromCampaignName("Suburb Appraisal - Eastwood"), "Eastwood");
  assert.equal(parseSuburbFromCampaignName("Brand Awareness"), null);
});

test("leads marked Unlabelled or unknown suburbs never invent suburb rows", () => {
  const payload = buildSampleMetaMonitorPayload({ range: "last_30" });

  for (const row of payload.suburbPerformance) {
    assert.notEqual(row.suburb.toLowerCase(), "unknown");
    assert.ok(row.validLeads > 0);
  }
});
