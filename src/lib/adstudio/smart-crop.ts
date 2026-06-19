// Subject-aware (saliency) crop helpers.
//
// Real-estate photos are mostly wide shots where the house carries the visual
// detail and the rest is sky, lawn, or driveway. A plain cover-fit anchored to
// a corner (or even centred) routinely chops the house. These helpers find the
// busiest region of the image (an edge-energy centroid) and place a cover-fit
// so that region stays inside the ad frame.
//
// The maths lives in pure functions so it is unit-testable without a DOM. The
// only browser-dependent piece is `computeFocalPointFromImageSource`, which
// samples pixels via a canvas and falls back to the centre on any failure
// (including cross-origin tainted canvases).

export type FocalPoint = { x: number; y: number };

export const CENTER_FOCAL: FocalPoint = { x: 0.5, y: 0.5 };

/** Clamp `value` to the inclusive [min, max] range (handles min > max safely). */
function clampRange(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function clamp01(value: number): number {
  return clampRange(value, 0, 1);
}

/**
 * Edge-energy centroid of a luminance buffer, returned as fractions in [0, 1].
 *
 * Uses an absolute Sobel-style gradient as a cheap saliency proxy: detailed
 * regions (a house facade, windows, rooflines) have high gradient energy, while
 * flat sky/lawn contributes little. The centroid is biased back toward the
 * centre and clamped away from the extreme edges so the focal point never pins
 * the subject hard against a frame edge.
 */
export function computeFocalPointFromLuma(
  luma: ArrayLike<number>,
  width: number,
  height: number,
): FocalPoint {
  if (width < 3 || height < 3 || luma.length < width * height) {
    return { ...CENTER_FOCAL };
  }

  let sumW = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + width] - luma[i - width];
      const energy = Math.abs(gx) + Math.abs(gy);
      sumW += energy;
      sumX += energy * x;
      sumY += energy * y;
    }
  }

  // A nearly flat image has no meaningful subject - keep it centred.
  if (sumW <= 1e-6) {
    return { ...CENTER_FOCAL };
  }

  const rawX = sumX / sumW / (width - 1);
  const rawY = sumY / sumW / (height - 1);

  // Pull the focal point 30% of the way back to centre to keep crops stable,
  // then keep it inside a safe band so we never shove the subject to an edge.
  const CENTER_BIAS = 0.3;
  const x = clampRange(rawX * (1 - CENTER_BIAS) + 0.5 * CENTER_BIAS, 0.15, 0.85);
  const y = clampRange(rawY * (1 - CENTER_BIAS) + 0.5 * CENTER_BIAS, 0.15, 0.85);

  return { x: clamp01(x), y: clamp01(y) };
}

export type FrameBox = { left: number; top: number; width: number; height: number };

export type CoverPlacement = {
  scale: number;
  left: number;
  top: number;
  scaledWidth: number;
  scaledHeight: number;
};

/**
 * Compute a cover-fit placement (the smallest scale that fully covers the
 * frame) and offset it so `focal` sits at the frame centre, clamped so the
 * scaled image always fully covers the frame (no gaps).
 */
export function focalCoverPlacement(params: {
  frame: FrameBox;
  sourceWidth: number;
  sourceHeight: number;
  focal?: FocalPoint;
}): CoverPlacement {
  const { frame } = params;
  const sourceWidth = params.sourceWidth > 0 ? params.sourceWidth : frame.width;
  const sourceHeight = params.sourceHeight > 0 ? params.sourceHeight : frame.height;
  const focal = params.focal ?? CENTER_FOCAL;

  const scale = Math.max(frame.width / sourceWidth, frame.height / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;

  const desiredLeft = frame.left + frame.width / 2 - focal.x * scaledWidth;
  const desiredTop = frame.top + frame.height / 2 - focal.y * scaledHeight;

  // The image is >= the frame on each axis, so valid offsets run from
  // (frame far edge - scaled size) up to the frame near edge.
  const left = clampRange(desiredLeft, frame.left + frame.width - scaledWidth, frame.left);
  const top = clampRange(desiredTop, frame.top + frame.height - scaledHeight, frame.top);

  return { scale, left, top, scaledWidth, scaledHeight };
}

/**
 * Derive a focal point from an already-decoded image source by sampling it into
 * a small canvas. Returns the centre when no DOM/canvas is available or the
 * source taints the canvas (cross-origin without CORS), so callers can use the
 * result unconditionally.
 */
export function computeFocalPointFromImageSource(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  sampleSize = 64,
): FocalPoint {
  if (typeof document === "undefined" || naturalWidth < 3 || naturalHeight < 3) {
    return { ...CENTER_FOCAL };
  }

  try {
    const ratio = naturalWidth / naturalHeight;
    const width = ratio >= 1 ? sampleSize : Math.max(3, Math.round(sampleSize * ratio));
    const height = ratio >= 1 ? Math.max(3, Math.round(sampleSize / ratio)) : sampleSize;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { ...CENTER_FOCAL };

    ctx.drawImage(source, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    const luma = new Float32Array(width * height);
    for (let p = 0; p < luma.length; p += 1) {
      const o = p * 4;
      luma[p] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }

    return computeFocalPointFromLuma(luma, width, height);
  } catch {
    // Tainted canvas, zero-size source, etc. - degrade to a centre crop.
    return { ...CENTER_FOCAL };
  }
}
