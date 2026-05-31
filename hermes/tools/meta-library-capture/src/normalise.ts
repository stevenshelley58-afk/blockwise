import { metaAdLibraryDatasetSchema, type MetaAdLibraryAd } from "./types.ts";

export function normaliseHostedMetaItems(input: {
  body: unknown;
  pageId: string;
  limit: number;
}): { items: MetaAdLibraryAd[]; warnings: string[] } {
  const warnings: string[] = [];
  const candidates = extractCandidateAds(input.body).slice(0, input.limit);
  const items = candidates.map((candidate) => normaliseHostedMetaAd(candidate, input.pageId));
  const parsed = metaAdLibraryDatasetSchema.safeParse(items);
  if (!parsed.success) {
    warnings.push(...parsed.error.issues.map((issue) => issue.message));
    return { items: [], warnings };
  }
  return { items: parsed.data, warnings };
}

function extractCandidateAds(body: unknown): Record<string, unknown>[] {
  const arrays = collectArrays(body);
  for (const arr of arrays) {
    const adLike = arr.filter(isAdLikeObject);
    if (adLike.length > 0) return adLike;
  }
  return walkObjects(body).filter(isAdLikeObject);
}

function collectArrays(value: unknown): unknown[][] {
  const out: unknown[][] = [];
  if (Array.isArray(value)) {
    out.push(value);
    for (const child of value) out.push(...collectArrays(child));
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) out.push(...collectArrays(child));
  }
  return out;
}

function walkObjects(value: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (Array.isArray(value)) {
    for (const child of value) out.push(...walkObjects(child));
  } else if (value && typeof value === "object") {
    out.push(value as Record<string, unknown>);
    for (const child of Object.values(value)) out.push(...walkObjects(child));
  }
  return out;
}

function isAdLikeObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return looksLikeAdId(pick(obj, "adArchiveID", "adArchiveId", "ad_archive_id", "archive_id", "library_id", "id"));
}

function normaliseHostedMetaAd(raw: Record<string, unknown>, pageId: string): MetaAdLibraryAd {
  const snapshot = asObject(pick(raw, "snapshot", "ad_snapshot", "creative", "ad_creative")) ?? raw;
  const cards = objectArray(pick(snapshot, "cards", "asset_cards", "ad_cards"));
  const firstCard = cards[0] ?? null;
  const bodyText = firstString(
    pick(firstCard, "body", "text"),
    pick(snapshot, "body", "text"),
    firstArrayString(pick(raw, "ad_creative_bodies", "adCreativeBodies", "bodies")),
    pick(raw, "body", "text"),
  );
  const title = firstString(
    pick(firstCard, "title", "headline"),
    pick(snapshot, "title", "headline"),
    firstArrayString(pick(raw, "ad_creative_link_titles", "adCreativeLinkTitles", "titles")),
    pick(raw, "title", "headline"),
  );
  const linkUrl = firstString(
    pick(firstCard, "linkUrl", "link_url", "url"),
    pick(snapshot, "linkUrl", "link_url", "url"),
    firstArrayString(pick(raw, "ad_creative_link_urls", "adCreativeLinkUrls", "link_urls")),
    pick(raw, "link_url", "url", "landing_url"),
  );
  const imageUrls = collectStrings(
    pick(firstCard, "imageUrl", "image_url", "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url"),
    pick(snapshot, "images", "image_urls", "ad_creative_images"),
    pick(raw, "images", "image_urls", "ad_creative_images", "adCreativeImages"),
  );
  const videoUrls = collectStrings(
    pick(firstCard, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url"),
    pick(snapshot, "videos", "video_urls"),
    pick(raw, "videos", "video_urls", "ad_creative_videos", "adCreativeVideos"),
  );
  const adId = String(pick(raw, "adArchiveID", "adArchiveId", "ad_archive_id", "archive_id", "library_id", "id"));
  const pageName = firstString(pick(raw, "pageName", "page_name"), pick(snapshot, "pageName", "page_name"));
  const normalisedPageId = String(pick(raw, "pageID", "pageId", "page_id") ?? pageId);

  return {
    adArchiveID: adId,
    id: adId,
    pageID: normalisedPageId,
    pageName,
    isActive: deriveIsActive(raw),
    status: firstString(pick(raw, "status", "ad_active_status")),
    startDate: pick(raw, "startDate", "start_date", "ad_delivery_start_time", "adDeliveryStartTime") as string | number | null | undefined,
    endDate: pick(raw, "endDate", "end_date", "ad_delivery_stop_time", "adDeliveryStopTime") as string | number | null | undefined,
    publisherPlatform: normalisePlatforms(pick(raw, "publisherPlatform", "publisher_platforms", "publisher_platform", "platforms")),
    snapshot: {
      title,
      body: bodyText,
      caption: firstString(pick(firstCard, "caption"), pick(snapshot, "caption"), firstArrayString(pick(raw, "ad_creative_link_captions"))),
      ctaText: firstString(pick(firstCard, "ctaText", "cta_text"), pick(snapshot, "ctaText", "cta_text"), pick(raw, "cta_text", "cta")),
      linkUrl,
      cards,
      images: imageUrls.map((url) => ({ originalImageUrl: url })),
      videos: videoUrls.map((url) => ({ videoHdUrl: url })),
      displayFormat: firstString(pick(snapshot, "displayFormat", "display_format")),
      pageName,
      pageId: normalisedPageId,
    },
    inputUrl: firstString(pick(raw, "ad_snapshot_url", "snapshot_url", "url")) ?? `https://www.facebook.com/ads/library/?id=${adId}`,
    rawHostedProvider: raw,
  };
}

function pick(source: unknown, ...keys: string[]): unknown {
  if (!source || typeof source !== "object") return undefined;
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function firstArrayString(value: unknown): string | null {
  return Array.isArray(value) ? firstString(...value) : null;
}

function collectStrings(...values: unknown[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      out.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.add(item);
        else if (item && typeof item === "object") {
          const url = firstString(pick(item, "url", "uri", "src", "imageUrl", "originalImageUrl", "videoHdUrl", "videoSdUrl"));
          const snakeUrl = firstString(pick(item, "image_url", "original_image_url", "resized_image_url", "video_hd_url", "video_sd_url"));
          if (snakeUrl) out.add(snakeUrl);
          if (url) out.add(url);
        }
      }
    }
  }
  return [...out];
}

function deriveIsActive(raw: Record<string, unknown>): boolean | null {
  const explicit = pick(raw, "isActive", "is_active");
  if (typeof explicit === "boolean") return explicit;
  const status = firstString(pick(raw, "status", "ad_active_status"))?.toLowerCase();
  if (status === "active") return true;
  if (status === "inactive" || status === "ended" || status === "stopped") return false;
  return null;
}

function normalisePlatforms(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.toLowerCase()];
  return ["facebook"];
}

function looksLikeAdId(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number"
    ? /^\d{8,}$/u.test(String(value))
    : false;
}
