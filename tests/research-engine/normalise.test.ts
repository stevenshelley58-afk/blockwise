import assert from "node:assert/strict";
import test from "node:test";

import { normaliseApifyAd } from "../../src/lib/research/normalise.ts";
import { adAlpha, adGammaVideo, advertiserPageAlphaId } from "./fixtures.ts";

test("normaliseApifyAd extracts the canonical external_ad_id", () => {
  const { observation } = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  assert.equal(observation.externalAdId, "1101010101010101");
});

test("normaliseApifyAd derives active status from is_active=true", () => {
  const { observation } = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  assert.equal(observation.activeStatus, "active");
});

test("normaliseApifyAd picks facebook over instagram when both are present", () => {
  const { observation } = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  assert.equal(observation.platform, "facebook");
  assert.deepEqual(observation.metaPublisherPlatforms, ["facebook", "instagram"]);
});

test("normaliseApifyAd classifies a video creative as video format", () => {
  const { creative } = normaliseApifyAd({
    ad: adGammaVideo,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  assert.equal(creative.format, "video");
  assert.equal(creative.videoUrl, "https://example.org/video/abc.mp4");
  assert.equal(creative.videoThumbnailUrl, "https://example.org/video/abc-thumb.jpg");
});

test("normaliseApifyAd produces a stable payloadHash regardless of input key order", () => {
  // Reconstruct adAlpha with keys in a different insertion order at every level.
  // The canonical hash MUST be identical because canonicaliseJson sorts keys.
  const snapshot = adAlpha.snapshot!;
  const ad2 = {
    locales: adAlpha.locales,
    languages: adAlpha.languages,
    snapshot: {
      image_url: snapshot.image_url,
      link_url: snapshot.link_url,
      cta_text: snapshot.cta_text,
      body: snapshot.body,
      title: snapshot.title,
    },
    publisher_platform: adAlpha.publisher_platform,
    start_date: adAlpha.start_date,
    is_active: adAlpha.is_active,
    page_name: adAlpha.page_name,
    page_id: adAlpha.page_id,
    ad_archive_id: adAlpha.ad_archive_id,
  };
  const result1 = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const result2 = normaliseApifyAd({
    ad: ad2,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  assert.equal(result1.payloadHash, result2.payloadHash);
});

test("normaliseApifyAd produces a stable creative_hash for identical creative", () => {
  const result1 = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const result2 = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_automly",
  });
  assert.equal(result1.creative.creativeHash, result2.creative.creativeHash);
});

test("normaliseApifyAd throws when the payload has no external_ad_id", () => {
  assert.throws(() =>
    normaliseApifyAd({
      ad: { page_id: "20001" } as never,
      advertiserPageId: advertiserPageAlphaId,
      observedByProvider: "apify_leadsbrary",
    }),
  );
});
