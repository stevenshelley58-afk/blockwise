// Client-side optimistic text patch rendering.
//
// The browser renders the customer's exact copy over the clean plate crop for
// immediate feedback while the request is in flight. These pixels never leave
// the browser; the Node edit route independently rasterizes the persisted
// style and text before it stores a revision.

import type { AdStudioTextLayerStyle } from "@/lib/adstudio/types.ts";
import { MAGIC_LAYER_MIN_AUTOFIT_RATIO } from "../../../lib/adstudio/magic-layers-config.mjs";

type NormalizedBox = { x: number; y: number; width: number; height: number };

type MeasuredLine = { text: string; sampleBox: NormalizedBox; sizeRatio: number; scaleX?: number };

/** Mirrors COMPOSITE_PADDING in region-edit.ts so patch pixels line up exactly. */
export const PATCH_PADDING = 0.02;

/** Pixel rect math identical to the server's paddedPixelRect. */
export function paddedPatchRect(box: NormalizedBox, imageWidth: number, imageHeight: number) {
  const left = Math.max(0, Math.floor((box.x - PATCH_PADDING) * imageWidth));
  const top = Math.max(0, Math.floor((box.y - PATCH_PADDING) * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((box.x + box.width + PATCH_PADDING) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((box.y + box.height + PATCH_PADDING) * imageHeight));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Maps an offline line box into the current render's selected region. */
export function mapMeasuredLineBox(source: NormalizedBox, sampleRegion: NormalizedBox, currentRegion: NormalizedBox): NormalizedBox {
  const width = Math.max(sampleRegion.width, Number.EPSILON);
  const height = Math.max(sampleRegion.height, Number.EPSILON);
  return {
    x: currentRegion.x + ((source.x - sampleRegion.x) / width) * currentRegion.width,
    y: currentRegion.y + ((source.y - sampleRegion.y) / height) * currentRegion.height,
    width: (source.width / width) * currentRegion.width,
    height: (source.height / height) * currentRegion.height,
  };
}

/** Deterministic word partition; preserves the sample's measured line balance. */
export function splitTextIntoMeasuredLines(
  text: string,
  measured: number | Array<Pick<MeasuredLine, "text">>,
): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const templates = typeof measured === "number"
    ? Array.from({ length: measured }, () => ({ text: "" }))
    : measured;
  const count = Math.max(1, Math.min(templates.length, words.length || 1));
  if (count === 1) return [words.join(" ")];
  const weights = templates.slice(0, count).map((line) => (
    Math.max(1, line.text.trim().split(/\s+/u).filter(Boolean).length)
  ));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const lines: string[] = [];
  let cursor = 0;
  let cumulativeWeight = 0;
  for (let line = 0; line < count; line += 1) {
    cumulativeWeight += weights[line]!;
    const remainingLines = count - line - 1;
    const desiredEnd = line === count - 1
      ? words.length
      : Math.round((words.length * cumulativeWeight) / totalWeight);
    const take = Math.max(1, Math.min(
      desiredEnd - cursor,
      words.length - cursor - remainingLines,
    ));
    lines.push(words.slice(cursor, cursor + take).join(" "));
    cursor += take;
  }
  return lines;
}

export function scaledTextWidth(width: number, scaleX = 1): number {
  return width * scaleX;
}

export function loadPatchImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The editing plate could not be loaded."));
    image.src = src;
  });
}

function fontString(style: AdStudioTextLayerStyle, sizePx: number): string {
  return `${style.italic ? "italic " : ""}${style.weight} ${sizePx}px "${style.fontId}", ${style.fallbackFamily}`;
}

function wrapToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Render the replacement copy over the plate crop for one text region.
 * Returns a PNG data URL sized exactly to the region's padded pixel rect,
 * or null when the browser cannot produce a canvas (the caller falls back to
 * the model path).
 */
export function renderTextPatch(input: {
  plate: HTMLImageElement;
  box: NormalizedBox;
  style: AdStudioTextLayerStyle;
  text: string;
}): string | null {
  if (input.style.mode !== "live" || !input.style.fontFile) return null;
  const imageWidth = input.plate.naturalWidth;
  const imageHeight = input.plate.naturalHeight;
  if (!imageWidth || !imageHeight) return null;

  const rect = paddedPatchRect(input.box, imageWidth, imageHeight);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(
    input.plate,
    rect.left, rect.top, rect.width, rect.height,
    0, 0, rect.width, rect.height,
  );

  const value = input.style.case === "upper"
    ? input.text.toUpperCase()
    : input.style.case === "lower"
      ? input.text.toLowerCase()
      : input.text;
  // The writable area is the un-padded region box, in patch-local pixels.
  const inner = {
    left: Math.round(input.box.x * imageWidth) - rect.left,
    top: Math.round(input.box.y * imageHeight) - rect.top,
    width: Math.max(1, Math.round(input.box.width * imageWidth)),
    height: Math.max(1, Math.round(input.box.height * imageHeight)),
  };
  const maxTextWidth = inner.width * 0.98;
  if ("letterSpacing" in context) context.letterSpacing = `${input.style.tracking}em`;

  const measuredLines = input.style.measuredLines as MeasuredLine[] | undefined;
  if (measuredLines?.length) {
    const values = splitTextIntoMeasuredLines(value, measuredLines);
    context.fillStyle = input.style.color;
    context.textBaseline = "middle";
    context.textAlign = input.style.align;
    for (let index = 0; index < measuredLines.length; index += 1) {
      const source = measuredLines[index];
      const box = mapMeasuredLineBox(source.sampleBox, input.style.sampleBox ?? input.box, input.box);
      const local = {
        left: Math.round(box.x * imageWidth) - rect.left,
        top: Math.round(box.y * imageHeight) - rect.top,
        width: Math.max(1, Math.round(box.width * imageWidth)),
        height: Math.max(1, Math.round(box.height * imageHeight)),
      };
      let fontSize = Math.max(1, local.height * source.sizeRatio);
      const minimum = fontSize * MAGIC_LAYER_MIN_AUTOFIT_RATIO;
      const line = values[index] ?? "";
      const scaleX = source.scaleX ?? 1;
      for (; fontSize >= minimum; fontSize -= 0.5) {
        context.font = fontString(input.style, fontSize);
        if (scaledTextWidth(context.measureText(line).width, scaleX) <= local.width * 0.98) break;
      }
      if (fontSize < minimum) return null;
      const x = input.style.align === "left" ? local.left + local.width * 0.01 : input.style.align === "right" ? local.left + local.width * 0.99 : local.left + local.width / 2;
      context.save();
      context.translate(x, local.top + local.height / 2);
      context.scale(scaleX, 1);
      context.fillText(line, 0, 0);
      context.restore();
    }
    try { return canvas.toDataURL("image/png"); } catch { return null; }
  }

  // Preserve the measured sample size and line count. Small copy variations
  // may shrink to 88%; anything beyond that uses the clone model.
  const lineHeightFactor = input.style.lineHeight;
  const measuredSize = Math.max(1, inner.height * input.style.sizeRatio);
  const minimumSize = measuredSize * MAGIC_LAYER_MIN_AUTOFIT_RATIO;
  let fontSize = measuredSize;
  let lines: string[] = [];
  for (; fontSize >= minimumSize; fontSize -= 0.5) {
    context.font = fontString(input.style, fontSize);
    const candidate = wrapToWidth(context, value, maxTextWidth);
    if (candidate.length === 0) return null;
    const measurements = candidate.map((line) => context.measureText(line));
    const widest = Math.max(...measurements.map((measurement) => measurement.width));
    // The region box encloses visible glyph ink, not the CSS em line box.
    // Comparing `fontSize * lineHeight` against that box rejected correctly
    // measured faces (their em is normally 20-40% taller than their glyphs),
    // so "live" fields silently fell back to the image model. Browser text
    // metrics let us gate the pixels that will actually be painted.
    const tallestInk = Math.max(...measurements.map((measurement) => {
      const measured = measurement.actualBoundingBoxAscent + measurement.actualBoundingBoxDescent;
      return Number.isFinite(measured) && measured > 0 ? measured : fontSize;
    }));
    const paintedHeight = tallestInk + (candidate.length - 1) * fontSize * lineHeightFactor;
    if (
      widest <= maxTextWidth
      && candidate.length <= input.style.sampleLineCount
      && paintedHeight <= inner.height * 1.02
    ) {
      lines = candidate;
      break;
    }
  }
  if (lines.length === 0) return null;

  context.fillStyle = input.style.color;
  context.textBaseline = "middle";
  context.textAlign = input.style.align;
  const anchorX = input.style.align === "left"
    ? inner.left + inner.width * 0.01
    : input.style.align === "right"
      ? inner.left + inner.width * 0.99
      : inner.left + inner.width / 2;
  const lineHeight = fontSize * lineHeightFactor;
  const firstCenter = inner.top + inner.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, anchorX, firstCenter + index * lineHeight);
  });

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Load exact self-hosted faces before a live patch is permitted. */
export async function loadPatchFonts(styles: AdStudioTextLayerStyle[]): Promise<Set<string>> {
  const loaded = new Set<string>();
  const unique = new Map<string, AdStudioTextLayerStyle>();
  for (const style of styles) {
    if (style.mode !== "live" || !style.fontFile) continue;
    unique.set(`${style.fontId}:${style.weight}:${style.italic}`, style);
  }
  await Promise.all([...unique.values()].map(async (style) => {
    try {
      const face = new FontFace(
        style.fontId,
        `url("${style.fontFile}") format("woff2")`,
        { weight: String(style.weight), style: style.italic ? "italic" : "normal" },
      );
      await face.load();
      document.fonts.add(face);
      const probe = `${style.italic ? "italic " : ""}${style.weight} 16px "${style.fontId}"`;
      await document.fonts.load(probe, "Blockwise");
      if (document.fonts.check(probe, "Blockwise")) loaded.add(style.fontId);
    } catch {
      // Missing faces remain on the model path.
    }
  }));
  return loaded;
}
