const MEDIA_KEYS = Object.freeze({
  image: ["imageUrl", "image_url", "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url"],
  video: ["videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url"],
  thumbnail: ["videoPreviewImageUrl", "video_preview_image_url", "thumbnailUrl", "thumbnail_url"],
});

function cardObjects(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function cardMediaValues(cards, kind) {
  const keys = MEDIA_KEYS[kind];
  if (!keys) throw new Error("unsupported media kind");
  return cardObjects(cards).flatMap((card) => keys.map((key) => card[key]).filter((value) => value !== undefined && value !== null && value !== ""));
}
