import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseResearchAd,
  type ResearchAdListRow,
} from "../src/lib/research/ad-library-api.ts";
import { normaliseMediaUrl } from "../src/lib/research/customer-meta-card.ts";

test("normaliseMediaUrl prefixes and segment-encodes storage paths", () => {
  const previousStorageUrl = process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL;
  process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL = "https://hermes.example/";

  try {
    assert.equal(
      normaliseMediaUrl("nested folder/creative #1.png"),
      "https://hermes.example/storage/v1/object/public/research-ad-creatives/nested%20folder/creative%20%231.png",
    );
    assert.equal(normaliseMediaUrl("https://cdn.example/creative #1.png"), "https://cdn.example/creative #1.png");
  } finally {
    restoreEnv("NEXT_PUBLIC_RESEARCH_STORAGE_URL", previousStorageUrl);
  }
});

test("normaliseMediaUrl fails closed without Hermes storage", () => {
  const previousStorageUrl = process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL;
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://managed-project.supabase.co";

  try {
    assert.equal(normaliseMediaUrl("images/hero.png"), null);
    assert.equal(normaliseMediaUrl("https://managed-project.supabase.co/storage/v1/object/public/research-ad-creatives/hero.png"), null);
  } finally {
    restoreEnv("NEXT_PUBLIC_RESEARCH_STORAGE_URL", previousStorageUrl);
    restoreEnv("NEXT_PUBLIC_SUPABASE_URL", previousSupabaseUrl);
  }
});

test("normaliseResearchAd exposes public media URLs for stored creatives", () => {
  const previousStorageUrl = process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL;
  process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL = "https://hermes.example";

  try {
    const ad = normaliseResearchAd(row({
      image_storage_path: "images/hero creative.png",
      video_storage_path: "video/listing tour #2.mp4",
      video_thumbnail_url: "thumbs/listing tour #2.jpg",
      media_assets: [
        {
          kind: "image",
          storagePath: "gallery/front elevation.jpg",
          sourceUrl: "https://cdn.example/front.jpg",
        },
      ],
    }));

    assert.deepEqual(
      ad.media.map((item) => ({ kind: item.kind, url: item.url, storagePath: item.storagePath, sourceUrl: item.sourceUrl })),
      [
        {
          kind: "image",
          url: "https://hermes.example/storage/v1/object/public/research-ad-creatives/images/hero%20creative.png",
          storagePath: "images/hero creative.png",
          sourceUrl: null,
        },
        {
          kind: "video",
          url: "https://hermes.example/storage/v1/object/public/research-ad-creatives/video/listing%20tour%20%232.mp4",
          storagePath: "video/listing tour #2.mp4",
          sourceUrl: null,
        },
        {
          kind: "thumbnail",
          url: "https://hermes.example/storage/v1/object/public/research-ad-creatives/thumbs/listing%20tour%20%232.jpg",
          storagePath: "thumbs/listing tour #2.jpg",
          sourceUrl: null,
        },
        {
          kind: "image",
          url: "https://hermes.example/storage/v1/object/public/research-ad-creatives/gallery/front%20elevation.jpg",
          storagePath: "gallery/front elevation.jpg",
          sourceUrl: "https://cdn.example/front.jpg",
        },
      ],
    );
  } finally {
    restoreEnv("NEXT_PUBLIC_RESEARCH_STORAGE_URL", previousStorageUrl);
  }
});

function row(input: Partial<ResearchAdListRow> = {}): ResearchAdListRow {
  return {
    agency_id: input.agency_id ?? null,
    agency_name: input.agency_name ?? null,
    agent_id: input.agent_id ?? null,
    agent_name: input.agent_name ?? null,
    advertiser_page_id: input.advertiser_page_id ?? "page-1",
    page_name: input.page_name ?? "Agency",
    platform: input.platform ?? "facebook",
    observed_ad_id: input.observed_ad_id ?? "observed-1",
    external_ad_id: input.external_ad_id ?? "123",
    active_status: input.active_status ?? "active",
    first_seen_at: input.first_seen_at ?? null,
    last_seen_at: input.last_seen_at ?? null,
    last_checked_at: input.last_checked_at ?? null,
    headline: input.headline ?? null,
    body: input.body ?? null,
    cta: input.cta ?? null,
    primary_image_url: input.primary_image_url ?? null,
    video_url: input.video_url ?? null,
    format: input.format ?? null,
    classification: input.classification ?? null,
    snapshot_count: input.snapshot_count ?? null,
    ad_delivery_started_at: input.ad_delivery_started_at ?? null,
    ad_delivery_stopped_at: input.ad_delivery_stopped_at ?? null,
    ad_creation_date: input.ad_creation_date ?? null,
    image_urls: input.image_urls ?? [],
    image_storage_path: input.image_storage_path ?? null,
    video_storage_path: input.video_storage_path ?? null,
    video_thumbnail_url: input.video_thumbnail_url ?? null,
    media_assets: input.media_assets ?? [],
    ad_type: input.ad_type ?? null,
    primary_intent: input.primary_intent ?? null,
    display_state: input.display_state ?? null,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
