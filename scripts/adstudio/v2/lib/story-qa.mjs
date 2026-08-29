import sharp from "sharp";
import {
  STORY_BACKING_COLOUR,
  STORY_CTA_MAX_GAP_PX,
  STORY_MAX_DEAD_SPACE_PX,
  STORY_SAFE_BOTTOM,
  STORY_SAFE_TOP,
} from "./story.mjs";

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const MIN_TEXT_BACKING_CONTRAST = 4.5;
const BACKING_SAMPLE_FRACTIONS = [0.15, 0.5, 0.85];

function roleFor(layer) {
  const value = `${layer.inputKey ?? ""} ${layer.id ?? ""}`.toLowerCase();
  if (/(headline|title|heading)/u.test(value)) return "headline";
  if (/(support|subhead|description|body)/u.test(value)) return "supporting";
  if (/(handle|username|agent|instagram|social)/u.test(value)) return "handle";
  if (/(arrow|cta|action|learn|contact)/u.test(value)) return "arrow";
  return null;
}

function intersection(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  return { width: Math.max(0, rightEdge - x), height: Math.max(0, bottom - y) };
}

function verticalGap(left, right) {
  return Math.max(0, right.y - (left.y + left.height)) * STORY_HEIGHT;
}

function hexRgb(hex) {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex ?? "");
  if (!match) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function relativeLuminance([red, green, blue]) {
  const linear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * linear(red)) + (0.7152 * linear(green)) + (0.0722 * linear(blue));
}

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function textColours(layer) {
  const colours = [layer.typo?.color];
  if (layer.typo?.effects?.gradientFill) {
    colours.push(layer.typo.effects.gradientFill.from, layer.typo.effects.gradientFill.to);
  }
  return colours.filter(Boolean);
}

function containsPoint(box, x, y) {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/**
 * Release-time deterministic Story gate. It combines structural checks with
 * a few pixel probes over each declared backing patch, so a Story cannot claim
 * to pass solely because a boolean was copied into the pack envelope.
 */
export async function evaluateStoryQa(doc, storyPreviewBytes) {
  const blockers = [];
  const story = doc.formats?.story;
  const policy = story?.storyPolicy;
  if (!story || story.format !== "9:16" || story.width !== STORY_WIDTH || story.height !== STORY_HEIGHT) {
    blockers.push("story layout must be a 1080x1920 9:16 surface");
  }
  if (!policy || policy.schema !== "adstudio.story-policy.v1") {
    blockers.push(story?.native
      ? "native story-first layout requires an explicit story-policy.v1; automatic native policy derivation is unsupported"
      : "story-policy.v1 is required for a releasable Story");
  }
  if (!story || !policy) return { passed: false, blockers };

  // Candidate-authored policy values may tighten the gate, but never widen
  // the canonical bounds. The actual geometry checks below always use the
  // bounded constants, so a malicious/stale policy cannot make a bad Story
  // appear acceptable by declaring a large threshold.
  if (!Number.isFinite(policy.maxDeadSpacePx) || policy.maxDeadSpacePx <= 0 || policy.maxDeadSpacePx > STORY_MAX_DEAD_SPACE_PX) {
    blockers.push(`Story maxDeadSpacePx must be a positive value no greater than the canonical ${STORY_MAX_DEAD_SPACE_PX}px`);
  }
  if (!Number.isFinite(policy.ctaGroup?.maxGapPx) || policy.ctaGroup.maxGapPx <= 0 || policy.ctaGroup.maxGapPx > STORY_CTA_MAX_GAP_PX) {
    blockers.push(`Story CTA maxGapPx must be a positive value no greater than the canonical ${STORY_CTA_MAX_GAP_PX}px`);
  }
  if (String(policy.backingColour).toLowerCase() !== STORY_BACKING_COLOUR) {
    blockers.push(`Story backingColour must be the canonical ivory ${STORY_BACKING_COLOUR}`);
  }

  const text = story.layers.filter((layer) => layer.type === "text");
  for (const layer of text) {
    if (layer.box.y * STORY_HEIGHT < STORY_SAFE_TOP || (layer.box.y + layer.box.height) * STORY_HEIGHT > STORY_HEIGHT - STORY_SAFE_BOTTOM) {
      blockers.push(`text layer ${layer.id} breaks the Story safe zone`);
    }
  }

  const byId = new Map(story.layers.map((layer) => [layer.id, layer]));
  const support = text.find((layer) => roleFor(layer) === "supporting");
  const supportBackingId = policy.backingLayerIds.find((id) => byId.get(id)?.type === "overlay_patch" && id.includes("supporting"));
  const supportBacking = supportBackingId ? byId.get(supportBackingId) : null;
  if (support && (!supportBacking || intersection(support.box, supportBacking.box).width < support.box.width * 0.9 || intersection(support.box, supportBacking.box).height < support.box.height)) {
    blockers.push("supporting copy requires a full-coverage backing patch");
  }

  const ctaIds = policy.ctaGroup.layerIds;
  const ctaLayers = ctaIds.map((id) => byId.get(id)).filter((layer) => layer?.type === "text");
  if (ctaLayers.length < 2) {
    blockers.push("Story CTA must group handle and arrow layers");
  } else {
    const ctaTop = Math.min(...ctaLayers.map((layer) => layer.box.y));
    const ctaBottom = Math.max(...ctaLayers.map((layer) => layer.box.y + layer.box.height));
    const ctaYSpread = (Math.max(...ctaLayers.map((layer) => layer.box.y)) - Math.min(...ctaLayers.map((layer) => layer.box.y))) * STORY_HEIGHT;
    if (ctaYSpread > STORY_CTA_MAX_GAP_PX || (ctaBottom - ctaTop) * STORY_HEIGHT > STORY_MAX_DEAD_SPACE_PX) blockers.push("Story CTA group is too spread out");
    const ctaBacking = policy.backingLayerIds.map((id) => byId.get(id)).find((layer) => layer?.type === "overlay_patch" && layer.id.includes("cta"));
    if (!ctaBacking || ctaLayers.some((layer) => intersection(layer.box, ctaBacking.box).width < layer.box.width * 0.85 || intersection(layer.box, ctaBacking.box).height < layer.box.height)) {
      blockers.push("Story CTA group requires one shared backing patch");
    }
  }

  const image = story.layers.find((layer) => layer.type === "image_slot");
  const occupied = [image, ...text].filter(Boolean).map((layer) => ({ y: layer.box.y, height: layer.box.height })).sort((a, b) => a.y - b.y);
  let maxGap = 0;
  for (let index = 1; index < occupied.length; index += 1) maxGap = Math.max(maxGap, verticalGap(occupied[index - 1], occupied[index]));
  if (maxGap > STORY_MAX_DEAD_SPACE_PX) blockers.push(`Story dead space ${Math.round(maxGap)}px exceeds the canonical ${STORY_MAX_DEAD_SPACE_PX}px`);

  const backingRgb = hexRgb(STORY_BACKING_COLOUR);
  const backingTextLayers = [support, ...ctaLayers].filter(Boolean);
  for (const layer of backingTextLayers) {
    const colours = textColours(layer);
    if (!colours.length) {
      blockers.push(`Story text layer ${layer.id} must declare a colour for backing contrast verification`);
      continue;
    }
    for (const colour of colours) {
      const rgb = hexRgb(colour);
      if (!rgb || contrastRatio(rgb, backingRgb) < MIN_TEXT_BACKING_CONTRAST) {
        blockers.push(`Story text layer ${layer.id} does not meet ${MIN_TEXT_BACKING_CONTRAST}:1 contrast against canonical ivory`);
      }
    }
  }

  const raw = await sharp(storyPreviewBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const id of policy.backingLayerIds) {
    const layer = byId.get(id);
    if (!layer || layer.type !== "overlay_patch") {
      blockers.push(`declared Story backing ${id} is missing`);
      continue;
    }
    const points = [];
    for (const yFraction of BACKING_SAMPLE_FRACTIONS) {
      for (const xFraction of BACKING_SAMPLE_FRACTIONS) {
        const x = layer.box.x + layer.box.width * xFraction;
        const y = layer.box.y + layer.box.height * yFraction;
        // Text is intentionally above the patch. Ignore those covered points
        // while still requiring several independent exposed interior samples.
        if (!text.some((entry) => containsPoint(entry.box, x, y))) points.push([x, y]);
      }
    }
    if (points.length < 3) {
      blockers.push(`Story backing ${id} has too few unobscured interior samples for uniformity verification`);
      continue;
    }
    const samples = points.map(([xNorm, yNorm]) => {
      const x = Math.min(STORY_WIDTH - 1, Math.max(0, Math.round(xNorm * STORY_WIDTH)));
      const y = Math.min(STORY_HEIGHT - 1, Math.max(0, Math.round(yNorm * STORY_HEIGHT)));
      const offset = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]];
    });
    if (samples.some((sample) => sample.some((value, index) => Math.abs(value - backingRgb[index]) > 18))) {
      blockers.push(`Story backing ${id} is not rendered uniformly in canonical ivory`);
    }
  }

  return { passed: blockers.length === 0, blockers };
}
