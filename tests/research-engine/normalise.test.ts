import assert from "node:assert/strict";
import test from "node:test";

import { normaliseHostedMetaItems } from "../../hermes/tools/meta-library-capture/src/normalise.ts";
import { normaliseMetaAdLibraryAd } from "../../src/modules/research/normalise.ts";
import { adAlpha, adGammaVideo, advertiserPageAlphaId } from "./fixtures.ts";

test("normaliseMetaAdLibraryAd extracts the canonical external_ad_id", () => {
  const { observation } = normaliseMetaAdLibraryAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  assert.equal(observation.externalAdId, "1101010101010101");
});

test("normaliseMetaAdLibraryAd derives active status from is_active=true", () => {
  const { observation } = normaliseMetaAdLibraryAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  assert.equal(observation.activeStatus, "active");
});

test("normaliseMetaAdLibraryAd picks facebook over instagram when both are present", () => {
  const { observation } = normaliseMetaAdLibraryAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  assert.equal(observation.platform, "facebook");
  assert.deepEqual(observation.metaPublisherPlatforms, ["facebook", "instagram"]);
});

test("normaliseMetaAdLibraryAd classifies a video creative as video format", () => {
  const { creative } = normaliseMetaAdLibraryAd({
    ad: adGammaVideo,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  assert.equal(creative.format, "video");
  assert.equal(creative.videoUrl, "https://example.org/video/abc.mp4");
  assert.equal(creative.videoThumbnailUrl, "https://example.org/video/abc-thumb.jpg");
});

test("normaliseMetaAdLibraryAd produces a stable payloadHash regardless of input key order", () => {
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
  const result1 = normaliseMetaAdLibraryAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  const result2 = normaliseMetaAdLibraryAd({
    ad: ad2,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  assert.equal(result1.payloadHash, result2.payloadHash);
});

test("normaliseMetaAdLibraryAd produces a stable creative_hash for identical creative", () => {
  const result1 = normaliseMetaAdLibraryAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  const result2 = normaliseMetaAdLibraryAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "self_hosted_meta",
  });
  assert.equal(result1.creative.creativeHash, result2.creative.creativeHash);
});

test("normaliseMetaAdLibraryAd throws when the payload has no external_ad_id", () => {
  assert.throws(() =>
    normaliseMetaAdLibraryAd({
      ad: { page_id: "20001" } as never,
      advertiserPageId: advertiserPageAlphaId,
      observedByProvider: "self_hosted_meta",
    }),
  );
});

test("normaliseHostedMetaItems preserves SearchAPI card copy and video assets", () => {
  const { items, warnings } = normaliseHostedMetaItems({
    pageId: "176448086607610",
    limit: 10,
    body: {
      ads: [
        {
          ad_archive_id: "1542733710743662",
          page_id: "176448086607610",
          page_name: "Agenzia Property Investment Strategists",
          is_active: true,
          start_date: 1780080000,
          publisher_platform: ["facebook"],
          snapshot: {
            page_id: "176448086607610",
            page_name: "Agenzia Property Investment Strategists",
            display_format: "DCO",
            cards: [
              {
                body: "Worried about buying the wrong investment? Start with strategy first.",
                title: "We'll Get You a Property in 30 Days With 6-9% Yields",
                cta_text: "Learn More",
                link_url: "http://fb.me/",
                video_hd_url: "https://example.org/agenzia-video.mp4",
                video_preview_image_url: "https://example.org/agenzia-thumb.jpg",
              },
            ],
          },
        },
      ],
    },
  });

  assert.deepEqual(warnings, []);
  const { creative } = normaliseMetaAdLibraryAd({
    ad: items[0]!,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "searchapi_meta",
  });
  assert.equal(creative.body, "Worried about buying the wrong investment? Start with strategy first.");
  assert.equal(creative.headline, "We'll Get You a Property in 30 Days With 6-9% Yields");
  assert.equal(creative.primaryImageUrl, null);
  assert.deepEqual(creative.imageUrls, []);
  assert.equal(creative.videoUrl, "https://example.org/agenzia-video.mp4");
  assert.equal(creative.videoThumbnailUrl, "https://example.org/agenzia-thumb.jpg");
  assert.equal(creative.format, "dco");
});
