import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAdvertiser,
  computeAuditStats,
  partitionRealEstateCards,
  type AdAuditResult,
} from "../../src/lib/research/ad-audit.ts";
import { fallbackAuditSuggestions } from "../../src/lib/research/audit-suggestions.ts";
import type { CustomerMetaAdLibraryCard } from "../../src/lib/research/customer-meta-card.ts";

const NOW = Date.parse("2026-06-21T00:00:00.000Z");
const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function makeCard(overrides: Partial<CustomerMetaAdLibraryCard> & { id: string }): CustomerMetaAdLibraryCard {
  const { id, ...rest } = overrides;
  return {
    id,
    libraryId: null,
    agentId: null,
    agentName: null,
    agencyId: null,
    agencyName: null,
    attributionLinks: [],
    pageId: null,
    pageName: "Unknown page",
    pageUrl: null,
    pageImageUrl: null,
    activeStatus: "active",
    startedAt: null,
    stoppedAt: null,
    lastSeenAt: daysAgo(1),
    platforms: ["Facebook"],
    postcode: "6000",
    suburb: "Perth",
    state: "WA",
    postcodes: ["6000"],
    areaMatchPostcode: "6000",
    areaMatchSuburb: "Perth",
    areaMatchState: "WA",
    areaMatchType: null,
    areaMatchConfidence: null,
    adAreaPostcodes: ["6000"],
    adAreaSuburbs: ["Perth"],
    serviceAreaPostcodes: [],
    serviceAreaSuburbs: [],
    headline: null,
    body: null,
    description: null,
    cta: null,
    destinationUrl: null,
    media: [],
    ...rest,
  };
}

const SAMPLE: CustomerMetaAdLibraryCard[] = [
  makeCard({ id: "a1", pageName: "Agency A", agencyName: "Agency A", headline: "Free appraisal for your home", body: "Body A", startedAt: daysAgo(100), activeStatus: "active", cta: "Learn More" }),
  makeCard({ id: "a1b", pageName: "Agency A", agencyName: "Agency A", headline: "Free appraisal for your home", body: "Body A", startedAt: daysAgo(100), activeStatus: "active", cta: "Learn More" }),
  makeCard({ id: "a2", pageName: "Agency A", agencyName: "Agency A", headline: "Just listed in your suburb", startedAt: daysAgo(10), stoppedAt: daysAgo(5), activeStatus: "inactive" }),
  makeCard({ id: "b1", pageName: "Agency B", agencyName: "Agency B", headline: "Market update for buyers", startedAt: daysAgo(300), activeStatus: "active", platforms: ["Facebook", "Instagram"] }),
];

test("computeAuditStats returns a clean empty audit", () => {
  const stats = computeAuditStats([], { now: NOW });
  assert.equal(stats.totals.detected, 0);
  assert.equal(stats.totals.activeRate, 0);
  assert.equal(stats.advertiserCount, 0);
  assert.deepEqual(stats.longestRunning, []);
  assert.equal(stats.longestRunningDays, 0);
});

test("computeAuditStats totals and active rate", () => {
  const stats = computeAuditStats(SAMPLE, { now: NOW });
  assert.equal(stats.totals.detected, 4);
  assert.equal(stats.totals.active, 3);
  assert.equal(stats.totals.inactive, 1);
  assert.equal(Math.round(stats.totals.activeRate * 100), 75);
});

test("computeAuditStats ranks advertisers by ad volume", () => {
  const stats = computeAuditStats(SAMPLE, { now: NOW });
  assert.equal(stats.advertiserCount, 2);
  const top = stats.topAdvertisers[0];
  assert.equal(top.name, "Agency A");
  assert.equal(top.ads, 3);
  assert.equal(top.active, 2);
  assert.equal(top.longestRunningDays, 100);
});

test("computeAuditStats surfaces a per-advertiser top angle", () => {
  const stats = computeAuditStats(SAMPLE, { now: NOW });
  const agencyA = stats.topAdvertisers.find((advertiser) => advertiser.name === "Agency A");
  assert.equal(agencyA?.topAngle, "Free Appraisal");
});

test("computeAuditStats dedupes identical creatives in longest-running", () => {
  const stats = computeAuditStats(SAMPLE, { now: NOW });
  assert.equal(stats.longestRunning.length, 3);
  assert.equal(stats.longestRunning[0].pageName, "Agency B");
  assert.equal(stats.longestRunning[0].daysRunning, 300);
  assert.equal(stats.longestRunningDays, 300);
});

test("computeAuditStats infers angle, recency, median and breakdowns", () => {
  const stats = computeAuditStats(SAMPLE, { now: NOW });
  assert.equal(stats.newLast30Days, 1);
  assert.equal(stats.medianDaysRunning, 100);
  assert.equal(stats.formats[0].label, "Text");
  assert.equal(stats.platforms.find((p) => p.label === "Facebook")?.count, 4);
  assert.equal(stats.platforms.find((p) => p.label === "Instagram")?.count, 1);
  assert.equal(stats.adTypes.find((t) => t.label === "Free Appraisal")?.count, 2);
});

test("classifyAdvertiser separates real estate from non real estate", () => {
  assert.equal(
    classifyAdvertiser("Nulsen Disability Services", "Supported Independent Living provider. SDA home close to Fremantle."),
    "non_real_estate",
  );
  assert.equal(classifyAdvertiser("Ray White Cottesloe", "Just listed in your suburb"), "real_estate_agency");
  assert.equal(classifyAdvertiser("Mont Property", ""), "real_estate_agency");
  assert.equal(classifyAdvertiser("Airey Real Estate", ""), "real_estate_agency");
  assert.equal(classifyAdvertiser("Verve Buyers Agency", ""), "real_estate_related");
  assert.equal(classifyAdvertiser("Shellabears", "Home open this Saturday. Offers over apply."), "real_estate_related");
  assert.equal(classifyAdvertiser("Joe Smith Plumbing Services", "Blocked drains fixed fast"), "non_real_estate");
  assert.equal(classifyAdvertiser("Some Random Brand", "Generic ad copy with no signal"), "unknown");
});

test("partitionRealEstateCards excludes non real estate advertisers from the stats", () => {
  const cards = [
    makeCard({ id: "re1", pageName: "Ray White Cottesloe", agencyName: "Ray White Cottesloe", headline: "Just listed", startedAt: daysAgo(40), activeStatus: "active" }),
    makeCard({ id: "re2", pageName: "Ray White Cottesloe", agencyName: "Ray White Cottesloe", headline: "Just sold", startedAt: daysAgo(20), activeStatus: "inactive" }),
    makeCard({ id: "nd1", pageName: "Nulsen Disability Services", headline: "Nulsen Disability Services", body: "Supported Independent Living, SDA home", startedAt: daysAgo(39), activeStatus: "active" }),
    makeCard({ id: "nd2", pageName: "Nulsen Disability Services", headline: "Nulsen Disability Services", body: "Disability services and SDA housing", startedAt: daysAgo(10), activeStatus: "active" }),
  ];

  const { included, excludedAdvertisers } = partitionRealEstateCards(cards);
  assert.equal(included.length, 2);
  assert.ok(included.every((card) => (card.agencyName ?? card.pageName) === "Ray White Cottesloe"));
  assert.equal(excludedAdvertisers.length, 1);
  assert.equal(excludedAdvertisers[0].name, "Nulsen Disability Services");
  assert.equal(excludedAdvertisers[0].ads, 2);
  assert.equal(excludedAdvertisers[0].classification, "non_real_estate");

  const stats = computeAuditStats(included, { now: NOW });
  assert.equal(stats.totals.detected, 2);
  assert.equal(stats.totals.active, 1);
  assert.equal(stats.advertiserCount, 1);
  assert.ok(!stats.topAdvertisers.some((advertiser) => advertiser.name.includes("Nulsen")));
});

test("fallbackAuditSuggestions is grounded and complete for a live market", () => {
  const stats = computeAuditStats(SAMPLE, { now: NOW });
  const result: AdAuditResult = {
    location: { query: "Perth", label: "Perth, WA", state: "WA", matched: true },
    generatedAt: new Date(NOW).toISOString(),
    stats,
    topAds: [],
    excludedAdvertisers: [],
  };
  const suggestions = fallbackAuditSuggestions(result);
  assert.ok(suggestions.summary.includes("Perth, WA"));
  assert.ok(suggestions.whatsWorking.length >= 1);
  assert.ok(suggestions.gaps.length >= 1);
  assert.ok(suggestions.recommendedAngles.length >= 2);
  assert.ok(suggestions.quickWins.length >= 1);
  assert.ok(suggestions.whatsWorking.join(" ").includes("Agency B"));
});

test("fallbackAuditSuggestions handles an empty market", () => {
  const result: AdAuditResult = {
    location: { query: "Nowhere", label: "Nowhere, WA", state: "WA", matched: false },
    generatedAt: new Date(NOW).toISOString(),
    stats: computeAuditStats([], { now: NOW }),
    topAds: [],
    excludedAdvertisers: [],
  };
  const suggestions = fallbackAuditSuggestions(result);
  assert.ok(suggestions.summary.toLowerCase().includes("didn't find"));
  assert.ok(suggestions.recommendedAngles.length >= 1);
});
