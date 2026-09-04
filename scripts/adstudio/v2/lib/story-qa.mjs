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
const MIN_LARGE_TEXT_BACKING_CONTRAST = 3;
const MIN_BOLD_LARGE_TEXT_PX = 18;
const MIN_REGULAR_LARGE_TEXT_PX = 24;
const BACKING_X_SAMPLE_FRACTIONS = [0.05, 0.275, 0.5, 0.725, 0.95];
const BACKING_Y_SAMPLE_FRACTIONS = [0.03, 0.12, 0.275, 0.5, 0.725, 0.88, 0.97];
const MAX_EXPECTED_BACKING_DELTA = 32;
const MAX_UNIFORM_BACKING_DELTA = 18;
const MAX_PAINTED_BOUNDS_OVERFLOW_PX = 0.5;
const MIN_TEXT_OVERLAP_PX = 0.5;

function layerIdentity(layer) {
  return `${layer.inputKey ?? ""} ${layer.id ?? ""}`
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase();
}

function roleFor(layer) {
  const value = layerIdentity(layer);
  if (/(about.*(heading|title|label)|(?:heading|title|label).*about)/u.test(value)) return "about-heading";
  if (/(about.*(copy|body)|(?:copy|body).*about)/u.test(value)) return "about-copy";
  if (/(features?.*(heading|title|label)|(?:heading|title|label).*features?)/u.test(value)) return "feature-heading";
  if (/(features?.*(copy|list|row|item|\d)|(?:copy|list|row|item).*features?)/u.test(value)) return "feature-row";
  if (/(headline|title|heading)/u.test(value)) return "headline";
  if (/(support|subhead|description|body)/u.test(value)) return "supporting";
  if (/(handle|username|agent|instagram|social)/u.test(value)) return "handle";
  if (/(arrow|cta|action|learn|contact)/u.test(value)) return "arrow";
  if (/(address|price|phone|email|website|brand)/u.test(value)) return "detail";
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
  return (right.y - (left.y + left.height)) * STORY_HEIGHT;
}

function horizontalOverlap(left, right) {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
}

function normalizedPaintedBounds(layer) {
  // Native renderer diagnostics can attach one union bound. Older authored
  // documents retain the same information as the exact per-line paint frames.
  const declared = layer.typo?.paintedBounds ?? layer.paintedBounds;
  if (declared && [declared.x, declared.y, declared.width, declared.height].every(Number.isFinite)) {
    const usesPixels = declared.x > 1 || declared.y > 1 || declared.width > 1 || declared.height > 1;
    return usesPixels
      ? { x: declared.x / STORY_WIDTH, y: declared.y / STORY_HEIGHT, width: declared.width / STORY_WIDTH, height: declared.height / STORY_HEIGHT }
      : declared;
  }

  const measured = layer.typo?.measuredLines
    ?.map((line) => line?.box)
    .filter((box) => box && [box.x, box.y, box.width, box.height].every(Number.isFinite));
  if (!measured?.length) return null;
  return measured.slice(1).reduce((bounds, box) => ({
    x: Math.min(bounds.x, box.x),
    y: Math.min(bounds.y, box.y),
    width: Math.max(bounds.x + bounds.width, box.x + box.width) - Math.min(bounds.x, box.x),
    height: Math.max(bounds.y + bounds.height, box.y + box.height) - Math.min(bounds.y, box.y),
  }), { ...measured[0] });
}

function paintedBoundsOverflowPx(layer) {
  const painted = normalizedPaintedBounds(layer);
  if (!painted) return null;
  return {
    left: Math.max(0, layer.box.x - painted.x) * STORY_WIDTH,
    top: Math.max(0, layer.box.y - painted.y) * STORY_HEIGHT,
    right: Math.max(0, painted.x + painted.width - (layer.box.x + layer.box.width)) * STORY_WIDTH,
    bottom: Math.max(0, painted.y + painted.height - (layer.box.y + layer.box.height)) * STORY_HEIGHT,
  };
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

function layerOrder(layer, index) {
  return Number.isFinite(layer.z) ? layer.z : index;
}

function coversText(backing, text, widthCoverage = 0.85) {
  const overlap = intersection(backing.box, text.box);
  return overlap.width >= text.box.width * widthCoverage && overlap.height >= text.box.height;
}

function isContentImageSlot(layer) {
  if (layer.type !== "image_slot") return false;
  const identity = `${layer.inputKey ?? ""} ${layer.id ?? ""}`.toLowerCase();
  return layer.inputKey !== "logo_slot" && !/(^|[-_ ])(logo|brand-mark)([-_ ]|$)/u.test(identity);
}

function isOpaqueVectorBacking(layer) {
  return layer.type === "vector"
    && (layer.opacity ?? 1) === 1
    && !["line", "wave", "ring"].includes(layer.shape)
    && Boolean(hexRgb(layer.fill));
}

function effectiveBacking(layers, textLayer, policyBackingRgb) {
  const textIndex = layers.indexOf(textLayer);
  const textOrder = layerOrder(textLayer, textIndex);
  const candidates = layers
    .map((layer, index) => ({ layer, order: layerOrder(layer, index) }))
    .filter(({ layer, order }) => order < textOrder
      && (layer.type === "overlay_patch" || isOpaqueVectorBacking(layer))
      && coversText(layer, textLayer))
    .sort((left, right) => right.order - left.order);
  const backing = candidates[0]?.layer;
  if (!backing) return null;
  return {
    layer: backing,
    rgb: backing.type === "vector" ? hexRgb(backing.fill) : policyBackingRgb,
  };
}

function minimumContrastFor(layer) {
  const renderedSizePx = layer.box.height * STORY_HEIGHT * (layer.typo?.sizeRatio ?? 1);
  const isBold = (layer.typo?.weight ?? 400) >= 600;
  const isLargeText = renderedSizePx >= (isBold ? MIN_BOLD_LARGE_TEXT_PX : MIN_REGULAR_LARGE_TEXT_PX);
  return isLargeText ? MIN_LARGE_TEXT_BACKING_CONTRAST : MIN_TEXT_BACKING_CONTRAST;
}

function paletteColours(doc) {
  const roles = doc.restyle?.paletteRoles;
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return new Set();
  return new Set(Object.values(roles).filter((value) => hexRgb(value)).map((value) => String(value).toLowerCase()));
}

function medianRgb(samples) {
  return [0, 1, 2].map((channel) => {
    const values = samples.map((sample) => sample[channel]).sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  });
}

function isSamplingOccluder(layer) {
  return layer.type === "text"
    || layer.type === "icon"
    || layer.type === "image_slot"
    || layer.type === "overlay_patch"
    || isOpaqueVectorBacking(layer);
}

function topmostLayerAtPoint(layers, x, y) {
  return layers
    .map((layer, index) => ({ layer, order: layerOrder(layer, index) }))
    .filter(({ layer }) => isSamplingOccluder(layer) && containsPoint(layer.box, x, y))
    .sort((left, right) => right.order - left.order)[0]?.layer ?? null;
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
  const policyBackingRgb = hexRgb(policy.backingColour);
  const allowedBackingColours = paletteColours(doc);
  allowedBackingColours.add(STORY_BACKING_COLOUR);
  if (!policyBackingRgb) {
    blockers.push("Story backingColour must be a valid design-system hex colour");
  } else if (!allowedBackingColours.has(String(policy.backingColour).toLowerCase())) {
    blockers.push("Story backingColour must belong to the template design system");
  }

  const text = story.layers.filter((layer) => layer.type === "text");
  for (const layer of text) {
    if (layer.box.y * STORY_HEIGHT < STORY_SAFE_TOP || (layer.box.y + layer.box.height) * STORY_HEIGHT > STORY_HEIGHT - STORY_SAFE_BOTTOM) {
      blockers.push(`text layer ${layer.id} breaks the Story safe zone`);
    }
    const overflow = paintedBoundsOverflowPx(layer);
    if (overflow && Object.values(overflow).some((value) => value > MAX_PAINTED_BOUNDS_OVERFLOW_PX)) {
      const sides = Object.entries(overflow)
        .filter(([, value]) => value > MAX_PAINTED_BOUNDS_OVERFLOW_PX)
        .map(([side, value]) => `${side} ${Math.round(value)}px`)
        .join(", ");
      blockers.push(`Story text layer ${layer.id} painted bounds exceed declared geometry (${sides})`);
    }
  }

  const essentialText = text
    .map((layer) => ({ layer, role: roleFor(layer), bounds: normalizedPaintedBounds(layer) ?? layer.box }))
    .filter(({ role }) => role !== null)
    .sort((left, right) => left.layer.box.y - right.layer.box.y);
  const declaredCtaLayerIds = new Set(policy.ctaGroup?.layerIds ?? []);
  for (let leftIndex = 0; leftIndex < essentialText.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < essentialText.length; rightIndex += 1) {
      const left = essentialText[leftIndex];
      const right = essentialText[rightIndex];
      if (declaredCtaLayerIds.has(left.layer.id) && declaredCtaLayerIds.has(right.layer.id)) continue;
      const gap = verticalGap(left.bounds, right.bounds);
      if (gap < -MIN_TEXT_OVERLAP_PX && horizontalOverlap(left.bounds, right.bounds) > 0) {
        blockers.push(`Story essential text layers ${left.layer.id} (${left.role}) and ${right.layer.id} (${right.role}) overlap by ${Math.round(-gap)}px vertically`);
      }
    }
  }

  const byId = new Map(story.layers.map((layer) => [layer.id, layer]));
  const declaredBackings = policy.backingLayerIds.map((id) => byId.get(id)).filter(Boolean);
  const support = text.find((layer) => roleFor(layer) === "supporting");
  const supportBacking = support
    ? declaredBackings.find((layer) => layer.type === "overlay_patch" && coversText(layer, support, 0.9))
    : null;
  if (support && !supportBacking) blockers.push("supporting copy requires a full-coverage declared backing patch");

  const ctaIds = policy.ctaGroup.layerIds;
  const ctaLayers = ctaIds.map((id) => byId.get(id)).filter((layer) => layer?.type === "text");
  if (ctaLayers.length < 2) {
    blockers.push("Story CTA must group handle and arrow layers");
  } else {
    const ctaTop = Math.min(...ctaLayers.map((layer) => layer.box.y));
    const ctaBottom = Math.max(...ctaLayers.map((layer) => layer.box.y + layer.box.height));
    const ctaYSpread = (Math.max(...ctaLayers.map((layer) => layer.box.y)) - Math.min(...ctaLayers.map((layer) => layer.box.y))) * STORY_HEIGHT;
    if (ctaYSpread > STORY_CTA_MAX_GAP_PX || (ctaBottom - ctaTop) * STORY_HEIGHT > STORY_MAX_DEAD_SPACE_PX) blockers.push("Story CTA group is too spread out");
    const sharedCtaBacking = declaredBackings.find((layer) => (
      layer.type === "overlay_patch" && ctaLayers.every((textLayer) => coversText(layer, textLayer))
    ));
    if (!sharedCtaBacking) {
      blockers.push("Story CTA group requires one shared declared backing patch");
    }
  }

  const images = story.layers.filter(isContentImageSlot);
  const occupied = [...images, ...text].map((layer) => ({ y: layer.box.y, height: layer.box.height })).sort((a, b) => a.y - b.y);
  let maxGap = 0;
  for (let index = 1; index < occupied.length; index += 1) maxGap = Math.max(maxGap, verticalGap(occupied[index - 1], occupied[index]));
  if (maxGap > STORY_MAX_DEAD_SPACE_PX) blockers.push(`Story dead space ${Math.round(maxGap)}px exceeds the canonical ${STORY_MAX_DEAD_SPACE_PX}px`);

  const backingTextLayers = [support, ...ctaLayers].filter(Boolean);
  for (const layer of backingTextLayers) {
    const backing = policyBackingRgb ? effectiveBacking(story.layers, layer, policyBackingRgb) : null;
    if (!backing?.rgb) {
      blockers.push(`Story text layer ${layer.id} has no verifiable rendered backing`);
      continue;
    }
    const colours = textColours(layer);
    if (!colours.length) {
      blockers.push(`Story text layer ${layer.id} must declare a colour for backing contrast verification`);
      continue;
    }
    const minimumContrast = minimumContrastFor(layer);
    for (const colour of colours) {
      const rgb = hexRgb(colour);
      if (!rgb || contrastRatio(rgb, backing.rgb) < minimumContrast) {
        blockers.push(`Story text layer ${layer.id} does not meet ${minimumContrast}:1 contrast against its rendered backing`);
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
    for (const yFraction of BACKING_Y_SAMPLE_FRACTIONS) {
      for (const xFraction of BACKING_X_SAMPLE_FRACTIONS) {
        const x = layer.box.x + layer.box.width * xFraction;
        const y = layer.box.y + layer.box.height * yFraction;
        // Sample only pixels where this declared patch is actually topmost.
        // Later text, vectors, images, or another patch are intentional
        // authored content and must not be mistaken for backing corruption.
        if (topmostLayerAtPoint(story.layers, x, y)?.id === layer.id) points.push([x, y]);
      }
    }
    if (points.length < 3) {
      const coveredText = backingTextLayers.filter((textLayer) => coversText(layer, textLayer));
      const allUseLaterVectorBackings = coveredText.length > 0 && coveredText.every((textLayer) => {
        const backing = policyBackingRgb ? effectiveBacking(story.layers, textLayer, policyBackingRgb) : null;
        return backing?.layer?.type === "vector";
      });
      if (!allUseLaterVectorBackings) {
        blockers.push(`Story backing ${id} has too few unobscured interior samples for uniformity verification`);
      }
      continue;
    }
    const samples = points.map(([xNorm, yNorm]) => {
      const x = Math.min(STORY_WIDTH - 1, Math.max(0, Math.round(xNorm * STORY_WIDTH)));
      const y = Math.min(STORY_HEIGHT - 1, Math.max(0, Math.round(yNorm * STORY_HEIGHT)));
      const offset = (y * raw.info.width + x) * raw.info.channels;
      return [raw.data[offset], raw.data[offset + 1], raw.data[offset + 2]];
    });
    const renderedBackingRgb = medianRgb(samples);
    if (policyBackingRgb && renderedBackingRgb.some((value, index) => Math.abs(value - policyBackingRgb[index]) > MAX_EXPECTED_BACKING_DELTA)) {
      blockers.push(`Story backing ${id} does not match its declared design-system colour`);
      continue;
    }
    if (samples.some((sample) => sample.some((value, index) => Math.abs(value - renderedBackingRgb[index]) > MAX_UNIFORM_BACKING_DELTA))) {
      blockers.push(`Story backing ${id} is not rendered uniformly in its design-system colour`);
    }
  }

  return { passed: blockers.length === 0, blockers };
}
