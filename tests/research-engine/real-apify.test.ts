import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normaliseApifyAd } from "../../src/lib/research/normalise.ts";
import { apifyMetaAdsDatasetSchema } from "../../src/lib/research/schemas/index.ts";

const REAL_FIXTURE = "tests/research-engine/fixtures-apify-real.json";

test("real Apify payload parses against zod schema", () => {
  const raw = JSON.parse(readFileSync(REAL_FIXTURE, "utf8"));
  const parsed = apifyMetaAdsDatasetSchema.parse(raw);
  assert.ok(parsed.length > 0, "expected at least one ad in real fixture");
});

test("real Apify payload normalises to a valid ObservedAdIngestInput", () => {
  const raw = JSON.parse(readFileSync(REAL_FIXTURE, "utf8"));
  const ads = apifyMetaAdsDatasetSchema.parse(raw);
  const ad = ads[0]!;

  const { observation, creative, payloadHash } = normaliseApifyAd({
    ad,
    advertiserPageId: "11111111-1111-1111-1111-111111111111",
    observedByProvider: "apify_scrapers",
  });

  // Core identity
  assert.ok(observation.externalAdId.length > 0, "external_ad_id must be set");
  assert.equal(observation.activeStatus, "active");
  // Real Ray White ad has Facebook + Instagram, both lowercase after normalisation
  assert.ok(observation.metaPublisherPlatforms.includes("facebook"));
  assert.ok(observation.metaPublisherPlatforms.includes("instagram"));
  // Platform falls through to facebook (first wins)
  assert.equal(observation.platform, "facebook");
  // Dates parsed
  assert.ok(observation.adDeliveryStartedAt, "start date must be set");
  // payload hash stable
  assert.equal(payloadHash.length, 64);
  // Creative extracted from the first card (Ray White luxury report)
  assert.ok(creative.headline, `headline missing; got ${JSON.stringify(creative)}`);
  assert.ok(creative.body, `body missing; got ${JSON.stringify(creative)}`);
  assert.ok(creative.creativeHash.length === 64);
});

test("every ad in the real fixture normalises without throwing", () => {
  const raw = JSON.parse(readFileSync(REAL_FIXTURE, "utf8"));
  const ads = apifyMetaAdsDatasetSchema.parse(raw);
  let normalised = 0;
  for (const ad of ads) {
    const r = normaliseApifyAd({
      ad,
      advertiserPageId: "11111111-1111-1111-1111-111111111111",
      observedByProvider: "apify_scrapers",
    });
    assert.ok(r.observation.externalAdId);
    normalised += 1;
  }
  assert.equal(normalised, ads.length);
});
