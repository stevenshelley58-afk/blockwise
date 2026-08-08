// Cover-crop placement with focal point and customer zoom.
//
// Extends smart-crop.ts's focalCoverPlacement (which stays put — it serves the
// v1 paths and the saliency defaults) with the instance-doc zoom control:
// zoom 1 = plain cover fit, zoom 3 = the focal point magnified 3x. The output
// is a SOURCE rect in the customer photo's own pixels, so the renderer can
// drawImage(srcRect -> slotRect) directly and the math is identical on both
// backends (parity test §4).

export type FocalPoint = { x: number; y: number };

export const CENTER_FOCAL: FocalPoint = { x: 0.5, y: 0.5 };

export type SourceRect = { sx: number; sy: number; sw: number; sh: number };

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
 * Which region of the source image fills a slot at cover fit.
 *
 * @param slotWidthPx  slot box width in canvas pixels
 * @param slotHeightPx slot box height in canvas pixels
 * @param imageWidth   customer photo width in its own pixels
 * @param imageHeight  customer photo height in its own pixels
 * @param focal        0..1 point of interest the crop should keep visible
 * @param zoom         1..3; 1 = plain cover fit, >1 magnifies around the focal
 */
export function focalCoverSourceRect(params: {
  slotWidthPx: number;
  slotHeightPx: number;
  imageWidth: number;
  imageHeight: number;
  focal?: FocalPoint;
  zoom?: number;
}): SourceRect {
  const { slotWidthPx, slotHeightPx } = params;
  const imageWidth = params.imageWidth > 0 ? params.imageWidth : slotWidthPx;
  const imageHeight = params.imageHeight > 0 ? params.imageHeight : slotHeightPx;
  const focal = { x: clamp01(params.focal?.x ?? 0.5), y: clamp01(params.focal?.y ?? 0.5) };
  const zoom = clampRange(params.zoom ?? 1, 1, 3);

  // Plain cover: the SMALLEST crop that fills the slot keeps maximum photo.
  // Zoom multiplies magnification around the focal point (3 = max zoom-in).
  const coverScale = Math.max(slotWidthPx / imageWidth, slotHeightPx / imageHeight);
  const scale = coverScale * zoom;

  // Source rect size: what the slot shows, in the photo's own pixels.
  let sw = slotWidthPx / scale;
  let sh = slotHeightPx / scale;

  // Very high zoom on a tiny photo can demand more pixels than exist; clamp
  // the rect to the image and let the slot letterbox-free stretch instead of
  // sampling outside the photo (drawImage clamps anyway, but explicit beats
  // implicit).
  sw = Math.min(sw, imageWidth);
  sh = Math.min(sh, imageHeight);

  // Centre the rect on the focal point, then clamp inside the image so the
  // focal stays visible and no gap can appear at the edges.
  const desiredSx = focal.x * imageWidth - sw / 2;
  const desiredSy = focal.y * imageHeight - sh / 2;
  const sx = clampRange(desiredSx, 0, imageWidth - sw);
  const sy = clampRange(desiredSy, 0, imageHeight - sh);

  return { sx, sy, sw, sh };
}
