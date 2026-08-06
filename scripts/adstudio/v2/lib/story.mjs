// Deterministic 9:16 story draft (Track C, §5). No AI by default: the feed
// plate is centred and the margin bands are filled by sampled-edge blur
// extension (deterministic). Layers are repositioned into the Meta story
// safe zones (top 250 / bottom 340 of 1920).

import sharp from "sharp";

export const STORY_SAFE_TOP = 250;
export const STORY_SAFE_BOTTOM = 340;

export async function extendPlateToStory(feedPlateBytes, feedWidth = 1080, feedHeight = 1350) {
  const width = 1080;
  const height = 1920;

  // Scale the feed plate to width, centred vertically; the leftover top and
  // bottom bands come from blurred copies of the plate's own edge rows.
  const scaledHeight = Math.round((feedHeight / feedWidth) * width);
  const topBand = Math.max(0, Math.floor((height - scaledHeight) / 2));
  const bottomBand = Math.max(0, height - scaledHeight - topBand);

  const scaled = await sharp(feedPlateBytes).resize(width, scaledHeight, { fit: "fill" }).toBuffer();

  const edge = 24; // sampled edge strip, stretched + blurred into the bands
  const topStrip = await sharp(feedPlateBytes)
    .extract({ left: 0, top: 0, width: feedWidth, height: edge })
    .resize(width, topBand > 0 ? topBand : 1, { fit: "fill" })
    .blur(18)
    .toBuffer();
  const bottomStrip = await sharp(feedPlateBytes)
    .extract({ left: 0, top: feedHeight - edge, width: feedWidth, height: edge })
    .resize(width, bottomBand > 0 ? bottomBand : 1, { fit: "fill" })
    .blur(18)
    .toBuffer();

  const composed = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).composite([
    ...(topBand > 0 ? [{ input: topStrip, top: 0, left: 0 }] : []),
    ...(bottomBand > 0 ? [{ input: bottomStrip, top: height - bottomBand, left: 0 }] : []),
    { input: scaled, top: topBand, left: 0 },
  ]);
  return composed.png().toBuffer();
}

/**
 * Reposition feed layers into the story safe zones. Pure normalized-box math:
 * the feed's vertical span maps onto [safeTop, 1 - safeBottom] of the story
 * canvas, preserving horizontal placement. Deterministic and reversible.
 */
export function repositionLayersForStory(layers) {
  const safeTopNorm = STORY_SAFE_TOP / 1920;
  const safeBottomNorm = (1920 - STORY_SAFE_BOTTOM) / 1920;
  const usable = safeBottomNorm - safeTopNorm;

  return layers.map((layer) => {
    const y = safeTopNorm + layer.box.y * usable;
    const height = layer.box.height * usable;
    return { ...layer, box: { ...layer.box, y, height } };
  });
}
