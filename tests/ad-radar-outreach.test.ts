import assert from "node:assert/strict";
import test from "node:test";

import {
  adRadarSourceUrl,
  buildAdRadarSnapshot,
  AD_RADAR_SOURCE,
} from "../src/lib/outreach/ad-radar-snapshot.ts";
import {
  buildOutreachEmail,
  configuredMediaOrigins,
  evaluateOutreachEligibility,
  type OutreachProspect,
} from "../src/lib/outreach/postcode-campaign.ts";
import {
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "../src/lib/research/customer-meta-card.ts";

// Read lazily when a creative path is resolved.
process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL ??= "https://blockwise.sale";

const STORAGE_ORIGIN = "https://blockwise.sale";
// Every archived creative is addressed by its content hash.
const ALPHA_HASH = "a".repeat(64);
const BETA_HASH = "b".repeat(64);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function card(overrides: Partial<CustomerMetaAdLibraryCardRow>): CustomerMetaAdLibraryCard {
  return normaliseCustomerMetaAdLibraryCard({
    active_status: "active",
    ad_delivery_started_at: daysAgo(10),
    last_seen_at: daysAgo(1),
    ...overrides,
  } as CustomerMetaAdLibraryCardRow);
}

const area = () => ({ postcode: "6000", coverageLabel: "Perth", suburbs: ["Perth"] });

function prospect(): OutreachProspect {
  return {
    agentName: "Jordan Example",
    agencyName: "Example Personal Realty",
    recordedAgentLocation: "Perth WA",
    postcode: "6000",
    agentPageUrl: "https://www.facebook.com/example-agent",
    agencyPageUrl: "https://www.facebook.com/example-agency",
    contactEmail: "real@example.test",
    advertisingEvidence: {
      status: "recent_ads_observed",
      scanId: "test-prospect-scan",
      scannedAt: daysAgo(1),
      completed: true,
      scopeVerified: true,
      source: AD_RADAR_SOURCE,
      observedAdCount: 1,
    },
    prospectAdExamples: [],
    contactProvenance: { source: "Test fixture", capturedAt: daysAgo(2), verifiedAt: daysAgo(1) },
    consentBasis: "Test fixture",
    consentRecordedAt: daysAgo(1),
    suppressionClear: true,
    sourceRightsConfirmed: true,
    scopeVerified: true,
    dataFreshAt: daysAgo(1),
    isDemo: false,
  };
}

test("every ad radar example carries a dated public source link", () => {
  const { snapshot, summary } = buildAdRadarSnapshot(
    [
      card({ card_id: "a1", library_id: "111", page_name: "Alpha Realty", agency_name: "Alpha Realty", headline: "Open Saturday", ad_type: "listing" }),
      card({ card_id: "a2", library_id: "222", page_name: "Beta Property", agency_name: "Beta Property", headline: "What is it worth?", ad_type: "appraisal" }),
      card({ card_id: "a3", library_id: "333", page_name: "Beta Property", agency_name: "Beta Property", headline: "Meet the team", ad_type: "agency_brand" }),
    ],
    area(),
  );

  assert.equal(snapshot.evidence.status, "recent_ads_observed");
  assert.equal(snapshot.evidence.source, AD_RADAR_SOURCE);
  assert.equal(snapshot.evidence.observedAdCount, 3);
  assert.equal(summary.activeAdCount, 3);
  assert.equal(summary.advertiserCount, 2);
  assert.equal(summary.longestRunningDays, 10);
  assert.deepEqual(summary.advertisers[0], { name: "Beta Property", adCount: 2 });
  assert.equal(snapshot.adExamples.length, 3);
  for (const example of snapshot.adExamples) {
    assert.match(example.sourceUrl ?? "", /^https:\/\/www\.facebook\.com\/ads\/library\/\?id=/u);
    assert.ok(example.observedAt);
  }
  assert.equal(snapshot.adExamples[0]!.category, "listing");
  assert.equal(snapshot.adExamples[1]!.category, "appraisal");
  assert.equal(snapshot.adExamples[2]!.category, "branding");
});

test("an empty area degrades to a successful scan with no ads, never an absence claim", () => {
  const { snapshot, summary } = buildAdRadarSnapshot([], area());
  assert.equal(snapshot.evidence.status, "no_ads_found_after_successful_recent_scan");
  assert.equal(snapshot.evidence.completed, true);
  assert.equal(summary.activeAdCount, 0);
});

test("malformed library ids never become source links", () => {
  assert.equal(adRadarSourceUrl(null), null);
  assert.equal(adRadarSourceUrl("  "), null);
  assert.equal(adRadarSourceUrl("bad id!"), null);
  assert.equal(adRadarSourceUrl("12345"), "https://www.facebook.com/ads/library/?id=12345");
});

test("real Ad Radar creatives render as email derivatives from an allowlisted origin", () => {
  const { snapshot } = buildAdRadarSnapshot(
    [
      card({ card_id: "a1", library_id: "111", page_name: "Alpha Realty", image_storage_path: `sha256/${ALPHA_HASH}`, headline: "Open Saturday" }),
      card({ card_id: "a2", library_id: "222", page_name: "Beta Property", image_storage_path: `media-blobs/${BETA_HASH}.jpg`, headline: "What is it worth?" }),
    ],
    area(),
  );
  const example = snapshot.adExamples[0]!;
  assert.equal(example.mediaRightsConfirmed, true);
  // The resized derivative, never the archive blob, whichever scheme the card recorded.
  assert.equal(example.mediaUrl, `${STORAGE_ORIGIN}/storage/v1/object/public/research-ad-creatives/email/${ALPHA_HASH}.jpg`);
  assert.equal(
    snapshot.adExamples[1]!.mediaUrl,
    `${STORAGE_ORIGIN}/storage/v1/object/public/research-ad-creatives/email/${BETA_HASH}.jpg`,
  );

  const base = { snapshot, prospect: prospect(), reportUrl: "https://blockwise.sale/6000", businessIdentity: "Blockwise", unsubscribeUrl: "https://blockwise.sale/preferences/unsubscribe", now: new Date() };
  assert.match(buildOutreachEmail({ ...base, allowedMediaOrigins: [STORAGE_ORIGIN] }).html, /<img src="https:\/\/blockwise\.sale\/storage\/v1\/object\/public\/research-ad-creatives\/email\//u);
  assert.doesNotMatch(buildOutreachEmail({ ...base, allowedMediaOrigins: [] }).html, /<img /u);
  assert.doesNotMatch(buildOutreachEmail({ ...base, allowedMediaOrigins: ["https://elsewhere.example"] }).html, /<img /u);
});

test("a creative with no content hash carries no email media", () => {
  const { snapshot } = buildAdRadarSnapshot(
    [
      card({ card_id: "a1", library_id: "111", page_name: "Alpha Realty", image_storage_path: "legacy/alpha.png", headline: "Open Saturday" }),
      card({ card_id: "a2", library_id: "222", page_name: "Beta Property", headline: "What is it worth?" }),
    ],
    area(),
  );
  assert.equal(snapshot.adExamples[0]!.mediaUrl, null);
  assert.equal(snapshot.adExamples[0]!.mediaRightsConfirmed, false);
});

test("configured media origins read the env allowlist and drop junk entries", () => {
  assert.deepEqual(
    configuredMediaOrigins({ OUTREACH_MEDIA_ALLOWED_ORIGINS: " https://blockwise.sale ,not a url, https://cdn.example/path " } as unknown as NodeJS.ProcessEnv),
    ["https://blockwise.sale", "https://cdn.example"],
  );
  assert.deepEqual(configuredMediaOrigins({} as unknown as NodeJS.ProcessEnv), []);
});

test("a live ad radar snapshot is eligible for outreach", () => {
  const { snapshot, summary } = buildAdRadarSnapshot(
    [
      card({ card_id: "a1", library_id: "111", page_name: "Alpha Realty", headline: "Open Saturday" }),
      card({ card_id: "a2", library_id: "222", page_name: "Beta Property", headline: "What is it worth?" }),
      card({ card_id: "a3", library_id: "333", page_name: "Gamma Homes", headline: "Meet the team" }),
    ],
    area(),
  );
  const decision = evaluateOutreachEligibility(snapshot, prospect(), new Date());
  assert.equal(decision.eligible, true, decision.reasons.join(", "));

  const email = buildOutreachEmail({
    snapshot,
    prospect: prospect(),
    reportUrl: "https://blockwise.sale/6000",
    businessIdentity: "Blockwise",
    unsubscribeUrl: "https://blockwise.sale/preferences/unsubscribe",
    areaSummary: summary,
    now: new Date(),
  });
  assert.match(email.subject, /I audited every property ad in 6000/u);
  assert.match(email.text, /See full 6000 audit/u);
  assert.match(email.text, /Meta Ad Library/);
  assert.match(email.text, /not confirmed ad targeting/);
});
