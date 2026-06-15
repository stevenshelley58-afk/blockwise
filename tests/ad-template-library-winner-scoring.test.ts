import assert from "node:assert/strict";
import test from "node:test";

import {
  WINNER_THRESHOLD,
  buildClusterKey,
  buildTemplateDraftsFromWinners,
  calculateObjectiveScore,
  calculateOwnedPerformanceScore,
  deriveTemplateKey,
  isScoringEligible,
  normalizeCopyForDedupe,
  scoreWinnerCandidate,
  type WinnerCandidate,
  type WinnerForMining,
} from "../src/lib/ad-template-library/winner-scoring.ts";
import type { CreativeSkeleton } from "../src/lib/ad-template-library/skeleton.ts";

const now = new Date("2026-06-13T00:00:00.000Z");

function candidate(overrides: Partial<WinnerCandidate> = {}): WinnerCandidate {
  return {
    observedAdId: "ad-1",
    adCreativeId: "creative-1",
    advertiserPageId: "advertiser-1",
    advertiserName: "Ray White Perth",
    adType: "market_update",
    primaryIntent: "seller_leads",
    format: "carousel",
    headline: "Perth Market Update",
    body: "Get your free Perth suburb market report and learn what local buyer demand means for your property.",
    cta: "Learn More",
    primaryImageUrl: "https://example.com/image.jpg",
    videoUrl: null,
    creativeHash: "hash-1",
    classification: { is_real_estate_ad: true, category: "market_update", country: "AU" },
    firstSeenAt: "2025-06-13T00:00:00.000Z",
    lastSeenAt: "2026-06-10T00:00:00.000Z",
    deliveryStartedAt: "2025-06-13T00:00:00.000Z",
    deliveryStoppedAt: null,
    isActive: true,
    creativeVersions: 10,
    crossAgencyCount: 3,
    ...overrides,
  };
}

function winner(overrides: Partial<WinnerForMining> = {}): WinnerForMining {
  const base = candidate(overrides);
  return {
    ...base,
    compositeScore: 82,
    objectiveScore: 78,
    scorerVersion: "winner-scorer-v1",
    rationale: "test rationale",
    ...overrides,
  };
}

function skeleton(overrides: Partial<CreativeSkeleton> = {}): CreativeSkeleton {
  return {
    version: 1,
    archetype: "market_stat",
    shot: { type: "suburb street", lighting: "clean daylight", mood: "practical authority" },
    composition: {
      focal_point: "street scene behind copy panel",
      horizon: "middle",
      copy_safe_zones: [{ id: "panel", x: 0.1, y: 0.12, width: 0.5, height: 0.5, priority: "primary" }],
    },
    color: { palette: ["navy", "white"], overlay: "white panel", contrast: "high" },
    text_system: { headline_zone: "left panel", badge: "market update", cta_style: "text link" },
    copy: { hook_style: "market update", headline_pattern: "{suburb} market snapshot", cta: "Get the report" },
    variables: ["suburb"],
    confidence: 90,
    ...overrides,
  };
}

test("calculateObjectiveScore applies deterministic weights", () => {
  const score = calculateObjectiveScore(candidate(), now);

  assert.equal(score.longevityDays, 365);
  assert.equal(score.signals.longevity, 40);
  assert.equal(score.signals.active, 15);
  assert.equal(score.signals.iteration, 20);
  assert.equal(score.signals.recency, 10);
  assert.equal(score.signals.copyCompleteness, 15);
  assert.equal(score.score, 100);
});

test("scoreWinnerCandidate thresholds winners at market relevant composite >= threshold", () => {
  const scored = scoreWinnerCandidate(candidate(), now);

  assert.equal(scored.review.marketRelevant, true);
  assert.equal(scored.isWinner, scored.compositeScore >= WINNER_THRESHOLD);
  assert.ok(scored.compositeScore >= WINNER_THRESHOLD);
});

test("scoreWinnerCandidate blocks overseas market copy even with strong objective signals", () => {
  const scored = scoreWinnerCandidate(
    candidate({
      headline: "Costa del Sol villas",
      body: "Luxury Marbella property investment with prices in euros. Learn more about Estepona homes.",
      classification: { is_real_estate_ad: true, country: "ES" },
    }),
    now,
  );

  assert.equal(scored.review.marketRelevant, false);
  assert.equal(scored.isWinner, false);
  assert.ok(scored.review.warnings.includes("market_relevance_gate_failed"));
});

test("isScoringEligible filters missing body, placeholders, and non-real-estate classification", () => {
  assert.equal(isScoringEligible(candidate()), true);
  assert.equal(isScoringEligible(candidate({ body: " " })), false);
  assert.equal(isScoringEligible(candidate({ headline: "Hello {{suburb}}" })), false);
  assert.equal(isScoringEligible(candidate({ classification: { industry: "restaurant" }, adType: "food", primaryIntent: "bookings" })), false);
});

test("normalizeCopyForDedupe ignores digits and common location/property tokens", () => {
  const left = normalizeCopyForDedupe({ headline: "Perth Property Update 2026", body: "Prices up 12.4% in Perth homes" });
  const right = normalizeCopyForDedupe({ headline: "WA Home Update 2025", body: "Prices up 8% in Western Australia property" });

  assert.equal(left, right);
});

test("buildTemplateDraftsFromWinners dedupes creative hash and caps one advertiser per cluster", () => {
  const drafts = buildTemplateDraftsFromWinners(
    [
      winner({ observedAdId: "ad-1", advertiserPageId: "adv-a", creativeHash: "same", compositeScore: 91 }),
      winner({ observedAdId: "ad-2", advertiserPageId: "adv-a", creativeHash: "different", compositeScore: 90 }),
      winner({ observedAdId: "ad-3", advertiserPageId: "adv-b", creativeHash: "same", compositeScore: 89 }),
      winner({
        observedAdId: "ad-4",
        advertiserPageId: "adv-c",
        creativeHash: "unique",
        compositeScore: 88,
        body: "Download the latest Perth property report with recent comparable sales and listing demand.",
      }),
    ],
    { keepPerCluster: 3, maxAdvertiserPerCluster: 1 },
  );

  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].sourceObservedAdIds, ["ad-1", "ad-4"]);
});

test("deriveTemplateKey is stable for the same cluster key", () => {
  const cluster = buildClusterKey(candidate());

  assert.equal(deriveTemplateKey(cluster), deriveTemplateKey(cluster));
  assert.match(deriveTemplateKey(cluster), /^MKT-\d{2}$/);
});

test("buildTemplateDraftsFromWinners produces draft-only template candidate data", () => {
  const [draft] = buildTemplateDraftsFromWinners([winner()], { keepPerCluster: 3 });

  assert.equal(draft.category, "market_update");
  assert.equal(draft.goal, "market_update_leads");
  assert.equal(draft.offerId, "suburb_market_report");
  assert.equal(draft.scorerVersion, "winner-scorer-v1");
  assert.deepEqual(draft.sourceObservedAdIds, ["ad-1"]);
  assert.ok(draft.evidenceScore >= WINNER_THRESHOLD);
});

test("scoreWinnerCandidate blends proven owned performance into composite score", () => {
  const weak = candidate({
    deliveryStartedAt: "2026-06-01T00:00:00.000Z",
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    creativeVersions: 1,
    crossAgencyCount: 1,
  });
  const baseline = scoreWinnerCandidate(weak, now);
  const withPerformance = scoreWinnerCandidate(
    {
      ...weak,
      ownedPerformance: {
        impressions: 2500,
        clicks: 70,
        leads: 8,
        qualifiedLeads: 6,
        spendCents: 60000,
        leadQualityScore: 90,
      },
    },
    now,
  );

  assert.equal(baseline.performanceScore, null);
  assert.ok(withPerformance.performanceScore !== null && withPerformance.performanceScore > 80);
  assert.ok(withPerformance.compositeScore > baseline.compositeScore);
  assert.equal(withPerformance.isWinner, true);
});

test("calculateOwnedPerformanceScore ignores underpowered samples", () => {
  assert.equal(
    calculateOwnedPerformanceScore({
      impressions: 499,
      clicks: 50,
      leads: 10,
      qualifiedLeads: 8,
      spendCents: 20000,
    }),
    null,
  );
});

test("buildTemplateDraftsFromWinners distills skeletons and exemplar ids per cluster", () => {
  const [draft] = buildTemplateDraftsFromWinners(
    [
      winner({ observedAdId: "ad-1", advertiserPageId: "adv-a", creativeHash: "hash-a", creativeSkeleton: skeleton({ confidence: 92 }) }),
      winner({
        observedAdId: "ad-2",
        advertiserPageId: "adv-b",
        creativeHash: "hash-b",
        compositeScore: 80,
        body: "Download the latest Perth property report with recent comparable sales and listing demand.",
        creativeSkeleton: skeleton({
          confidence: 88,
          composition: {
            focal_point: "street scene behind copy panel",
            horizon: "middle",
            copy_safe_zones: [{ id: "panel", x: 0.2, y: 0.2, width: 0.4, height: 0.4, priority: "primary" }],
          },
        }),
      }),
    ],
    { keepPerCluster: 3, maxAdvertiserPerCluster: 1 },
  );

  assert.equal(draft.creativeSkeleton?.archetype, "market_stat");
  assert.equal(draft.creativeSkeleton?.composition.copy_safe_zones[0]?.x, 0.15);
  assert.equal(draft.creativeSkeleton?.confidence, 90);
  assert.deepEqual(draft.exemplarObservedAdIds, ["ad-1", "ad-2"]);
  assert.equal(draft.imageBriefId, `creative-skeleton-${draft.templateKey.toLowerCase()}`);
});
