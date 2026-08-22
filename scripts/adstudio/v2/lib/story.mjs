// Deterministic 9:16 story draft (Track C, §5). No AI by default: the feed
// plate is centred and the margin bands are filled by sampled-edge blur
// extension (deterministic). Layers are repositioned into the Meta story
// safe zones (top 250 / bottom 340 of 1920).

import sharp from "sharp";

export const STORY_SAFE_TOP = 250;
export const STORY_SAFE_BOTTOM = 340;

// The derived 4:5 feed for a story-first source is the centred 1350 band of
// the 1920 canvas (outside the UI safe zones).
export const STORY_DERIVED_FEED_TOP = 285;
export const STORY_DERIVED_FEED_BOTTOM = 1635;

/** Normalized box mapped from a 9:16 source into the derived 4:5 band, or
 *  null when less than 20% of the box survives the crop (it legitimately
 *  does not exist on the feed surface). */
export function mapStoryBoxToFeed(box) {
  const y1px = box.y * 1920;
  const y2px = (box.y + box.height) * 1920;
  const interTop = Math.max(y1px, STORY_DERIVED_FEED_TOP);
  const interBottom = Math.min(y2px, STORY_DERIVED_FEED_BOTTOM);
  const inter = Math.max(0, interBottom - interTop);
  if (inter < 0.2 * (y2px - y1px)) return null;
  const y = (interTop - STORY_DERIVED_FEED_TOP) / 1350;
  const height = Math.min(1 - y, inter / 1350);
  return {
    x: Math.min(1, Math.max(0, box.x)),
    y,
    width: Math.min(1 - Math.min(1, Math.max(0, box.x)), Math.max(0.02, box.width)),
    height: Math.max(0.02, height),
  };
}

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
  const mapBox = (box) => ({
    ...box,
    y: safeTopNorm + box.y * usable,
    height: box.height * usable,
  });

  return layers.map((layer) => {
    const measuredLines = layer.typo?.measuredLines;
    return {
      ...layer,
      box: mapBox(layer.box),
      ...(measuredLines
        ? {
          typo: {
            ...layer.typo,
            measuredLines: measuredLines.map((line) => ({
              ...line,
              box: mapBox(line.box),
            })),
          },
        }
        : {}),
    };
  });
}
