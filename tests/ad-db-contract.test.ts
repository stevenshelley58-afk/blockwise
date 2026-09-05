import assert from "node:assert/strict";
import test from "node:test";

import { mediaObjectPath, normaliseAdDbRow } from "../src/lib/research/ad-db.ts";

test("ad DB only emits locally verified archive media routes", () => {
  const record = normaliseAdDbRow({
    id: "ad-1", library_id: "123", advertiser_page_id: "page-1", advertiser_page_meta_id: "42",
    page_name: "Unknown page prospect", active_status: "active", first_seen_at: null, last_seen_at: null,
    last_checked_at: null, ad_delivery_started_at: null, ad_delivery_stopped_at: null, ad_creation_date: null,
    ad_creative_id: null, format: null, headline: null, body: null, cta: null, ad_type: null,
    primary_intent: null, classification: {}, display_state: null, ownership: {}, locations: [],
    media: [
      { id: "asset-ok", kind: "image", storageBucket: "research-ad-creatives", objectKey: "sha256/a", sha256: "a".repeat(64), byteSize: 4, mimeType: "image/jpeg", width: 1, height: 1 },
      { id: "asset-unverified", kind: "image", storageBucket: "", objectKey: "", sha256: "source-url", byteSize: 0, mimeType: "", width: null, height: null },
    ],
  });
  assert.deepEqual((record.media as Array<{ id: string; archiveUrl: string }>), [{ id: "asset-ok", archiveUrl: "/v1/ad-db/ads/ad-1/media/asset-ok", sha256: "a".repeat(64), byteSize: 4, mimeType: "image/jpeg", width: 1, height: 1, kind: "image" }]);
});

test("ad DB controlled storage path encodes object segments", () => {
  assert.equal(mediaObjectPath({ storageBucket: "research-ad-creatives", objectKey: "sha256/a b" }), "/storage/v1/object/public/research-ad-creatives/sha256/a%20b");
});
