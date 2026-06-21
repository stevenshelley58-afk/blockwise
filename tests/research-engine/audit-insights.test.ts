import assert from "node:assert/strict";
import test from "node:test";

import type { AdAuditStats } from "../../src/lib/research/ad-audit.ts";
import { buildAuditNarrative, computeAuditSignals } from "../../src/lib/research/audit-insights.ts";

// Sales/boilerplate words that must never appear in the public report copy.
const SALES =
  /\b(campaign|campaigns|trial|proven|winning|crushing|dominating|unlock|ad pack|ad packs|lead machine|no card required|book a call|start free|build my campaign|approve before export)\b/i;

type Advertiser = AdAuditStats["topAdvertisers"][number];
type Count = AdAuditStats["formats"][number];

function adv(name: string, ads: number, active = 0, longest = 0): Advertiser {
  return { name, ads, active, activeRate: ads ? active / ads : 0, longestRunningDays: longest } as unknown as Advertiser;
}
function topAd(pageName: string, daysRunning: number) {
  return { id: pageName + daysRunning, pageName, headline: null, body: null, cta: null, status: "inactive", daysRunning, durationLabel: "", startedAt: null, destinationDomain: null, platforms: [], adType: null };
}
function stats(over: Partial<AdAuditStats> & { totals: AdAuditStats["totals"] }): AdAuditStats {
  return {
    advertiserCount: 0,
    topAdvertisers: [],
    longestRunning: [],
    formats: [] as Count[],
    platforms: [] as Count[],
    adTypes: [] as Count[],
    topCtas: [] as Count[],
    commonHooks: [] as Count[],
    newLast30Days: 0,
    launchesByMonth: [],
    medianDaysRunning: 0,
    longestRunningDays: 0,
    sampleSize: over.totals.detected,
    capped: false,
    ...over,
  } as unknown as AdAuditStats;
}

function narrativeText(n: ReturnType<typeof buildAuditNarrative>): string {
  return [
    n.headline, ...n.snapshot, ...n.dataQuality, ...n.usefulActions, ...n.limitations,
    ...n.blocks.flatMap((b) => [b.title, b.observation, b.interpretation, b.whyItMatters, b.whatNotToAssume, ...b.usefulActions]),
  ].join("\n");
}
function assertComplete(n: ReturnType<typeof buildAuditNarrative>): void {
  for (const b of n.blocks) {
    assert.ok(b.observation.trim() && b.interpretation.trim() && b.whyItMatters.trim() && b.whatNotToAssume.trim(), `${b.id} fields`);
    assert.ok(b.usefulActions.length > 0, `${b.id} actions`);
    assert.ok(["low", "medium", "high"].includes(b.confidence), `${b.id} confidence`);
  }
}
const ids = (n: ReturnType<typeof buildAuditNarrative>) => n.blocks.map((b) => b.id);

test("empty market makes no live-pressure claim and stays caution-first", () => {
  const s = stats({ totals: { detected: 0, active: 0, inactive: 0, activeRate: 0 } });
  const sig = computeAuditSignals(s);
  assert.equal(sig.currentActivityLevel, "none");
  const n = buildAuditNarrative({ label: "Nowhere, WA", stats: s, signals: sig });
  assertComplete(n);
  assert.doesNotMatch(narrativeText(n).toLowerCase(), SALES);
  assert.ok(!narrativeText(n).toLowerCase().includes("competitors are buying"));
  assert.ok(ids(n).includes("no-active-ads"));
  assert.ok(n.limitations.length >= 3);
});

test("6166-like: 24 detected, 0 active, recent burst is read correctly", () => {
  const s = stats({
    totals: { detected: 24, active: 0, inactive: 24, activeRate: 0 },
    advertiserCount: 5, newLast30Days: 21,
    topAdvertisers: [adv("Acton A", 5), adv("Harcourts B", 5), adv("Ray White C", 5), adv("LJ Hooker D", 5), adv("Belle E", 4)],
    adTypes: [{ label: "Just Listed", count: 12 }, { label: "Open Home", count: 12 }],
    formats: [{ label: "Image", count: 24 }],
    longestRunning: [topAd("Acton A", 50)], longestRunningDays: 50,
  });
  const sig = computeAuditSignals(s);
  assert.equal(sig.currentActivityLevel, "none");
  assert.equal(sig.recentActivityPattern, "recent_burst_now_paused");
  assert.equal(sig.messagePattern, "listing_led");
  const n = buildAuditNarrative({ label: "6166", stats: s, signals: sig });
  assertComplete(n);
  assert.doesNotMatch(narrativeText(n).toLowerCase(), SALES);
  assert.ok(ids(n).includes("no-active-ads") && ids(n).includes("recent-burst"));
  assert.ok(n.snapshot.join(" ").includes("30 days"));
});

test("Fremantle-like: 74 detected, 1 active reads as low activity, not crowded", () => {
  const s = stats({
    totals: { detected: 74, active: 1, inactive: 73, activeRate: 1 / 74 },
    advertiserCount: 6, newLast30Days: 5,
    topAdvertisers: [adv("Acton Freo", 13, 1, 220), adv("Caporn", 13), adv("Mont", 12), adv("Dethridge", 12), adv("Yard", 12), adv("Limnios", 12)],
    adTypes: [{ label: "Free Appraisal", count: 74 }],
    formats: [{ label: "Image", count: 74 }],
    longestRunning: [topAd("Acton Freo", 220)], longestRunningDays: 220,
  });
  const sig = computeAuditSignals(s);
  assert.equal(sig.currentActivityLevel, "low");
  assert.equal(sig.messagePattern, "appraisal_led");
  const n = buildAuditNarrative({ label: "Fremantle", stats: s, signals: sig });
  assertComplete(n);
  assert.doesNotMatch(narrativeText(n).toLowerCase(), SALES);
  assert.ok(ids(n).includes("angle-saturation") && ids(n).includes("many-advertisers-low-active"));
  assert.ok(n.snapshot.join(" ").includes("1 active"));
});

test("one dominant advertiser is flagged, not read as broad pressure", () => {
  const s = stats({
    totals: { detected: 20, active: 10, inactive: 10, activeRate: 0.5 },
    advertiserCount: 9, newLast30Days: 6,
    topAdvertisers: [adv("Big Agency", 12, 8, 40), adv("S1", 1), adv("S2", 1), adv("S3", 1), adv("S4", 1), adv("S5", 1), adv("S6", 1), adv("S7", 1), adv("S8", 1)],
    adTypes: [{ label: "Market Update", count: 8 }, { label: "Just Sold", count: 6 }, { label: "Free Appraisal", count: 6 }],
    formats: [{ label: "Image", count: 10 }, { label: "Video", count: 10 }],
    longestRunning: [topAd("Big Agency", 40)], longestRunningDays: 40,
  });
  const sig = computeAuditSignals(s);
  assert.equal(sig.marketConcentration, "one_dominant_advertiser");
  const n = buildAuditNarrative({ label: "Testville", stats: s, signals: sig });
  assertComplete(n);
  assert.doesNotMatch(narrativeText(n).toLowerCase(), SALES);
  assert.ok(ids(n).includes("one-dominant"));
});
