import { creativeHash, payloadHash } from "./hash.ts";
import {
  type ApifyMetaAd,
  type ObservedAdIngestInput,
  type SourceProvider,
  deriveActiveStatus,
  extractExternalAdId,
} from "./schemas/index.ts";

/**
 * Normalise an Apify Meta Ad payload into our internal ingestion shape.
 *
 * This function is PURE — no IO, no DB, no clock. The caller passes in
 * the source provider and the page row id; we produce a structured row
 * the ingestion worker can hand to the writer.
 *
 * Throws on payloads missing every known external_ad_id field. Callers
 * MUST catch and write a soft-failure into ad_fetch_runs.result_summary
 * (warnings + error_count) rather than aborting the whole run.
 */
export function normaliseApifyAd(input: {
  ad: ApifyMetaAd;
  advertiserPageId: string;
  observedByProvider: SourceProvider;
}): { observation: ObservedAdIngestInput; creative: NormalisedCreative; payloadHash: string } {
  const { ad, advertiserPageId, observedByProvider } = input;

  const externalAdId = extractExternalAdId(ad);
  const activeStatus = deriveActiveStatus(ad);

  // Pull the creative fields from the most common shapes:
  // - ad.snapshot.{body,title,cta_*,link_url,image_url,video_*}
  // - first element of ad.cards
  // - top-level ad.{body,title,cta_text,link_url,image_url,video_*}
  const card = ad.snapshot ?? ad.cards?.[0] ?? {};
  const headline = card.title ?? ad.title ?? null;
  const body = card.body ?? ad.body ?? null;
  const cta = card.cta_text ?? card.cta_type ?? ad.cta_text ?? ad.cta_type ?? null;
  const ctaUrl = card.link_url ?? ad.link_url ?? null;
  const primaryImageUrl = card.image_url ?? ad.image_url ?? null;
  const videoUrl = card.video_hd_url ?? card.video_sd_url ?? ad.video_hd_url ?? ad.video_sd_url ?? null;
  const videoThumbnailUrl = card.video_preview_image_url ?? null;
  const landingUrl = card.link_url ?? ad.link_url ?? null;

  const platforms = ad.publisher_platform ?? ad.platforms ?? [];
  const platform = pickPlatform(platforms);

  const observation: ObservedAdIngestInput = {
    externalAdId,
    advertiserPageId,
    observedByProvider,
    platform,
    activeStatus,
    metaPublisherPlatforms: platforms.map((p) => p.toLowerCase()),
    adDeliveryStartedAt: ad.start_date ?? ad.started_at ?? null,
    adDeliveryStoppedAt: ad.end_date ?? ad.stopped_at ?? null,
    adCreationDate: pickIsoDate(ad.creation_time),
    rawPayload: ad as unknown as Record<string, unknown>,
    metadata: {
      pageId: ad.page_id !== undefined ? String(ad.page_id) : null,
      pageName: ad.page_name ?? null,
    },
  };

  const creative: NormalisedCreative = {
    format: deriveFormat({ primaryImageUrl, videoUrl, cards: ad.cards }),
    headline,
    body,
    cta,
    ctaUrl,
    primaryImageUrl,
    imageUrls: collectImageUrls(ad),
    videoUrl,
    videoThumbnailUrl,
    landingUrl,
    locale: ad.locales?.[0] ?? null,
    language: ad.languages?.[0] ?? null,
    creativeHash: creativeHash({ headline, body, primaryImageUrl, videoUrl, ctaUrl }),
  };

  return { observation, creative, payloadHash: payloadHash(observation.rawPayload) };
}

export type NormalisedCreative = {
  format: "image" | "video" | "carousel" | "dco" | "unknown";
  headline: string | null;
  body: string | null;
  cta: string | null;
  ctaUrl: string | null;
  primaryImageUrl: string | null;
  imageUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  landingUrl: string | null;
  locale: string | null;
  language: string | null;
  creativeHash: string;
};

function pickPlatform(
  platforms: string[],
): "facebook" | "instagram" | "audience_network" | "messenger" | "unknown" {
  const normalised = platforms.map((p) => p.toLowerCase());
  if (normalised.includes("facebook")) return "facebook";
  if (normalised.includes("instagram")) return "instagram";
  if (normalised.includes("messenger")) return "messenger";
  if (normalised.includes("audience_network")) return "audience_network";
  return "unknown";
}

function pickIsoDate(value: string | number | undefined | null): string | null {
  if (!value && value !== 0) return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/u);
    return match ? match[1] : null;
  }
  const ms = value > 1e12 ? value : value * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function deriveFormat(input: {
  primaryImageUrl: string | null;
  videoUrl: string | null;
  cards: ApifyMetaAd["cards"];
}): "image" | "video" | "carousel" | "dco" | "unknown" {
  if (input.cards && input.cards.length > 1) return "carousel";
  if (input.videoUrl) return "video";
  if (input.primaryImageUrl) return "image";
  return "unknown";
}

function collectImageUrls(ad: ApifyMetaAd): string[] {
  const out = new Set<string>();
  if (ad.image_url) out.add(ad.image_url);
  if (ad.snapshot?.image_url) out.add(ad.snapshot.image_url);
  for (const card of ad.cards ?? []) {
    if (card.image_url) out.add(card.image_url);
  }
  return [...out];
}
