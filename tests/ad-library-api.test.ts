import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseResearchAd,
  type ResearchAdListRow,
} from "../src/lib/research/ad-library-api.ts";
import { normaliseMediaUrl } from "../src/lib/research/customer-meta-card.ts";

test("normaliseMediaUrl sends images through the renderer, segment-encoded", () => {
  const previousStorageUrl = process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL;
  process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL = "https://hermes.example/";

  try {
    assert.equal(
      normaliseMediaUrl("nested folder/creative #1.png"),
      "https://hermes.example/storage/v1/render/image/public/research-ad-creatives/nested%20folder/creative%20%231.png?width=1024&quality=70&resize=contain",
    );
    assert.equal(normaliseMediaUrl("https://cdn.example/creative #1.png"), "https://cdn.example/creative #1.png");
  } finally {
    restoreEnv("NEXT_PUBLIC_RESEARCH_STORAGE_URL", previousStorageUrl);
  }
});

test("normaliseMediaUrl sends only named images to the image renderer", () => {
  // The renderer answers 400 for an mp4 (measured on the live 10,382,027 B
  // sample), and the archive keeps images and videos together under
  // extension-free `sha256/<hash>` keys, so a path that does not name an image
  // type must keep the object URL it has always had.
  const previousStorageUrl = process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL;
  process.env.NEXT_PUBLIC_RESEARCH_STORAGE_URL = "https://hermes.example";
  const object = (path: string) =>
    `https://hermes.example/storage/v1/object/public/research-ad-creatives/${path}`;

  try {
    for (const raw of [
      "media-blobs/creative.mp4",
      "media-blobs/creative.MOV",
      "media-blobs/clip.webm",
      "email/video-294b2970.mp4",
      // Extension-free archive key: images and videos share this shape, so the
      // renderer is never asked for one.
      "sha256/4cfd25421637e08efa69efe98736d61008951c4d2e05b033e5a849bc9951eb69",
      "media-blobs/no-extension",
    ]) {
      assert.equal(normaliseMediaUrl(raw), object(raw), `${raw} must stay on the object path`);
    }
    for (const image of [
      "media-blobs/0a9bd4778ba61fd2c56af31eceeb4bf7deeea7c9ff01664db29f2f5c215ea33a.jpg",
      "media-blobs/poster.mp4.jpg",
      "email/00238b95de429a5b5613e2fc9978526d5b9f6a53bee413b9a7a80948604fc26d.jpg",
    ]) {
      assert.match(normaliseMediaUrl(image) ?? "", /\/render\/image\/public\//, `${image} should render`);
    }
    assert.match(normaliseMediaUrl("crew/photo.PNG") ?? "", /\/render\/image\/public\//);
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
          url: "https://hermes.example/storage/v1/render/image/public/research-ad-creatives/images/hero%20creative.png?width=1024&quality=70&resize=contain",
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
          url: "https://hermes.example/storage/v1/render/image/public/research-ad-creatives/thumbs/listing%20tour%20%232.jpg?width=1024&quality=70&resize=contain",
          storagePath: "thumbs/listing tour #2.jpg",
          sourceUrl: null,
        },
        {
          kind: "image",
          url: "https://hermes.example/storage/v1/render/image/public/research-ad-creatives/gallery/front%20elevation.jpg?width=1024&quality=70&resize=contain",
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
