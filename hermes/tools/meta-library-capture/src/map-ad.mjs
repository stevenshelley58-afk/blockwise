/**
 * map-ad.mjs — collated_result node → MetaAdLibraryAd.
 *
 * Every access is defensive: unknown shapes are skipped (return null), never
 * fatal. The output shape is the contract the Hermes supervisor's
 * `ingestMetaAd` requires: `adArchiveID` matching /^\d{8,}$/ and
 * `snapshot.images[].originalImageUrl` / `snapshot.videos[].videoHdUrl`.
 */

const AD_ARCHIVE_ID_RE = /^\d{8,}$/u;

export function isValidAdArchiveId(value) {
  return AD_ARCHIVE_ID_RE.test(String(value ?? ""));
}

/**
 * @param {unknown} node one entry of
 *   `ad_library_main.search_results_connection.edges[].node.collated_results[]`
 * @returns {object|null} MetaAdLibraryAd or null when the node has no usable id
 */
export function mapCollatedResultNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;

  const rawId = pick(node, "ad_archive_id", "adArchiveID", "adArchiveId", "id");
  if (!isValidAdArchiveId(rawId)) return null;
  const adArchiveID = String(rawId);

  const snapshot = asObject(node.snapshot) ?? {};
  const pageId = firstString(pick(node, "page_id", "pageID", "pageId"), pick(snapshot, "page_id", "pageId"));
  const pageName = firstString(pick(node, "page_name", "pageName"), pick(snapshot, "page_name", "pageName"));
  const isActive = typeof node.is_active === "boolean" ? node.is_active : null;

  return {
    adArchiveID,
    id: adArchiveID,
    pageID: pageId,
    pageName,
    isActive,
    status: isActive == null ? null : isActive ? "active" : "inactive",
    startDate: epochSecondsToIso(pick(node, "start_date", "startDate")),
    endDate: epochSecondsToIso(pick(node, "end_date", "endDate")),
    publisherPlatform: normalisePlatforms(pick(node, "publisher_platform", "publisherPlatform", "publisher_platforms")),
    snapshot: mapSnapshot(snapshot, { pageId, pageName }),
    inputUrl: `https://www.facebook.com/ads/library/?id=${adArchiveID}`,
    rawHostedProvider: node,
  };
}

function mapSnapshot(snapshot, { pageId, pageName }) {
  const body = pick(snapshot, "body");
  const cards = Array.isArray(snapshot.cards)
    ? snapshot.cards.filter((card) => card && typeof card === "object" && !Array.isArray(card))
    : [];

  return {
    title: firstString(pick(snapshot, "title")),
    body: body && typeof body === "object" ? firstString(pick(body, "text")) : firstString(body),
    caption: firstString(pick(snapshot, "caption")),
    ctaText: firstString(pick(snapshot, "cta_text", "ctaText", "cta")),
    linkUrl: firstString(pick(snapshot, "link_url", "linkUrl")),
    cards,
    images: mapImages(snapshot.images),
    videos: mapVideos(snapshot.videos),
    displayFormat: firstString(pick(snapshot, "display_format", "displayFormat")),
    pageName: pageName ?? firstString(pick(snapshot, "page_name", "pageName")),
    pageId: pageId ?? firstString(pick(snapshot, "page_id", "pageId")),
  };
}

function mapImages(images) {
  if (!Array.isArray(images)) return [];
  const out = [];
  for (const image of images) {
    if (!image || typeof image !== "object") continue;
    const originalImageUrl = firstString(pick(image, "original_image_url", "originalImageUrl"))
      ?? firstString(pick(image, "resized_image_url", "resizedImageUrl"));
    if (originalImageUrl) out.push({ originalImageUrl });
  }
  return out;
}

function mapVideos(videos) {
  if (!Array.isArray(videos)) return [];
  const out = [];
  for (const video of videos) {
    if (!video || typeof video !== "object") continue;
    const videoSdUrl = firstString(pick(video, "video_sd_url", "videoSdUrl"));
    const videoHdUrl = firstString(pick(video, "video_hd_url", "videoHdUrl")) ?? videoSdUrl;
    if (videoHdUrl) out.push({ videoHdUrl, videoSdUrl: videoSdUrl ?? videoHdUrl });
  }
  return out;
}

function normalisePlatforms(value) {
  if (Array.isArray(value)) {
    const platforms = value.map((item) => String(item ?? "").toLowerCase()).filter(Boolean);
    if (platforms.length > 0) return platforms;
  } else if (typeof value === "string" && value.trim()) {
    return [value.toLowerCase()];
  }
  return ["facebook"];
}

function epochSecondsToIso(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && !/^\d+$/u.test(value.trim())) {
    // Already a date string from an unexpected shape; pass through if parseable.
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function pick(source, ...keys) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
