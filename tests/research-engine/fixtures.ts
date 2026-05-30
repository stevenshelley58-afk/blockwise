import type { MetaAdLibraryAd } from "../../src/lib/research/schemas/index.ts";

/**
 * Hand-built Meta Ad Library payloads that look like real Meta Ad Library responses,
 * pared down to the fields the normaliser cares about. Used by every Phase 1
 * test so behaviour is deterministic and we never call the real collector
 * during unit tests.
 */
export const adAlpha: MetaAdLibraryAd = {
  ad_archive_id: "1101010101010101",
  page_id: "20001",
  page_name: "Acton Cottesloe",
  is_active: true,
  start_date: "2026-05-15T00:00:00Z",
  publisher_platform: ["facebook", "instagram"],
  snapshot: {
    title: "Just listed — 4-bed in Cottesloe",
    body: "Five-minute walk to the beach. Open Saturday 11–11:45.",
    cta_text: "Learn more",
    link_url: "https://acton.com.au/listing/12345",
    image_url: "https://example.org/listings/12345/hero.jpg",
  },
  languages: ["en"],
  locales: ["en_AU"],
};

export const adAlphaBodyChanged: MetaAdLibraryAd = {
  ...adAlpha,
  snapshot: {
    ...adAlpha.snapshot!,
    body: "Open Saturday 11–11:45 only. Price guide updated.",
  },
};

export const adBeta: MetaAdLibraryAd = {
  ad_archive_id: "2202020202020202",
  page_id: "20001",
  page_name: "Acton Cottesloe",
  is_active: true,
  start_date: "2026-05-20T00:00:00Z",
  publisher_platform: ["facebook"],
  snapshot: {
    title: "Open home this Sunday",
    body: "Modern 3-bed townhouse, walk to the cafe strip.",
    cta_text: "View listing",
    link_url: "https://acton.com.au/listing/22222",
    image_url: "https://example.org/listings/22222/hero.jpg",
  },
};

export const adGammaVideo: MetaAdLibraryAd = {
  ad_archive_id: "3303030303030303",
  page_id: "20001",
  is_active: true,
  publisher_platform: ["instagram"],
  snapshot: {
    title: "What buyers ACTUALLY want in Cottesloe in 2026",
    body: "Three minutes that will save you $50k.",
    cta_text: "Watch now",
    link_url: "https://acton.com.au/blog/buyer-tips",
    video_hd_url: "https://example.org/video/abc.mp4",
    video_preview_image_url: "https://example.org/video/abc-thumb.jpg",
  },
};

export const advertiserPageAlphaId = "11111111-1111-1111-1111-111111111111";
