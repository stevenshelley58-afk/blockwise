import { creativeHash, payloadHash } from "./hash.ts";
import {
  type ApifyMetaAd,
  type ApifySnapshot,
  type ApifySnapshotCard,
  type ObservedAdIngestInput,
  type SourceProvider,
  deriveActiveStatus,
  extractExternalAdId,
  extractPageId,
  extractPageName,
} from "./schemas/index.ts";

/**
 * Normalise an Apify Meta Ad payload into our internal ingestion shape.
 *
 * Supports both:
 *   - canonical camelCase from apify/facebook-ads-scraper
 *   - snake_case from various community actors (leadsbrary, automly, ...)
 *
 * Pure: no IO, no DB, no clock.
 */
export function normaliseApifyAd(input: {
  ad: ApifyMetaAd;
  advertiserPageId: string;
  observedByProvider: SourceProvider;
}): { observation: ObservedAdIngestInput; creative: NormalisedCreative; payloadHash: string } {
  const { ad, advertiserPageId, observedByProvider } = input;

  const externalAdId = extractExternalAdId(ad);
  const activeStatus = deriveActiveStatus(ad);

  const snapshot: ApifySnapshot | undefined = ad.snapshot ?? undefined;
  const firstCard: ApifySnapshotCard | undefined =
    (snapshot?.cards?.[0] ?? ad.cards?.[0]) ?? undefined;

  const headline = pickFirstString(
    firstCard?.title,
    snapshot?.title,
    ad.title,
  );
  const body = pickFirstString(
    firstCard?.body,
    snapshotBodyText(snapshot?.body),
    ad.body,
  );
  const cta = pickFirstString(
    firstCard?.ctaText,
    firstCard?.cta_text,
    snapshot?.ctaText,
    snapshot?.cta_text,
    snapshot?.ctaType,
    snapshot?.cta_type,
    ad.cta_text,
    ad.cta_type,
    firstCard?.ctaType,
    firstCard?.cta_type,
  );
  const ctaUrl = pickFirstString(
    firstCard?.linkUrl,
    firstCard?.link_url,
    snapshot?.linkUrl,
    snapshot?.link_url,
    ad.link_url,
  );
  const primaryImageUrl = pickFirstString(
    firstCard?.imageUrl,
    firstCard?.image_url,
    snapshot?.images?.[0]?.originalImageUrl,
    snapshot?.images?.[0]?.resizedImageUrl,
    ad.image_url,
  );
  const videoUrl = pickFirstString(
    firstCard?.videoHdUrl,
    firstCard?.video_hd_url,
    firstCard?.videoSdUrl,
    firstCard?.video_sd_url,
    snapshot?.videos?.[0]?.videoHdUrl,
    snapshot?.videos?.[0]?.videoSdUrl,
    (snapshot as Record<string, unknown> | undefined)?.["videoHdUrl"] as string | undefined,
    (snapshot as Record<string, unknown> | undefined)?.["videoSdUrl"] as string | undefined,
    (snapshot as Record<string, unknown> | undefined)?.["video_hd_url"] as string | undefined,
    (snapshot as Record<string, unknown> | undefined)?.["video_sd_url"] as string | undefined,
    ad.video_hd_url,
    ad.video_sd_url,
  );
  const videoThumbnailUrl = pickFirstString(
    firstCard?.videoPreviewImageUrl,
    firstCard?.video_preview_image_url,
    snapshot?.videos?.[0]?.videoPreviewImageUrl,
    (snapshot as Record<string, unknown> | undefined)?.["videoPreviewImageUrl"] as string | undefined,
    (snapshot as Record<string, unknown> | undefined)?.["video_preview_image_url"] as string | undefined,
  );
  const landingUrl = pickFirstString(
    firstCard?.linkUrl,
    firstCard?.link_url,
    snapshot?.linkUrl,
    snapshot?.link_url,
    ad.link_url,
  );

  const platforms = (ad.publisherPlatform ?? ad.publisher_platform ?? ad.platforms ?? []).map(
    (p) => p.toLowerCase(),
  );
  const platform = pickPlatform(platforms);

  const observation: ObservedAdIngestInput = {
    externalAdId,
    advertiserPageId,
    observedByProvider,
    platform,
    activeStatus,
    metaPublisherPlatforms: platforms,
    adDeliveryStartedAt:
      coerceIso(ad.startDate as string | number | null | undefined) ?? coerceIso(ad.start_date as string | number | null | undefined) ?? coerceIso(ad.started_at as string | number | null | undefined) ?? null,
    adDeliveryStoppedAt:
      coerceIso(ad.endDate as string | number | null | undefined) ?? coerceIso(ad.end_date as string | number | null | undefined) ?? coerceIso(ad.stopped_at as string | number | null | undefined) ?? null,
    adCreationDate: pickIsoDate(ad.creation_time as string | number | null | undefined),
    rawPayload: ad as unknown as Record<string, unknown>,
    metadata: {
      pageId: extractPageId(ad),
      pageName: extractPageName(ad),
      displayFormat: snapshot?.displayFormat ?? null,
      collationId: ad.collationId ?? null,
      collationCount: ad.collationCount ?? null,
    },
  };

  const creative: NormalisedCreative = {
    format: deriveFormat({ primaryImageUrl, videoUrl, snapshot, cards: ad.cards ?? undefined }),
    headline,
    body,
    cta,
    ctaUrl,
    primaryImageUrl,
    imageUrls: collectImageUrls(ad, snapshot),
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
  if (platforms.includes("facebook")) return "facebook";
  if (platforms.includes("instagram")) return "instagram";
  if (platforms.includes("messenger")) return "messenger";
  if (platforms.includes("audience_network")) return "audience_network";
  return "unknown";
}

function pickIsoDate(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/u);
    return match ? match[1] : null;
  }
  const ms = value > 1e12 ? value : value * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function coerceIso(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  const ms = value > 1e12 ? value : value * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function snapshotBodyText(body: ApifySnapshot["body"]): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body;
  if (typeof body === "object" && "text" in body && typeof body.text === "string") return body.text;
  return undefined;
}

function deriveFormat(input: {
  primaryImageUrl: string | null;
  videoUrl: string | null;
  snapshot?: ApifySnapshot;
  cards?: ApifySnapshotCard[];
}): "image" | "video" | "carousel" | "dco" | "unknown" {
  const displayFormat = input.snapshot?.displayFormat?.toUpperCase();
  if (displayFormat === "DCO") return "dco";
  if (displayFormat === "CAROUSEL") return "carousel";
  if (displayFormat === "VIDEO") return "video";
  if (displayFormat === "IMAGE") return "image";
  const cardCount = (input.snapshot?.cards?.length ?? input.cards?.length ?? 0);
  if (cardCount > 1) return "carousel";
  if (input.videoUrl) return "video";
  if (input.primaryImageUrl) return "image";
  return "unknown";
}

function collectImageUrls(ad: ApifyMetaAd, snapshot: ApifySnapshot | undefined): string[] {
  const out = new Set<string>();
  if (ad.image_url) out.add(ad.image_url);
  for (const img of snapshot?.images ?? []) {
    if (img.originalImageUrl) out.add(img.originalImageUrl);
    else if (img.resizedImageUrl) out.add(img.resizedImageUrl);
  }
  for (const card of snapshot?.cards ?? ad.cards ?? []) {
    if (card.imageUrl) out.add(card.imageUrl);
    else if (card.image_url) out.add(card.image_url);
  }
  return [...out];
}

function pickFirstString(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}
