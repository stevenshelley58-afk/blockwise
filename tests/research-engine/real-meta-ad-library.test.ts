import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normaliseMetaAdLibraryAd } from "../../src/modules/research/normalise.ts";
import { metaAdLibraryDatasetSchema } from "../../src/modules/research/schemas/index.ts";

const REAL_FIXTURE = "tests/research-engine/fixtures-meta-ad-library-real.json";

test("real Meta Ad Library payload parses against zod schema", () => {
  const raw = JSON.parse(readFileSync(REAL_FIXTURE, "utf8"));
  const parsed = metaAdLibraryDatasetSchema.parse(raw);
  assert.ok(parsed.length > 0, "expected at least one ad in real fixture");
});

test("real Meta Ad Library payload normalises to a valid ObservedAdIngestInput", () => {
  const raw = JSON.parse(readFileSync(REAL_FIXTURE, "utf8"));
  const ads = metaAdLibraryDatasetSchema.parse(raw);
  const ad = ads[0]!;

  const { observation, creative, payloadHash } = normaliseMetaAdLibraryAd({
    ad,
    advertiserPageId: "11111111-1111-1111-1111-111111111111",
    observedByProvider: "self_hosted_meta",
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
  const ads = metaAdLibraryDatasetSchema.parse(raw);
  let normalised = 0;
  for (const ad of ads) {
    const r = normaliseMetaAdLibraryAd({
      ad,
      advertiserPageId: "11111111-1111-1111-1111-111111111111",
      observedByProvider: "self_hosted_meta",
    });
    assert.ok(r.observation.externalAdId);
    normalised += 1;
  }
  assert.equal(normalised, ads.length);
});
