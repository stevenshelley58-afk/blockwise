import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "../src/lib/research/customer-meta-card.ts";

test("drops a thumbnail-sized image when the same ad has a captured video", () => {
  const card = normaliseCustomerMetaAdLibraryCard(row({
    card_id: "ray-white-video",
    image_storage_path: "https://cdn.example/tiny-logo.jpg",
    video_storage_path: "https://cdn.example/actual-ad.mp4",
    media_assets: [
      {
        kind: "image",
        url: "https://cdn.example/tiny-logo.jpg",
        byteSize: 902,
        width: 60,
        height: 60,
        captureStatus: "captured",
      },
      {
        kind: "video",
        url: "https://cdn.example/actual-ad.mp4",
        byteSize: 1_200_000,
        captureStatus: "captured",
      },
    ],
  }));

  assert.deepEqual(card.media.map((media) => media.kind), ["video"]);
  assert.match(card.media[0]?.url ?? "", /actual-ad\.mp4$/u);
});

test("drops a dimensionally tiny image even when compression makes it larger than the byte threshold", () => {
  const card = normaliseCustomerMetaAdLibraryCard(row({
    card_id: "oversized-logo-file",
    media_assets: [
      {
        kind: "image",
        url: "https://cdn.example/logo.png",
        byteSize: 8_000,
        width: 80,
        height: 80,
        captureStatus: "captured",
      },
    ],
  }));

  assert.deepEqual(card.media, []);
});

test("keeps a normal captured image", () => {
  const card = normaliseCustomerMetaAdLibraryCard(row({
    card_id: "normal-image",
    media_assets: [
      {
        kind: "image",
        url: "https://cdn.example/ad.jpg",
        byteSize: 85_000,
        width: 1080,
        height: 1080,
        captureStatus: "captured",
      },
    ],
  }));

  assert.equal(card.media.length, 1);
  assert.equal(card.media[0]?.kind, "image");
});

function row(input: Partial<CustomerMetaAdLibraryCardRow> & { card_id: string }): CustomerMetaAdLibraryCardRow {
  return {
    card_id: input.card_id,
    library_id: input.library_id ?? input.card_id,
    page_id: input.page_id ?? null,
    page_name: input.page_name ?? "Agency",
    page_url: input.page_url ?? null,
    page_image_url: input.page_image_url ?? null,
    active_status: input.active_status ?? "active",
    ad_delivery_started_at: input.ad_delivery_started_at ?? null,
    ad_delivery_stopped_at: input.ad_delivery_stopped_at ?? null,
    publisher_platforms: input.publisher_platforms ?? ["facebook"],
    postcode: input.postcode ?? null,
    suburb: input.suburb ?? null,
    state: input.state ?? "WA",
    postcodes: input.postcodes ?? [],
    headline: input.headline ?? null,
    body: input.body ?? null,
    description: input.description ?? null,
    cta: input.cta ?? null,
    cta_url: input.cta_url ?? null,
    destination_url: input.destination_url ?? null,
    primary_image_url: input.primary_image_url ?? null,
    image_urls: input.image_urls ?? [],
    image_storage_path: input.image_storage_path ?? null,
    video_url: input.video_url ?? null,
    video_storage_path: input.video_storage_path ?? null,
    video_thumbnail_url: input.video_thumbnail_url ?? null,
    media_assets: input.media_assets ?? [],
    last_seen_at: input.last_seen_at ?? null,
  };
}
