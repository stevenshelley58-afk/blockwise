const MEDIA_KEYS = Object.freeze({
  image: ["imageUrl", "image_url", "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url"],
  video: ["videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url"],
  thumbnail: ["videoPreviewImageUrl", "video_preview_image_url", "thumbnailUrl", "thumbnail_url"],
});

// Carousel payloads arrive in more than one shape. A flat card list is the
// common case, but hosted captures and Apify dataset rows also nest per-card
// media: a card array inside a card array, or a `cards`/`media` property on a
// card object holding that variant's own media. Walk both recursively so every
// card's media is extracted instead of silently dropped.
const NESTED_CARD_KEYS = Object.freeze(["cards", "asset_cards", "ad_cards", "carousel_cards", "carouselCards", "media"]);

function flattenCardObjects(value, out = [], depth = 0) {
  if (depth > 8) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenCardObjects(item, out, depth + 1);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  out.push(value);
  for (const key of NESTED_CARD_KEYS) {
    const nested = value[key];
    if (nested !== undefined && nested !== null) flattenCardObjects(nested, out, depth + 1);
  }
  return out;
}

export function cardMediaValues(cards, kind) {
  const keys = MEDIA_KEYS[kind];
  if (!keys) throw new Error("unsupported media kind");
  const values = [];
  const seen = new Set();
  for (const card of flattenCardObjects(cards)) {
    for (const key of keys) {
      const value = card[key];
      if (typeof value !== "string" || !value) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}
