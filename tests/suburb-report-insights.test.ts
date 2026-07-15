import assert from "node:assert/strict";
import test from "node:test";

import type { PublicAdRadarCard } from "../src/lib/research/public-ad-radar.ts";
import { buildSuburbReportInsights, classifyAd } from "../src/lib/research/suburb-report-insights.ts";

function ad(overrides: Partial<PublicAdRadarCard> = {}): PublicAdRadarCard {
  return {
    id: crypto.randomUUID(),
    pageName: "Example advertiser",
    pageImageUrl: null,
    activeStatus: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: null,
    lastSeenAt: "2026-06-01T00:00:00.000Z",
    durationLabel: "Running 151 days",
    platforms: ["Facebook"],
    postcode: "6160",
    postcodes: ["6160"],
    suburb: "Fremantle",
    state: "WA",
    headline: null,
    body: null,
    description: null,
    cta: null,
    destinationUrl: null,
    destinationDomain: null,
    adType: null,
    media: [],
    ...overrides,
  };
}

test("classifies known categories and uses retail as the fallback", () => {
  assert.equal(classifyAd(ad({ adType: "property appraisal" })), "real estate");
  assert.equal(classifyAd(ad({ headline: "Blocked drain? Call our local plumber" })), "home services");
  assert.equal(classifyAd(ad({ pageName: "Harbour Pizza Bar" })), "hospitality");
  assert.equal(classifyAd(ad({ headline: "Winter jackets now in store" })), "retail & other");
});

test("derives counts, dominance, advertiser count and longest-running ad", () => {
  const ads = [
    ad({ id: "one", pageName: "Agency One", adType: "real estate", startedAt: "2025-12-01T00:00:00.000Z" }),
    ad({ id: "two", pageName: "Agency One", headline: "Free property appraisal" }),
    ad({ id: "three", pageName: "Agency Two", headline: "Open home this Saturday" }),
    ad({ id: "four", pageName: "Local Gym", headline: "Try a fitness class" }),
  ];
  const result = buildSuburbReportInsights(ads, "Fremantle", Date.parse("2026-06-01T00:00:00.000Z"));

  assert.equal(result.categoryCounts["real estate"], 3);
  assert.equal(result.topCategoryShare, 75);
  assert.equal(result.distinctAdvertiserCount, 3);
  assert.equal(result.longestRunningAd?.id, "one");
  assert.equal(result.insights[0].kind, "dominance");
  assert.equal(result.gapConcepts.length, 3);
});

test("returns safe generic insight fallbacks for an empty ad set", () => {
  const result = buildSuburbReportInsights([], "Fremantle");
  assert.equal(result.topCategoryShare, 0);
  assert.equal(result.distinctAdvertiserCount, 0);
  assert.equal(result.longestRunningAd, null);
  assert.match(result.insights[0].body, /No single category/);
});
