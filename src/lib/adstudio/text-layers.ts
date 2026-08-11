// Derived text-editing layers ("magic layers") for AI-designed creatives.
//
// One background pass per creative builds two things from the finished flat
// render:
//   1. A "plate": the render with every text region inpainted away, so the
//      clean background under each headline/price/CTA is known.
//   2. Per-region type treatments (family category, weight, colour, align…)
//      detected by one vision call.
//
// With those in hand, a text edit becomes deterministic: the NODE route
// re-typesets the customer's exact copy over the plate crop using the bundled
// self-hosted face, then composites those server-owned pixels onto the current
// render. No image-model round trip, character-for-character exact.
//
// The flat render stays canonical everywhere else in the product. Layers are
// advisory and validity-tracked: composites only run against renders listed in
// `validFor`; anything else drops the layers and a background rebuild runs.

import type { ImageProviderRequest } from "./providers.ts";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { AdStudioCloneRegion, AdStudioTextLayers, AdStudioTextLayerStyle } from "./types.ts";
import type { AdStudioTemplate } from "./templates.ts";
import { GLOBAL_CLONE_NEGATIVES } from "./reference-clone.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import { paddedPixelRect } from "./region-edit.ts";
import {
  MAGIC_LAYER_MIN_AUTOFIT_RATIO,
  MAGIC_LAYER_MIN_FONT_FIT,
  MAGIC_LAYER_MIN_REGION_CONFIDENCE,
} from "./magic-layers-config.mjs";

type NormalizedBox = { x: number; y: number; width: number; height: number };

/** Renders the plate stays valid for; bounded so canvas_json cannot grow unbounded. */
export const TEXT_LAYERS_VALID_FOR_LIMIT = 12;

export { buildingTextLayers } from "./text-layer-state.ts";

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
      sampleBox: spec.sampleBox,
      measuredLines: spec.measuredLines,
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

type TextMetricsLike = {
  width: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
};

type ServerCanvasContext = {
  font: string;
  fillStyle: string;
  textBaseline: "middle";
  measureText(text: string): TextMetricsLike;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: unknown, dx: number, dy: number, dWidth: number, dHeight: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
};

type MeasuredLine = {
  text: string;
  sampleBox: NormalizedBox;
  sizeRatio: number;
  scaleX?: number;
};

const serverFontFamilies = new Set<string>();

function normalizedValue(style: AdStudioTextLayerStyle, text: string): string {
  if (style.case === "upper") return text.toUpperCase();
  if (style.case === "lower") return text.toLowerCase();
  return text;
}

export function resolveAuthoritativeFontPath(style: AdStudioTextLayerStyle): string {
  if (!style.fontFile?.startsWith("/fonts/adstudio/")) {
    throw new Error("This text area is not backed by an approved self-hosted font.");
  }
  const publicRoot = realpathSync(resolve(process.cwd(), "public"));
  const fontRoot = realpathSync(resolve(publicRoot, "fonts", "adstudio"));
  const requestedPath = resolve(publicRoot, `.${style.fontFile}`);
  if (!requestedPath.startsWith(`${fontRoot}${sep}`) || !existsSync(requestedPath)) {
    throw new Error("The approved text font is unavailable for editing.");
  }
  const fontPath = realpathSync(requestedPath);
  if (!fontPath.startsWith(`${fontRoot}${sep}`)) {
    throw new Error("The approved text font is unavailable for editing.");
  }
  return fontPath;
}

function serverFontFamily(fontPath: string): string {
  // The source manifest's family is display metadata. Use a path-derived
  // private family at runtime so two manifests can never overwrite each other
  // in the process-global native font registry.
  return `BlockwiseAdStudio_${createHash("sha256").update(fontPath).digest("hex").slice(0, 16)}`;
}

function fontString(style: AdStudioTextLayerStyle, family: string, sizePx: number): string {
  return `${style.italic ? "italic " : ""}${style.weight} ${sizePx}px "${family}"`;
}

function glyphs(text: string): string[] {
  return Array.from(text);
}

function trackedTextWidth(context: ServerCanvasContext, text: string, trackingPx: number): number {
  return context.measureText(text).width + trackingPx * Math.max(0, glyphs(text).length - 1);
}

function drawTrackedText(
  context: ServerCanvasContext,
  text: string,
  x: number,
  y: number,
  align: AdStudioTextLayerStyle["align"],
  trackingPx: number,
) {
  const characters = glyphs(text);
  const width = trackedTextWidth(context, text, trackingPx);
  let cursor = align === "left" ? x : align === "right" ? x - width : x - width / 2;
  for (const character of characters) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + trackingPx;
  }
}

function wrapToWidth(context: ServerCanvasContext, text: string, maxWidth: number, trackingPx: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && trackedTextWidth(context, candidate, trackingPx) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function splitTextIntoMeasuredLines(text: string, measured: MeasuredLine[]): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const count = Math.max(1, Math.min(measured.length, words.length || 1));
  if (count === 1) return [words.join(" ")];
  const weights = measured.slice(0, count).map((line) => Math.max(1, line.text.trim().split(/\s+/u).filter(Boolean).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const lines: string[] = [];
  let cursor = 0;
  let cumulativeWeight = 0;
  for (let line = 0; line < count; line += 1) {
    cumulativeWeight += weights[line]!;
    const remainingLines = count - line - 1;
    const desiredEnd = line === count - 1 ? words.length : Math.round((words.length * cumulativeWeight) / totalWeight);
    const take = Math.max(1, Math.min(desiredEnd - cursor, words.length - cursor - remainingLines));
    lines.push(words.slice(cursor, cursor + take).join(" "));
    cursor += take;
  }
  return lines;
}

function mapMeasuredLineBox(source: NormalizedBox, sampleRegion: NormalizedBox, currentRegion: NormalizedBox): NormalizedBox {
  const width = Math.max(sampleRegion.width, Number.EPSILON);
  const height = Math.max(sampleRegion.height, Number.EPSILON);
  return {
    x: currentRegion.x + ((source.x - sampleRegion.x) / width) * currentRegion.width,
    y: currentRegion.y + ((source.y - sampleRegion.y) / height) * currentRegion.height,
    width: (source.width / width) * currentRegion.width,
    height: (source.height / height) * currentRegion.height,
  };
}

/**
 * Re-typeset a text field from persisted server state and composite it onto
 * the current finished render. Client patch bytes are deliberately not an
 * input: they are only an optimistic browser display hint.
 */
export async function renderAuthoritativeTextEdit(input: {
  currentAssetUrl: string;
  plateAssetUrl: string;
  box: NormalizedBox;
  style: AdStudioTextLayerStyle;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.style.mode !== "live" || !input.style.fontFile) {
    throw new Error("Instant editing is not ready for this text area.");
  }
  if (input.text.length > input.style.maxLength) {
    throw new Error(`Keep the new text to ${input.style.maxLength} characters or less.`);
  }
  const fontPath = resolveAuthoritativeFontPath(input.style);
  const [{ createCanvas, loadImage, GlobalFonts }, originalBytes, plateBytes] = await Promise.all([
    import("@napi-rs/canvas"),
    imageBytes(input.currentAssetUrl, fetchImpl),
    imageBytes(input.plateAssetUrl, fetchImpl),
  ]);
  const family = serverFontFamily(fontPath);
  if (!serverFontFamilies.has(family)) {
    if (!GlobalFonts.registerFromPath(fontPath, family)) {
      throw new Error("The approved text font could not be loaded for editing.");
    }
    serverFontFamilies.add(family);
  }

  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");
  const rect = paddedPixelRect(input.box, metadata.width, metadata.height);
  const plateCrop = await sharp(plateBytes)
    .resize(metadata.width, metadata.height, { fit: "fill" })
    .extract(rect)
    .png()
    .toBuffer();
  const canvas = createCanvas(rect.width, rect.height);
  const context = canvas.getContext("2d") as unknown as ServerCanvasContext;
  context.drawImage(await loadImage(plateCrop), 0, 0, rect.width, rect.height);

  const value = normalizedValue(input.style, input.text);
  const inner = {
    left: Math.round(input.box.x * metadata.width) - rect.left,
    top: Math.round(input.box.y * metadata.height) - rect.top,
    width: Math.max(1, Math.round(input.box.width * metadata.width)),
    height: Math.max(1, Math.round(input.box.height * metadata.height)),
  };
  const tracking = input.style.tracking;
  context.fillStyle = input.style.color;
  context.textBaseline = "middle";
  const measuredLines = input.style.measuredLines as MeasuredLine[] | undefined;
  if (measuredLines?.length) {
    const values = splitTextIntoMeasuredLines(value, measuredLines);
    for (let index = 0; index < measuredLines.length; index += 1) {
      const source = measuredLines[index]!;
      const mapped = mapMeasuredLineBox(source.sampleBox, input.style.sampleBox ?? input.box, input.box);
      const local = {
        left: Math.round(mapped.x * metadata.width) - rect.left,
        top: Math.round(mapped.y * metadata.height) - rect.top,
        width: Math.max(1, Math.round(mapped.width * metadata.width)),
        height: Math.max(1, Math.round(mapped.height * metadata.height)),
      };
      let fontSize = Math.max(1, local.height * source.sizeRatio);
      const minimum = fontSize * MAGIC_LAYER_MIN_AUTOFIT_RATIO;
      const line = values[index] ?? "";
      const scaleX = source.scaleX ?? 1;
      for (; fontSize >= minimum; fontSize -= 0.5) {
        context.font = fontString(input.style, family, fontSize);
        if (trackedTextWidth(context, line, fontSize * tracking) * scaleX <= local.width * 0.98) break;
      }
      if (fontSize < minimum) throw new Error("That text does not fit this area. Shorten it and try again.");
      const x = input.style.align === "left" ? local.left + local.width * 0.01 : input.style.align === "right" ? local.left + local.width * 0.99 : local.left + local.width / 2;
      context.save();
      context.translate(x, local.top + local.height / 2);
      context.scale(scaleX, 1);
      drawTrackedText(context, line, 0, 0, input.style.align, fontSize * tracking);
      context.restore();
    }
  } else {
    const measuredSize = Math.max(1, inner.height * input.style.sizeRatio);
    const minimumSize = measuredSize * MAGIC_LAYER_MIN_AUTOFIT_RATIO;
    const maxTextWidth = inner.width * 0.98;
    let fontSize = measuredSize;
    let lines: string[] = [];
    for (; fontSize >= minimumSize; fontSize -= 0.5) {
      context.font = fontString(input.style, family, fontSize);
      const candidate = wrapToWidth(context, value, maxTextWidth, fontSize * tracking);
      if (candidate.length === 0) break;
      const measurements = candidate.map((line) => context.measureText(line));
      const widest = Math.max(...candidate.map((line) => trackedTextWidth(context, line, fontSize * tracking)));
      const tallestInk = Math.max(...measurements.map((measurement) => {
        const ink = measurement.actualBoundingBoxAscent + measurement.actualBoundingBoxDescent;
        return Number.isFinite(ink) && ink > 0 ? ink : fontSize;
      }));
      const paintedHeight = tallestInk + (candidate.length - 1) * fontSize * input.style.lineHeight;
      if (widest <= maxTextWidth && candidate.length <= input.style.sampleLineCount && paintedHeight <= inner.height * 1.02) {
        lines = candidate;
        break;
      }
    }
    if (lines.length === 0) throw new Error("That text does not fit this area. Shorten it and try again.");
    const anchorX = input.style.align === "left"
      ? inner.left + inner.width * 0.01
      : input.style.align === "right"
        ? inner.left + inner.width * 0.99
        : inner.left + inner.width / 2;
    const lineHeight = fontSize * input.style.lineHeight;
    const firstCenter = inner.top + inner.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => drawTrackedText(context, line, anchorX, firstCenter + index * lineHeight, input.style.align, fontSize * tracking));
  }

  const patch = await canvas.encode("png");
  const composited = await sharp(originalBytes)
    .composite([{ input: patch, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${composited.toString("base64")}`;
}
