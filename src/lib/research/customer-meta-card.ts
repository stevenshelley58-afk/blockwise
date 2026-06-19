import { resolveDeliveryStoppedAt } from "./schemas/meta-ad-library.ts";

export const CUSTOMER_META_AD_LIBRARY_CARD_SELECT = [
  "card_id",
  "library_id",
  "agent_id",
  "agent_name",
  "agency_id",
  "agency_name",
  "attribution_links",
  "page_id",
  "page_name",
  "page_url",
  "page_image_url",
  "active_status",
  "ad_delivery_started_at",
  "ad_delivery_stopped_at",
  "publisher_platforms",
  "postcode",
  "suburb",
  "state",
  "postcodes",
  "headline",
  "body",
  "description",
  "cta",
  "cta_url",
  "destination_url",
  "primary_image_url",
  "image_urls",
  "image_storage_path",
  "video_url",
  "video_storage_path",
  "video_thumbnail_url",
  "media_assets",
  "last_seen_at",
  "area_match_postcode",
  "area_match_suburb",
  "area_match_state",
  "area_match_type",
  "area_match_confidence",
  "ad_area_postcodes",
  "ad_area_suburbs",
  "service_area_postcodes",
  "service_area_suburbs",
].join(",");

export type CustomerMetaAdLibraryCardRow = {
  card_id: string | null;
  library_id: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  agency_id?: string | null;
  agency_name?: string | null;
  attribution_links?: unknown;
  page_id: string | null;
  page_name: string | null;
  page_url: string | null;
  page_image_url: string | null;
  active_status: string | null;
  ad_delivery_started_at: string | null;
  ad_delivery_stopped_at: string | null;
  publisher_platforms: string[] | null;
  postcode: string | null;
  suburb: string | null;
  state: string | null;
  postcodes: string[] | null;
  headline: string | null;
  body: string | null;
  description: string | null;
  cta: string | null;
  cta_url: string | null;
  destination_url: string | null;
  primary_image_url: string | null;
  image_urls: string[] | null;
  image_storage_path: string | null;
  video_url: string | null;
  video_storage_path: string | null;
  video_thumbnail_url: string | null;
  media_assets: unknown;
  last_seen_at: string | null;
  area_match_postcode?: string | null;
  area_match_suburb?: string | null;
  area_match_state?: string | null;
  area_match_type?: string | null;
  area_match_confidence?: string | number | null;
  ad_area_postcodes?: string[] | null;
  ad_area_suburbs?: string[] | null;
  service_area_postcodes?: string[] | null;
  service_area_suburbs?: string[] | null;
};

export type CustomerMetaAdLibraryMedia = {
  id: string;
  kind: "image" | "video";
  url: string;
  posterUrl: string | null;
};

export type CustomerMetaAdLibraryAttributionLink = Record<string, unknown>;

export type CustomerMetaAdLibraryCard = {
  id: string;
  libraryId: string | null;
  agentId: string | null;
  agentName: string | null;
  agencyId: string | null;
  agencyName: string | null;
  attributionLinks: CustomerMetaAdLibraryAttributionLink[];
  pageId: string | null;
  pageName: string;
  pageUrl: string | null;
  pageImageUrl: string | null;
  activeStatus: "active" | "inactive" | "unknown";
  startedAt: string | null;
  stoppedAt: string | null;
  lastSeenAt: string | null;
  platforms: string[];
  postcode: string | null;
  suburb: string | null;
  state: string | null;
  postcodes: string[];
  areaMatchPostcode: string | null;
  areaMatchSuburb: string | null;
  areaMatchState: string | null;
  areaMatchType: string | null;
  areaMatchConfidence: number | null;
  adAreaPostcodes: string[];
  adAreaSuburbs: string[];
  serviceAreaPostcodes: string[];
  serviceAreaSuburbs: string[];
  headline: string | null;
  body: string | null;
  description: string | null;
  cta: string | null;
  destinationUrl: string | null;
  media: CustomerMetaAdLibraryMedia[];
};

export function normaliseCustomerMetaAdLibraryCard(row: CustomerMetaAdLibraryCardRow): CustomerMetaAdLibraryCard {
  const libraryId = cleanString(row.library_id);
  const pageName = cleanCustomerMetaDisplayText(row.page_name) ?? "Unknown page";
  const fallbackId = [cleanString(row.page_id), pageName, cleanString(row.last_seen_at)].filter(Boolean).join(":");
  const id = cleanString(row.card_id) ?? libraryId ?? fallbackId;
  const activeStatus = normaliseActiveStatus(row.active_status);
  const areaMatchPostcode = cleanCustomerMetaDisplayText(row.area_match_postcode) ?? cleanCustomerMetaDisplayText(row.postcode);
  const areaMatchSuburb = cleanCustomerMetaDisplayText(row.area_match_suburb) ?? cleanCustomerMetaDisplayText(row.suburb);
  const areaMatchState = cleanCustomerMetaDisplayText(row.area_match_state) ?? cleanCustomerMetaDisplayText(row.state);
  const adAreaPostcodes = uniqueDisplayStrings([
    ...(row.ad_area_postcodes ?? row.postcodes ?? []),
    row.area_match_postcode,
    row.postcode,
  ]);
  const adAreaSuburbs = uniqueDisplayStrings([
    ...(row.ad_area_suburbs ?? []),
    row.area_match_suburb,
    row.suburb,
  ]);

  return {
    id,
    libraryId,
    agentId: cleanString(row.agent_id),
    agentName: cleanCustomerMetaDisplayText(row.agent_name),
    agencyId: cleanString(row.agency_id),
    agencyName: cleanCustomerMetaDisplayText(row.agency_name),
    attributionLinks: normaliseAttributionLinks(row.attribution_links),
    pageId: cleanString(row.page_id),
    pageName,
    pageUrl: normalisePublicUrl(row.page_url),
    pageImageUrl: normaliseMediaUrl(row.page_image_url),
    activeStatus,
    startedAt: cleanString(row.ad_delivery_started_at),
    // Defensive: legacy rows ingested before the invariant was enforced may
    // carry Meta's observed-window end on still-active ads. Reconcile here too
    // so the UI never shows "Stopped <today>" next to an Active pill.
    stoppedAt: resolveDeliveryStoppedAt(activeStatus, cleanString(row.ad_delivery_stopped_at)),
    lastSeenAt: cleanString(row.last_seen_at),
    platforms: uniqueStrings(row.publisher_platforms).map(formatPlatformLabel).map(cleanCustomerMetaDisplayText).filter(isString),
    postcode: areaMatchPostcode,
    suburb: areaMatchSuburb,
    state: areaMatchState,
    postcodes: adAreaPostcodes,
    areaMatchPostcode,
    areaMatchSuburb,
    areaMatchState,
    areaMatchType: cleanCustomerMetaDisplayText(row.area_match_type),
    areaMatchConfidence: normaliseNumber(row.area_match_confidence),
    adAreaPostcodes,
    adAreaSuburbs,
    serviceAreaPostcodes: uniqueDisplayStrings(row.service_area_postcodes ?? (row.ad_area_postcodes ? [] : row.postcodes ?? [])),
    serviceAreaSuburbs: uniqueDisplayStrings(row.service_area_suburbs ?? []),
    headline: cleanCustomerMetaDisplayText(row.headline),
    body: cleanCustomerMetaDisplayText(row.body),
    description: cleanCustomerMetaDisplayText(row.description),
    cta: cleanCustomerMetaDisplayText(row.cta),
    destinationUrl: normalisePublicUrl(row.destination_url) ?? normalisePublicUrl(row.cta_url),
    media: resolveMedia(row),
  };
}

const UNRESOLVED_TEMPLATE_MARKER = /\{\{|\}\}/u;
const UNRESOLVED_TEMPLATE_TOKEN = /\{\{[^{}]*\}\}/gu;
const DISPLAY_CONTENT = /[\p{L}\p{N}]/u;

export function hasUnresolvedTemplateMarker(value: string): boolean {
  return UNRESOLVED_TEMPLATE_MARKER.test(value);
}

export function cleanCustomerMetaDisplayText(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  if (!hasUnresolvedTemplateMarker(text)) return text;

  const cleaned = text
    .replace(UNRESOLVED_TEMPLATE_TOKEN, " ")
    .replace(/\s+([,.!?;:])/gu, "$1")
    .replace(/^[\s,;:|/\\-]+|[\s,;:|/\\-]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

  return cleaned && DISPLAY_CONTENT.test(cleaned) && !hasUnresolvedTemplateMarker(cleaned) ? cleaned : null;
}

function resolveMedia(row: CustomerMetaAdLibraryCardRow): CustomerMetaAdLibraryMedia[] {
  const media = new Map<string, CustomerMetaAdLibraryMedia>();
  const assets = parseMediaAssets(row.media_assets);

  for (const asset of assets) {
    const url = normaliseMediaUrl(asset.storagePath) ?? normaliseMediaUrl(asset.url);
    if (!url) continue;
    addMedia(media, {
      id: url,
      kind: asset.kind === "video" || isVideoUrl(url) ? "video" : "image",
      url,
      posterUrl: normaliseMediaUrl(asset.posterStoragePath) ?? normaliseMediaUrl(asset.posterUrl),
    });
  }

  const storedVideo = normaliseMediaUrl(row.video_storage_path);
  if (storedVideo) {
    addMedia(media, {
      id: storedVideo,
      kind: "video",
      url: storedVideo,
      posterUrl: normaliseMediaUrl(row.video_thumbnail_url),
    });
  }

  const storedImage = normaliseMediaUrl(row.image_storage_path);
  if (storedImage) {
    addMedia(media, { id: storedImage, kind: "image", url: storedImage, posterUrl: null });
  }

  return [...media.values()];
}

function addMedia(media: Map<string, CustomerMetaAdLibraryMedia>, item: CustomerMetaAdLibraryMedia) {
  if (!media.has(item.url)) media.set(item.url, item);
}

function normaliseAttributionLinks(value: unknown): CustomerMetaAdLibraryAttributionLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CustomerMetaAdLibraryAttributionLink => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

type ParsedMediaAsset = {
  kind: string | null;
  storagePath: string | null;
  posterStoragePath: string | null;
  url: string | null;
  posterUrl: string | null;
};

function parseMediaAssets(value: unknown): ParsedMediaAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((asset): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object")
    .map((asset) => ({
      kind: cleanString(asset.kind) ?? cleanString(asset.type) ?? cleanString(asset.mediaType) ?? cleanString(asset.media_type),
      storagePath: cleanString(asset.storagePath) ?? cleanString(asset.storage_path),
      posterStoragePath:
        cleanString(asset.posterStoragePath) ??
        cleanString(asset.poster_storage_path) ??
        cleanString(asset.thumbnailStoragePath) ??
        cleanString(asset.thumbnail_storage_path),
      url:
        cleanString(asset.url) ??
        cleanString(asset.sourceUrl) ??
        cleanString(asset.source_url) ??
        cleanString(asset.imageUrl) ??
        cleanString(asset.image_url) ??
        cleanString(asset.videoUrl) ??
        cleanString(asset.video_url),
      posterUrl:
        cleanString(asset.posterUrl) ??
        cleanString(asset.poster_url) ??
        cleanString(asset.thumbnailUrl) ??
        cleanString(asset.thumbnail_url),
    }));
}

function normaliseActiveStatus(value: string | null): "active" | "inactive" | "unknown" {
  const status = value?.toLowerCase();
  if (status === "active") return "active";
  if (status === "inactive" || status === "stopped" || status === "ended") return "inactive";
  return "unknown";
}

function formatPlatformLabel(value: string): string {
  switch (value.toLowerCase()) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "messenger":
      return "Messenger";
    case "audience_network":
      return "Audience Network";
    default:
      return value.replace(/_/g, " ");
  }
}

function uniqueStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  return Array.from(new Set((values ?? []).map(cleanString).filter((value): value is string => Boolean(value))));
}

function uniqueDisplayStrings(values: Array<string | null | undefined> | null | undefined): string[] {
  return uniqueStrings(values).map(cleanCustomerMetaDisplayText).filter(isString);
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

function normaliseNumber(value: string | number | null | undefined): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function normalisePublicUrl(value: unknown): string | null {
  const url = cleanString(value);
  if (url && hasUnresolvedTemplateMarker(url)) return null;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

export function normaliseMediaUrl(value: unknown): string | null {
  const url = cleanString(value);
  if (url && hasUnresolvedTemplateMarker(url)) return null;
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) return null;
  const encodedPath = url.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/research-ad-creatives/${encodedPath}`;
}

function cleanString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(?:$|\?)/i.test(url) || /video-/i.test(url);
}

/**
 * Milliseconds an ad has been (or was) delivering: from its start date until
 * its stop date, or until `now` when it is still running. Null when there is
 * no usable start date. Single source of truth for both the "X days running"
 * label on the card and the longest-running sort on the research page.
 */
export function adRunningMs(
  startedAt: string | null,
  stoppedAt: string | null,
  now: number = Date.now(),
): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end = stoppedAt ? new Date(stoppedAt).getTime() : now;
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

/** Human label for a delivery duration, e.g. "61 days running" or "ran 12 days". */
export function formatAdDuration(ms: number, isRunning: boolean): string {
  const days = Math.floor(ms / 86_400_000);
  if (isRunning) {
    if (days <= 0) return "started today";
    return `${days} day${days === 1 ? "" : "s"} running`;
  }
  if (days <= 0) return "ran less than a day";
  return `ran ${days} day${days === 1 ? "" : "s"}`;
}
