// Crop-region image edits.
//
// Instead of sending the FULL finished ad to the image model (expensive: the
// model repaints pixels we will throw away), we crop a padded window around the
// selected QA region, send ONLY that crop, and composite the model's edited box
// back onto the original. Every pixel outside the selected region stays
// byte-for-byte deterministic, exactly like the legacy full-image path in
// clone-generation.ts (compositeCloneRegionEdit) — we just spend far fewer
// model pixels to get there.

import { dataUrlToUploadBytes } from "./generated-media.ts";

type NormalizedBox = { x: number; y: number; width: number; height: number };

/** Pixel rectangle relative to the full original image, top-left origin. */
export type CropRect = { left: number; top: number; width: number; height: number };

export type CroppedRegion = {
  croppedDataUrl: string;
  cropRect: CropRect;
  width: number;
  height: number;
  /** Full original image dimensions, needed to re-base boxes into the crop. */
  originalWidth: number;
  originalHeight: number;
};

// Same antialiasing/edge breathing room compositeCloneRegionEdit uses, so the
// cropped path and the legacy full-image path composite identically.
const COMPOSITE_PADDING = 0.02;

async function loadImageBytes(assetUrl: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  if (assetUrl.startsWith("data:image/")) return dataUrlToUploadBytes(assetUrl).bytes;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Creative image could not be prepared for editing (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Crop a padded window around the selected region.
 *
 * padFraction expands the box by that fraction of the box's own size on every
 * side (default 0.15 — comfortably larger than the 0.02 compositing tolerance,
 * so the editable box always sits fully inside the crop). The rectangle is
 * clamped to the image bounds. If no usable box is supplied the whole image is
 * returned as the crop so callers can fall back to a full-image edit.
 */
export async function cropRegionWithPadding(
  originalAssetUrl: string,
  box?: NormalizedBox,
  options?: { padFraction?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<CroppedRegion> {
  const bytes = await loadImageBytes(originalAssetUrl, fetchImpl);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");
  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  if (!box || box.width <= 0 || box.height <= 0) {
    // No region: the "crop" is the whole image, so the edit degrades to the
    // legacy full-image behaviour rather than failing.
    const png = await sharp(bytes).png({ compressionLevel: 1 }).toBuffer();
    return {
      croppedDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      cropRect: { left: 0, top: 0, width: imageWidth, height: imageHeight },
      width: imageWidth,
      height: imageHeight,
      originalWidth: imageWidth,
      originalHeight: imageHeight,
    };
  }

  const padFraction = options?.padFraction ?? 0.15;
  const boxLeft = box.x * imageWidth;
  const boxTop = box.y * imageHeight;
  const boxWidth = box.width * imageWidth;
  const boxHeight = box.height * imageHeight;
  const padX = padFraction * boxWidth;
  const padY = padFraction * boxHeight;

  const left = clamp(Math.floor(boxLeft - padX), 0, imageWidth - 1);
  const top = clamp(Math.floor(boxTop - padY), 0, imageHeight - 1);
  const right = clamp(Math.ceil(boxLeft + boxWidth + padX), left + 1, imageWidth);
  const bottom = clamp(Math.ceil(boxTop + boxHeight + padY), top + 1, imageHeight);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const cropped = await sharp(bytes)
    .extract({ left, top, width, height })
    .png({ compressionLevel: 1 })
    .toBuffer();
  return {
    croppedDataUrl: `data:image/png;base64,${cropped.toString("base64")}`,
    cropRect: { left, top, width, height },
    width,
    height,
    originalWidth: imageWidth,
    originalHeight: imageHeight,
  };
}

/**
 * Re-express a full-image normalized box in the crop's normalized coordinate
 * space, so createCloneRegionEditMask can build a mask against the crop.
 * Returns undefined when there is no usable box (caller skips the mask).
 */
export function rebaseBoxToCrop(
  box: NormalizedBox | undefined,
  cropRect: CropRect,
  originalWidth: number,
  originalHeight: number,
): NormalizedBox | undefined {
  if (!box || box.width <= 0 || box.height <= 0 || cropRect.width <= 0 || cropRect.height <= 0) {
    return undefined;
  }
  const x = clamp((box.x * originalWidth - cropRect.left) / cropRect.width, 0, 1);
  const y = clamp((box.y * originalHeight - cropRect.top) / cropRect.height, 0, 1);
  const width = clamp((box.width * originalWidth) / cropRect.width, 0, 1 - x);
  const height = clamp((box.height * originalHeight) / cropRect.height, 0, 1 - y);
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/**
 * Composite the model's edited crop back onto the full original.
 *
 * The edited crop is first normalized back to the crop's original pixel size
 * (models may resize their output), then ONLY the selected box — re-based into
 * crop-local pixels and grown by the same ±0.02 tolerance the legacy path uses —
 * is extracted and pasted onto the original at the box's full-image position.
 * Everything outside the box comes from the original, unchanged.
 */
export async function compositeRegionBack(
  originalAssetUrl: string,
  editedCropAssetUrl: string,
  cropRect: CropRect,
  box?: NormalizedBox,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const [originalBytes, editedBytes] = await Promise.all([
    loadImageBytes(originalAssetUrl, fetchImpl),
    loadImageBytes(editedCropAssetUrl, fetchImpl),
  ]);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");
  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  // Bring the model's edited crop back to the crop's true pixel dimensions so
  // crop-local pixel math lines up regardless of what size the model returned.
  const normalizedCrop = await sharp(editedBytes)
    .resize(cropRect.width, cropRect.height, { fit: "fill" })
    .png({ compressionLevel: 1 })
    .toBuffer();

  if (!box || box.width <= 0 || box.height <= 0) {
    // No region: the crop was the whole image, so the edited crop IS the result.
    const full = await sharp(normalizedCrop)
      .resize(imageWidth, imageHeight, { fit: "fill" })
      .png({ compressionLevel: 1 })
      .toBuffer();
    return `data:image/png;base64,${full.toString("base64")}`;
  }

  // Selected box in full-image pixels, grown by the compositing tolerance —
  // identical math to compositeCloneRegionEdit.
  const fullLeft = Math.max(0, Math.floor((box.x - COMPOSITE_PADDING) * imageWidth));
  const fullTop = Math.max(0, Math.floor((box.y - COMPOSITE_PADDING) * imageHeight));
  const fullRight = Math.min(imageWidth, Math.ceil((box.x + box.width + COMPOSITE_PADDING) * imageWidth));
  const fullBottom = Math.min(imageHeight, Math.ceil((box.y + box.height + COMPOSITE_PADDING) * imageHeight));
  const fullWidth = Math.max(1, fullRight - fullLeft);
  const fullHeight = Math.max(1, fullBottom - fullTop);

  // Re-base that box into crop-local pixels and clamp to the crop bounds.
  const cropLocalLeft = clamp(fullLeft - cropRect.left, 0, cropRect.width - 1);
  const cropLocalTop = clamp(fullTop - cropRect.top, 0, cropRect.height - 1);
  const cropLocalRight = clamp(fullRight - cropRect.left, cropLocalLeft + 1, cropRect.width);
  const cropLocalBottom = clamp(fullBottom - cropRect.top, cropLocalTop + 1, cropRect.height);
  const regionWidth = Math.max(1, cropLocalRight - cropLocalLeft);
  const regionHeight = Math.max(1, cropLocalBottom - cropLocalTop);

  const editedRegion = await sharp(normalizedCrop)
    .extract({ left: cropLocalLeft, top: cropLocalTop, width: regionWidth, height: regionHeight })
    .png({ compressionLevel: 1 })
    .toBuffer();

  const composited = await sharp(originalBytes)
    .composite([{ input: editedRegion, left: fullLeft, top: fullTop }])
    .png({ compressionLevel: 1 })
    .toBuffer();
  return `data:image/png;base64,${composited.toString("base64")}`;
}
