import assert from "node:assert/strict";
import test from "node:test";

import { buildResultsHierarchy } from "../src/lib/meta-monitor/results-hierarchy.ts";
import type { MetaAdPerformance } from "../src/lib/meta-monitor/types.ts";

test("results hierarchy groups ads by campaign and ad set with aggregate metrics", () => {
  const hierarchy = buildResultsHierarchy([
    ad({ adId: "ad-1", campaignId: "camp-1", adsetId: "set-1", spend: 100, leads: 5, validLeads: 4 }),
    ad({ adId: "ad-2", campaignId: "camp-1", adsetId: "set-1", spend: 50, leads: 3, validLeads: 1 }),
    ad({ adId: "ad-3", campaignId: "camp-1", adsetId: "set-2", spend: 25, leads: 1, validLeads: 1 }),
  ]);

  assert.equal(hierarchy.length, 1);
  assert.equal(hierarchy[0]?.adSets.length, 2);
  assert.equal(hierarchy[0]?.metrics.spend, 175);
  assert.equal(hierarchy[0]?.metrics.leads, 9);
  assert.equal(hierarchy[0]?.metrics.validLeads, 6);
  assert.equal(hierarchy[0]?.metrics.validCpl, 175 / 6);
  assert.equal(hierarchy[0]?.adSets[0]?.metrics.spend, 150);
  assert.deepEqual(hierarchy[0]?.adSets[0]?.ads.map((row) => row.id), ["ad-1", "ad-2"]);
});

test("results hierarchy preserves managed labels, budgets, and fatigue", () => {
  const hierarchy = buildResultsHierarchy([
    ad({ adId: "ad-1", managedByBlockwise: true, budget: 40, fatigued: true }),
    ad({ adId: "ad-2", managedByBlockwise: false, budget: null }),
  ]);
  const campaign = hierarchy[0]!;
  const adSet = campaign.adSets[0]!;

  assert.equal(campaign.managedByBlockwise, true);
  assert.equal(adSet.managedByBlockwise, true);
  assert.equal(adSet.dailyBudgetDollars, 40);
  assert.equal(campaign.fatigued, true);
  assert.equal(adSet.ads[1]?.managedByBlockwise, false);
});

test("results hierarchy handles missing ids and mixed statuses without crashing", () => {
  const hierarchy = buildResultsHierarchy([
    ad({ adId: "ad-1", campaignId: "", campaignName: "Manual campaign", adsetId: "", adsetName: "Manual set", status: "ACTIVE" }),
    ad({ adId: "ad-2", campaignId: "", campaignName: "Manual campaign", adsetId: "", adsetName: "Manual set", status: "PAUSED" }),
  ]);

  assert.equal(hierarchy.length, 1);
  assert.equal(hierarchy[0]?.name, "Manual campaign");
  assert.equal(hierarchy[0]?.status, "MIXED");
  assert.equal(hierarchy[0]?.adSets[0]?.status, "MIXED");
  assert.equal(hierarchy[0]?.adSets[0]?.dailyBudgetDollars, null);
});

function ad(overrides: Partial<{
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  status: MetaAdPerformance["status"];
  spend: number;
  leads: number;
  validLeads: number;
  managedByBlockwise: boolean;
  budget: number | null;
  fatigued: boolean;
}> = {}): MetaAdPerformance {
  const spend = overrides.spend ?? 20;
  const leads = overrides.leads ?? 2;
  const validLeads = overrides.validLeads ?? 1;

  return {
    adId: overrides.adId ?? "ad-1",
    adName: overrides.adName ?? "Seller review video",
    campaignId: overrides.campaignId ?? "camp-1",
    campaignName: overrides.campaignName ?? "Seller campaign",
    adsetId: overrides.adsetId ?? "set-1",
    adsetName: overrides.adsetName ?? "Seller prep",
    suburb: null,
    status: overrides.status ?? "ACTIVE",
    landingPageUrl: null,
    metaPermalinkUrl: null,
    creative: {
      type: "IMAGE",
      thumbnailUrl: null,
      imageUrl: null,
      videoThumbnailUrl: null,
      primaryText: null,
      headline: null,
      description: null,
    },
    metrics: {
      reach: 100,
      spend,
      impressions: 200,
      clicks: 10,
      ctr: 0.05,
      leads,
      validLeads,
      validRate: validLeads / leads,
      validCpl: spend / validLeads,
      frequency: 1.2,
      landingPageViews: null,
    },
    placementBreakdown: [],
    deviceBreakdown: [],
    management: {
      managedByBlockwise: overrides.managedByBlockwise ?? true,
      adsetDailyBudgetDollars: overrides.budget ?? null,
    },
    fatigued: overrides.fatigued ?? false,
  };
}
