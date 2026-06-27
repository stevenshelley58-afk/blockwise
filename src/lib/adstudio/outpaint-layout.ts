// Pure, browser-safe geometry for truth-preserving outpaint/extend.
//
// Given a source image (W x H) and a target ad frame, this computes how to lay
// the original out on the target canvas so the WHOLE original stays visible
// (no crop) and only the surrounding margin needs to be filled by the model.
// The margin rectangles are the "mask" regions — the only pixels the model is
// allowed to invent (neutral edges / sky / wall / floor / garden), which is what
// keeps the repair truth-preserving.
//
// No DOM, no canvas, no network — just numbers — so it is unit-testable and safe
// to import from artifacts/server code alike. Actual pixel compositing (drawing
// the padded image + mask PNG) happens at the call site that has a canvas.

export type OutpaintTarget = { width: number; height: number };

export type OutpaintRect = { x: number; y: number; width: number; height: number };

export type OutpaintLayout = {
  /** Target canvas the model must produce. */
  target: OutpaintTarget;
  /** Where the untouched original is placed on the target canvas. */
  placement: OutpaintRect;
  /** Margin rectangles to fill (the mask). Empty when the source already fits. */
  maskRects: OutpaintRect[];
  /** Fraction of the target area the model must invent (0 = perfect fit). */
  fillRatio: number;
  /** True when any extend is needed at all. */
  requiresOutpaint: boolean;
};

const ASPECT_TARGETS: Record<string, OutpaintTarget> = {
  // Consistent with the generations path; all satisfy gpt-image-2 size
  // constraints (edges multiple of 16, ratio <= 3:1). Cost-tune later.
  "9:16": { width: 1024, height: 1792 },
  "1.91:1": { width: 1792, height: 1024 },
  "4:5": { width: 1024, height: 1280 },
  "1:1": { width: 1024, height: 1024 },
};

/** Maps an Ad Studio aspect ratio to the target pixel size we ask the model for. */
export function outpaintTargetForAspect(aspectRatio: string): OutpaintTarget {
  return ASPECT_TARGETS[aspectRatio] ?? ASPECT_TARGETS["1:1"];
}

/** Serialises a target into the `size` string the OpenAI image API expects. */
export function formatImageSize(target: OutpaintTarget): string {
  return `${target.width}x${target.height}`;
}

// A source whose aspect ratio is within this tolerance of the target needs no
// extend — focal cover/crop alone fits it, so we skip the (paid, slow) AI edit.
const ASPECT_TOLERANCE = 0.01;

/**
 * Lay the full source out on the target canvas ("contain": no crop), optionally
 * biased toward a normalized focal point (0..1), and return the margin rects the
 * model must fill.
 */
export function computeOutpaintLayout(input: {
  sourceWidth: number;
  sourceHeight: number;
  target: OutpaintTarget;
  /** Normalized focal point (0..1) to bias placement toward; defaults to centre. */
  focalPoint?: { x: number; y: number };
}): OutpaintLayout {
  const { sourceWidth, sourceHeight, target } = input;

  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error("computeOutpaintLayout requires positive source dimensions.");
  }
  if (!(target.width > 0) || !(target.height > 0)) {
    throw new Error("computeOutpaintLayout requires positive target dimensions.");
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = target.width / target.height;
  const requiresOutpaint = Math.abs(sourceAspect - targetAspect) > ASPECT_TOLERANCE;

  if (!requiresOutpaint) {
    return {
      target,
      placement: { x: 0, y: 0, width: target.width, height: target.height },
      maskRects: [],
      fillRatio: 0,
      requiresOutpaint: false,
    };
  }

  // "Contain" scale: the whole original is visible, margins appear on one axis.
  const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
  const placedWidth = roundToEven(sourceWidth * scale, target.width);
  const placedHeight = roundToEven(sourceHeight * scale, target.height);

  const focalX = clamp01(input.focalPoint?.x ?? 0.5);
  const focalY = clamp01(input.focalPoint?.y ?? 0.5);
  const x = Math.round(clamp(focalX * target.width - placedWidth / 2, 0, target.width - placedWidth));
  const y = Math.round(clamp(focalY * target.height - placedHeight / 2, 0, target.height - placedHeight));

  const placement: OutpaintRect = { x, y, width: placedWidth, height: placedHeight };
  const maskRects = marginRects(placement, target);
  const placedArea = placedWidth * placedHeight;
  const targetArea = target.width * target.height;
  const fillRatio = clamp01((targetArea - placedArea) / targetArea);

  return { target, placement, maskRects, fillRatio, requiresOutpaint: true };
}

/** The rectangles around `placement` within `target` — the regions to fill. */
function marginRects(placement: OutpaintRect, target: OutpaintTarget): OutpaintRect[] {
  const rects: OutpaintRect[] = [];
  const right = placement.x + placement.width;
  const bottom = placement.y + placement.height;

  if (placement.y > 0) rects.push({ x: 0, y: 0, width: target.width, height: placement.y });
  if (bottom < target.height) {
    rects.push({ x: 0, y: bottom, width: target.width, height: target.height - bottom });
  }
  if (placement.x > 0) {
    rects.push({ x: 0, y: placement.y, width: placement.x, height: placement.height });
  }
  if (right < target.width) {
    rects.push({ x: right, y: placement.y, width: target.width - right, height: placement.height });
  }

  return rects;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

// Keep placed edges on even pixels (and never larger than the target edge) so the
// padded canvas the caller builds lines up cleanly with the target.
function roundToEven(value: number, max: number): number {
  const rounded = Math.min(Math.round(value / 2) * 2, max);
  return Math.max(rounded, 2);
}
