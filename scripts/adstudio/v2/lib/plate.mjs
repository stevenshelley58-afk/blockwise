// Build-time plate derivation (Track C, §5). Ports the v1 mask + composite
// guarantees from clone-generation/layer-derivation: pixels OUTSIDE the text
// masks come from the SOURCE bytes — never a full-image repaint.

import sharp from "sharp";

export const TEXT_MASK_PADDING = 0.02;

/** Normalized boxes -> raw pixel box list on a canvas of known dims. */
export function paddedPixelBoxes(dimensions, boxes) {
  const { width, height } = dimensions;
  return boxes
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => {
      const x = Math.max(0, Math.floor((box.x - TEXT_MASK_PADDING) * width));
      const y = Math.max(0, Math.floor((box.y - TEXT_MASK_PADDING) * height));
      const right = Math.min(width, Math.ceil((box.x + box.width + TEXT_MASK_PADDING) * width));
      const bottom = Math.min(height, Math.ceil((box.y + box.height + TEXT_MASK_PADDING) * height));
      return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
    });
}

function inAnyBox(px, py, boxes) {
  return boxes.some((box) => px >= box.x && px < box.x + box.width && py >= box.y && py < box.y + box.height);
}

/**
 * Composite the inpaint result UNDER the source pixels: outside the masks the
 * output is byte-identical to the source; inside the masks it is the model's
 * repaint. The original-bytes-outside-mask guarantee, enforced in code.
 */
export async function compositePlateFromSource(sourceBytes, inpaintedBytes, normalizedBoxes) {
  const sourceMeta = await sharp(sourceBytes).metadata();
  const dimensions = { width: sourceMeta.width, height: sourceMeta.height };
  const boxes = paddedPixelBoxes(dimensions, normalizedBoxes);

  const [sourceRaw, inpaintedRaw] = await Promise.all([
    sharp(sourceBytes).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
    sharp(inpaintedBytes).resize(dimensions.width, dimensions.height).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  ]);

  const out = Buffer.alloc(sourceRaw.data.length);
  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      const i = (y * dimensions.width + x) * 4;
      const useInpaint = inAnyBox(x, y, boxes);
      const src = useInpaint ? inpaintedRaw.data : sourceRaw.data;
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = 255;
    }
  }
  return { png: await sharp(out, { raw: { width: dimensions.width, height: dimensions.height, channels: 4 } }).png().toBuffer(), dimensions };
}

/** Lossless WebP for plates/patches (repo size budget, plan §3). */
export async function toLosslessWebp(bytes) {
  return sharp(bytes).webp({ lossless: true }).toBuffer();
}

/** sha256 hex of a buffer. */
export async function sha256Hex(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}
