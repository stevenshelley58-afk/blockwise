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
export const STORY_BACKING_COLOUR = "#f4f0e8";
export const STORY_MAX_DEAD_SPACE_PX = 420;
export const STORY_CTA_MAX_GAP_PX = 52;

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
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function layerRole(layer) {
  const key = `${layer.inputKey ?? ""} ${layer.id ?? ""}`.toLowerCase();
  if (/(headline|title|heading)/u.test(key)) return "headline";
  if (/(support|subhead|description|body)/u.test(key)) return "supporting";
  if (/(handle|username|agent|instagram|social)/u.test(key)) return "handle";
  if (/(arrow|cta|action|learn|contact)/u.test(key)) return "arrow";
  return null;
}

function unionBox(left, right) {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}

function expandBox(box, xPad, yPad) {
  const x = clamp(box.x - xPad, 0, 1);
  const y = clamp(box.y - yPad, 0, 1);
  const right = clamp(box.x + box.width + xPad, 0, 1);
  const bottom = clamp(box.y + box.height + yPad, 0, 1);
  return { x, y, width: right - x, height: bottom - y };
}

function moveLayerBox(layer, nextBox) {
  const previous = layer.box;
  const measuredLines = layer.typo?.measuredLines;
  if (!measuredLines?.length || previous.width <= 0 || previous.height <= 0) {
    return { ...layer, box: nextBox };
  }
  const remap = (box) => ({
    ...box,
    x: nextBox.x + ((box.x - previous.x) / previous.width) * nextBox.width,
    y: nextBox.y + ((box.y - previous.y) / previous.height) * nextBox.height,
    width: (box.width / previous.width) * nextBox.width,
    height: (box.height / previous.height) * nextBox.height,
  });
  return {
    ...layer,
    box: nextBox,
    typo: { ...layer.typo, measuredLines: measuredLines.map((line) => ({ ...line, box: remap(line.box) })) },
  };
}

/**
 * Build a role-aware 9:16 composition from a feed layout. The old mapping
 * preserved every feed y-coordinate, which left supporting copy on top of a
 * customer photo and stranded the CTA at the bottom of a mostly empty Story.
 * This composition keeps the source's horizontal rhythm while assigning the
 * semantic roles to bounded Story lanes.
 */
export function deriveStoryComposition(layers) {
  const safeTopNorm = STORY_SAFE_TOP / 1920;
  const safeBottomNorm = (1920 - STORY_SAFE_BOTTOM) / 1920;
  const usable = safeBottomNorm - safeTopNorm;
  const mapBox = (box) => ({
    ...box,
    y: safeTopNorm + box.y * usable,
    height: box.height * usable,
  });

  const mapped = layers.map((layer) => {
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

  const image = mapped.find((layer) => layer.type === "image_slot");
  const headline = mapped.find((layer) => layer.type === "text" && layerRole(layer) === "headline");
  const supporting = mapped.find((layer) => layer.type === "text" && layerRole(layer) === "supporting");
  const handle = mapped.find((layer) => layer.type === "text" && layerRole(layer) === "handle");
  const arrow = mapped.find((layer) => layer.type === "text" && layerRole(layer) === "arrow");

  // Keep the photo and headline in the upper two-thirds. Supporting copy is
  // deliberately below the image so dark copy never relies on photography
  // for contrast. The handle and arrow share one compact CTA lane.
  if (image) {
    image.box = {
      ...image.box,
      y: clamp(image.box.y, 0.25, 0.46),
      height: Math.min(image.box.height, 0.38),
    };
  }
  if (headline) {
    const nextBox = {
      ...headline.box,
      y: clamp(headline.box.y, safeTopNorm + 0.015, 0.24),
      height: Math.min(headline.box.height, 0.13),
    };
    Object.assign(headline, moveLayerBox(headline, nextBox));
  }
  if (supporting) {
    const imageBottom = image ? image.box.y + image.box.height : 0.56;
    const y = Math.max(0.635, imageBottom + 0.025);
    const nextBox = { ...supporting.box, y, height: Math.min(Math.max(supporting.box.height, 0.045), 0.075) };
    Object.assign(supporting, moveLayerBox(supporting, nextBox));
  }

  const supportBottom = supporting ? supporting.box.y + supporting.box.height : 0.68;
  const ctaY = clamp(Math.max(0.735, supportBottom + 0.045), 0.735, 0.785);
  for (const layer of [handle, arrow]) {
    if (!layer) continue;
    const nextBox = { ...layer.box, y: ctaY, height: Math.min(Math.max(layer.box.height, 0.038), 0.055) };
    Object.assign(layer, moveLayerBox(layer, nextBox));
  }

  const backings = [];
  if (supporting) {
    backings.push({
      id: "story-backing-supporting",
      role: "supporting",
      box: expandBox(supporting.box, 0.022, 0.018),
      colour: STORY_BACKING_COLOUR,
    });
  }
  if (handle || arrow) {
    const cta = [handle, arrow].filter(Boolean).map((layer) => layer.box).reduce(unionBox);
    backings.push({
      id: "story-backing-cta",
      role: "cta",
      box: expandBox(cta, 0.02, 0.018),
      colour: STORY_BACKING_COLOUR,
    });
  }

  // Integer z values keep the frozen document schema simple. Backing patches
  // sit between the photo/plate and their text; the CTA group remains one
  // visual unit at the bottom of the safe area.
  const withZ = mapped.map((layer) => {
    const role = layerRole(layer);
    if (role === "headline") return { ...layer, z: 3 };
    if (role === "supporting") return { ...layer, z: 5 };
    if (role === "handle") return { ...layer, z: 7 };
    if (role === "arrow") return { ...layer, z: 8 };
    return { ...layer, z: 1 };
  });
  const backingLayers = backings.map((backing, index) => ({
    id: backing.id,
    z: backing.role === "supporting" ? 4 : 6,
    type: "overlay_patch",
    src: `/adstudio-templates/__TEMPLATE_ID__/patch-${backing.role}.webp`,
    sha256: "0".repeat(64),
    box: backing.box,
  }));

  return {
    layers: [...withZ, ...backingLayers].sort((left, right) => left.z - right.z),
    backings,
    policy: {
      schema: "adstudio.story-policy.v1",
      safeTopPx: STORY_SAFE_TOP,
      safeBottomPx: STORY_SAFE_BOTTOM,
      maxDeadSpacePx: STORY_MAX_DEAD_SPACE_PX,
      backingColour: STORY_BACKING_COLOUR,
      backingLayerIds: backings.map((backing) => backing.id),
      ctaGroup: {
        layerIds: [handle?.id, arrow?.id].filter(Boolean),
        maxGapPx: STORY_CTA_MAX_GAP_PX,
      },
    },
  };
}

export function repositionLayersForStory(layers) {
  return deriveStoryComposition(layers).layers;
}
