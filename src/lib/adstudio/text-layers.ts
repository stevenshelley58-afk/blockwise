// Derived text-editing layers ("magic layers") for AI-designed creatives.
//
// One background pass per creative builds two things from the finished flat
// render:
//   1. A "plate": the render with every text region inpainted away, so the
//      clean background under each headline/price/CTA is known.
//   2. Per-region type treatments (family category, weight, colour, align…)
//      detected by one vision call.
//
// With those in hand, a text edit becomes deterministic: the BROWSER re-typesets
// the customer's exact copy over the plate crop (browsers have real fonts;
// serverless sharp has no fontconfig — see rasterize-reference.ts), and the
// server just composites the patch onto the current render. No image-model
// round trip, ~1s total, character-for-character exact.
//
// The flat render stays canonical everywhere else in the product. Layers are
// advisory and validity-tracked: composites only run against renders listed in
// `validFor`; anything else drops the layers and a background rebuild runs.

import type { ImageProviderRequest } from "./providers.ts";
import type { AdStudioCloneRegion, AdStudioTextLayers, AdStudioTextLayerStyle } from "./types.ts";
import type { AdStudioTemplate } from "./templates.ts";
import { GLOBAL_CLONE_NEGATIVES } from "./reference-clone.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import { paddedPixelRect } from "./region-edit.ts";
import {
  MAGIC_LAYER_MIN_FONT_FIT,
  MAGIC_LAYER_MIN_REGION_CONFIDENCE,
} from "./magic-layers-config.mjs";

type NormalizedBox = { x: number; y: number; width: number; height: number };

/** Renders the plate stays valid for; bounded so canvas_json cannot grow unbounded. */
export const TEXT_LAYERS_VALID_FOR_LIMIT = 12;

/** Patch uploads are one small region crop; anything bigger is not a patch. */
export const MAX_TEXT_PATCH_BYTES = 4 * 1024 * 1024;

export function textRegionsOf(regions: AdStudioCloneRegion[] | undefined): AdStudioCloneRegion[] {
  return (regions ?? []).filter((region) => region.kind === "text" && region.box.width > 0 && region.box.height > 0);
}

/**
 * Converts the offline template measurements into runtime styles. The
 * finished clone's detected boxes remain authoritative; the sample boxes are
 * build-time priors only. A region becomes live only when both independent
 * confidence gates passed and its exact self-hosted face exists.
 */
export function buildTemplateTextLayerStyles(
  template: AdStudioTemplate,
  regions: AdStudioCloneRegion[],
): Record<string, AdStudioTextLayerStyle> {
  const textInputs = new Map(template.inputs.text.map((input) => [input.key, input]));
  const styles: Record<string, AdStudioTextLayerStyle> = {};
  for (const region of textRegionsOf(regions)) {
    const spec = template.typography?.[region.key];
    const input = textInputs.get(region.key);
    if (!spec || !input) continue;
    const live = spec.fitScore >= MAGIC_LAYER_MIN_FONT_FIT
      && spec.detectionScore >= MAGIC_LAYER_MIN_REGION_CONFIDENCE
      && Boolean(spec.fontFile);
    styles[region.key] = {
      fontId: spec.fontId,
      family: spec.family,
      fontFile: spec.fontFile,
      fallbackFamily: spec.fallbackFamily,
      weight: spec.weight,
      italic: spec.italic,
      case: spec.case,
      sizeRatio: spec.sizeRatio,
      lineHeight: spec.lineHeight,
      tracking: spec.tracking,
      color: spec.color,
      align: spec.align,
      fitScore: spec.fitScore,
      sampleLineCount: spec.sampleLineCount,
      sample: input.sample,
      maxLength: input.maxLength,
      mode: live ? "live" : "rerender",
    };
  }
  return styles;
}

/** True when `box` (grown by the compositing tolerance) overlaps any text region. */
export function boxIntersectsTextRegions(
  box: NormalizedBox | undefined,
  regions: AdStudioCloneRegion[] | undefined,
  tolerance = 0.02,
): boolean {
  if (!box) return true; // No box means a full-image edit: everything is touched.
  return textRegionsOf(regions).some((region) => {
    const r = region.box;
    return box.x - tolerance < r.x + r.width
      && box.x + box.width + tolerance > r.x
      && box.y - tolerance < r.y + r.height
      && box.y + box.height + tolerance > r.y;
  });
}

/** Append a render ref to the plate's validity list, newest last, bounded. */
export function extendTextLayersValidity(layers: AdStudioTextLayers, renderRef: string): AdStudioTextLayers {
  const validFor = [...layers.validFor.filter((ref) => ref !== renderRef), renderRef]
    .slice(-TEXT_LAYERS_VALID_FOR_LIMIT);
  return { ...layers, validFor };
}

/** The one full-render inpaint request that builds the text-free plate. */
export function buildPlateInpaintRequest(input: {
  currentImage: string;
  aspectRatio: string;
}): ImageProviderRequest {
  return {
    prompt:
      "Reference image 1 is a finished ad. Remove every piece of text, lettering, and typography inside the masked regions, "
      + "reconstructing the underlying background surfaces, colours, gradients, shapes, and photo content exactly as they would "
      + "appear without the text. Do not move, restyle, or redraw anything else. Keep every pixel outside the masked regions unchanged.",
    negativePrompt: GLOBAL_CLONE_NEGATIVES,
    referenceAssets: [input.currentImage],
    aspectRatio: input.aspectRatio,
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: 1,
  };
}

async function imageBytes(assetUrl: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  if (assetUrl.startsWith("data:image/")) return dataUrlToUploadBytes(assetUrl).bytes;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Creative image could not be prepared (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Derive the final plate from the model's inpaint output: start from the
 * ORIGINAL render and take only the padded text-region rectangles from the
 * model. Every pixel outside a text region is byte-for-byte the original, so
 * model drift can never leak into the design.
 */
export async function derivePlateFromInpaint(
  originalAssetUrl: string,
  inpaintedAssetUrl: string,
  textBoxes: NormalizedBox[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const [originalBytes, inpaintedBytes] = await Promise.all([
    imageBytes(originalAssetUrl, fetchImpl),
    imageBytes(inpaintedAssetUrl, fetchImpl),
  ]);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read.");
  const width = metadata.width;
  const height = metadata.height;

  // Models may return a different size; normalize before pixel math.
  const normalizedInpaint = await sharp(inpaintedBytes)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  const overlays = await Promise.all(textBoxes.map(async (box) => {
    const rect = paddedPixelRect(box, width, height);
    const input = await sharp(normalizedInpaint)
      .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .png()
      .toBuffer();
    return { input, left: rect.left, top: rect.top };
  }));

  const plate = await sharp(originalBytes).composite(overlays).png().toBuffer();
  return `data:image/png;base64,${plate.toString("base64")}`;
}

/**
 * Composite a client-rendered text patch onto the current render. The patch is
 * clamped to the selected region's padded rectangle — the client can only ever
 * affect the same pixels a model edit could.
 */
export async function compositeTextPatch(
  currentAssetUrl: string,
  patchDataUrl: string,
  box: NormalizedBox,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!patchDataUrl.startsWith("data:image/")) throw new Error("The rendered text patch could not be read.");
  const patch = dataUrlToUploadBytes(patchDataUrl);
  if (patch.bytes.byteLength > MAX_TEXT_PATCH_BYTES) throw new Error("The rendered text patch is too large.");

  const originalBytes = await imageBytes(currentAssetUrl, fetchImpl);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");

  const rect = paddedPixelRect(box, metadata.width, metadata.height);
  const normalizedPatch = await sharp(patch.bytes)
    .resize(rect.width, rect.height, { fit: "fill" })
    .png()
    .toBuffer();
  const composited = await sharp(originalBytes)
    .composite([{ input: normalizedPatch, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${composited.toString("base64")}`;
}
