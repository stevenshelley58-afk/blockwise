import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type {
  AdTemplate,
  LayoutLayer,
  ImageSlotLayer,
  TextLayer,
  Rect,
  Placement,
  ColourRole,
} from "@blockwise/ad-template-contract";
import { MINIMUM_TEXT_SIZE_PX } from "@blockwise/ad-template-contract";

export interface RenderInput {
  template: AdTemplate;
  imageValues: Record<string, Buffer>;
  textValues: Record<string, string>;
  colourMap: Record<ColourRole, string>;
  cropOverrides?: Record<string, Rect>;
  /** Imported font bytes for server-side canary renders; avoids host-font drift. */
  fontValues?: Record<string, Buffer>;
}

export interface RenderOutput {
  placement: Placement;
  width: number;
  height: number;
  png: Buffer;
}

export const TEXT_PREFLIGHT_ERROR_CODE = "AD_TEMPLATE_TEXT_PREFLIGHT_FAILED";

export type TextPreflightViolation = {
  placement: Placement;
  layerId: string;
  kind: "below_readability_floor" | "cannot_fit_readability_floor";
  readabilityFloorPx: number;
  reason: string;
};

/**
 * One deterministic, machine-readable refusal for every text-fit problem in a
 * template. Valid templates contain at most 512 layout layers, and layer IDs
 * are normalized to 160 printable identifier characters, keeping stderr
 * bounded and free of filesystem or stack-trace data.
 */
export class TextPreflightError extends Error {
  readonly code = TEXT_PREFLIGHT_ERROR_CODE;
  readonly violations: readonly TextPreflightViolation[];

  constructor(violations: readonly TextPreflightViolation[]) {
    const normalized = violations.slice(0, 512).map(normalizeTextPreflightViolation);
    const payload = { code: TEXT_PREFLIGHT_ERROR_CODE, violations: normalized };
    super(`${TEXT_PREFLIGHT_ERROR_CODE} ${JSON.stringify(payload)}`);
    this.name = "TextPreflightError";
    this.violations = normalized;
  }
}

const DIMENSIONS: Record<Placement, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

export async function renderPlacement(input: RenderInput, placement: Placement): Promise<RenderOutput> {
  registerTemplateFonts(input.template, input.fontValues);
  const layout = placement === "feed" ? input.template.feedLayout : input.template.storyLayout;
  const dims = DIMENSIONS[placement];
  assertFullCanvasBackground(layout.layers, dims, placement);
  assertTextPreflight(input, [placement]);
  return renderPlacementPrepared(input, placement);
}

async function renderPlacementPrepared(input: RenderInput, placement: Placement): Promise<RenderOutput> {
  const layout = placement === "feed" ? input.template.feedLayout : input.template.storyLayout;
  const dims = DIMENSIONS[placement];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (const layer of layout.layers) {
    await renderLayer(ctx, layer, input, placement, dims);
  }

  assertFullyOpaque(ctx, dims, placement);
  const png = canvas.toBuffer("image/png");
  return { placement, width: dims.width, height: dims.height, png };
}

export async function renderBoth(input: RenderInput): Promise<[RenderOutput, RenderOutput]> {
  registerTemplateFonts(input.template, input.fontValues);
  assertFullCanvasBackground(input.template.feedLayout.layers, DIMENSIONS.feed, "feed");
  assertFullCanvasBackground(input.template.storyLayout.layers, DIMENSIONS.story, "story");
  assertTextPreflight(input, ["feed", "story"]);
  return [await renderPlacementPrepared(input, "feed"), await renderPlacementPrepared(input, "story")];
}

async function renderLayer(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, placement: Placement, dims: { width: number; height: number }): Promise<void> {
  switch (layer.type) {
    case "plate": return renderPlate(ctx, layer, input, dims);
    case "image_slot": return renderImageSlot(ctx, layer, input, dims);
    case "overlay_patch": return renderOverlay(ctx, layer, input, dims);
    case "text": return renderText(ctx, layer, input, placement, dims);
    case "logo": return renderLogo(ctx, layer, input, dims);
    case "vector": return renderVector(ctx, layer, input, dims);
    case "icon": return renderIcon(ctx, layer, input, dims);
  }
}

type CanvasDimensions = { width: number; height: number };

function assertFullCanvasBackground(
  layers: LayoutLayer[],
  dims: CanvasDimensions,
  placement: Placement,
): void {
  const background = layers[0];
  if (background?.type !== "plate" || !background.protected) {
    throw new Error(`${placement} first layer must be a protected full-canvas background plate`);
  }
  const geometry = resolveRenderGeometry(background.geometry, dims);
  if (
    Math.abs(geometry.x) > 0.5
    || Math.abs(geometry.y) > 0.5
    || Math.abs(geometry.width - dims.width) > 0.5
    || Math.abs(geometry.height - dims.height) > 0.5
  ) {
    throw new Error(`${placement} first layer must be a protected full-canvas background plate`);
  }
}

function assertFullyOpaque(ctx: SKRSContext2D, dims: CanvasDimensions, placement: Placement): void {
  const pixels = ctx.getImageData(0, 0, dims.width, dims.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) {
      const pixel = (index - 3) / 4;
      const x = pixel % dims.width;
      const y = Math.floor(pixel / dims.width);
      throw new Error(`${placement} render is not fully opaque at (${x}, ${y})`);
    }
  }
}

/** Internal parity fixture helper; the package index intentionally exposes only render APIs. */
export function resolveRenderGeometry(geometry: Rect, dims: CanvasDimensions): Rect {
  const values = [geometry.x, geometry.y, geometry.width, geometry.height];
  if (values.every((value) => Number.isFinite(value)) && values.every((value) => Math.abs(value) <= 1.001)) {
    return { x: geometry.x * dims.width, y: geometry.y * dims.height, width: geometry.width * dims.width, height: geometry.height * dims.height };
  }
  return geometry;
}

async function renderPlate(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "plate" }>, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  if (layer.assetKey) {
    const bytes = input.imageValues[layer.assetKey];
    if (!bytes) throw new Error(`Missing immutable plate asset: ${layer.assetKey}`);
    const image = await loadImage(bytes);
    ctx.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);
    return;
  }
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#FFFFFF";
  ctx.fillRect(geometry.x, geometry.y, geometry.width, geometry.height);
}

const registeredFontFiles = new Set<string>();

function registerTemplateFonts(template: AdTemplate, fontValues: Record<string, Buffer> = {}): void {
  for (const font of template.fonts) {
    const fileName = basename(font.file);
    const registrationKey = fileName;
    if (registeredFontFiles.has(registrationKey)) continue;
    const imported = fontValues[font.file] ?? fontValues[`font:${font.file}`];
    const importedPath = imported ? join(tmpdir(), fileName) : null;
    if (imported && importedPath && !existsSync(importedPath)) writeFileSync(importedPath, imported);
    const absolute = importedPath ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "fonts", "adstudio", fileName);
    if (!existsSync(absolute)) throw new Error("Missing declared template font: " + fileName);
    GlobalFonts.registerFromPath(absolute, fileName.replace(/\.[^.]+$/, ""));
    registeredFontFiles.add(registrationKey);
  }
}

async function renderOverlay(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "overlay_patch" }>, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  if (layer.assetKey) {
    const bytes = input.imageValues[layer.assetKey];
    if (!bytes) throw new Error(`Missing immutable overlay asset: ${layer.assetKey}`);
    const image = await loadImage(bytes);
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
    ctx.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);
    ctx.restore();
    return;
  }
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.fillRect(geometry.x, geometry.y, geometry.width, geometry.height);
  ctx.globalAlpha = 1;
}

async function renderImageSlot(ctx: SKRSContext2D, layer: ImageSlotLayer, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;
  const img = await loadImage(imageBuf);
  const crop = normalizeCrop(input.cropOverrides?.[layer.inputKey] ?? layer.defaultCrop);
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  const sx = crop.x * img.width;
  const sy = crop.y * img.height;
  const sw = crop.width * img.width;
  const sh = crop.height * img.height;

  ctx.save();
  if (layer.mask === "rounded_rect") {
    roundRect(ctx, geometry.x, geometry.y, geometry.width, geometry.height, imageMaskRadius(geometry));
    ctx.clip();
  } else if (layer.mask === "circle") {
    ctx.beginPath();
    const cx = geometry.x + geometry.width / 2;
    const cy = geometry.y + geometry.height / 2;
    ctx.arc(cx, cy, Math.min(geometry.width, geometry.height) / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(img, sx, sy, sw, sh, geometry.x, geometry.y, geometry.width, geometry.height);
  ctx.restore();
}

/** Internal parity fixture helper; not part of the package index API. */
export function imageMaskRadius(geometry: Pick<Rect, "width" | "height">): number {
  return Math.min(16, geometry.width / 2, geometry.height / 2);
}

function normalizeCrop(crop: Rect): Rect {
  // Keep the source rectangle non-empty even for malformed overrides at the
  // lower/right edge. drawImage rejects a zero-sized source rectangle.
  const x = Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(crop.x) ? crop.x : 0));
  const y = Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(crop.y) ? crop.y : 0));
  const width = Math.min(1 - x, Math.max(Number.EPSILON, Number.isFinite(crop.width) ? crop.width : 1));
  const height = Math.min(1 - y, Math.max(Number.EPSILON, Number.isFinite(crop.height) ? crop.height : 1));
  return { x, y, width, height };
}

type RenderTextLayer = TextLayer & {
  sizeRatio?: number;
  fontFamily?: string;
  fontWeight?: number | string;
  italic?: boolean;
  case?: "upper" | "lower" | "none";
};

type PreparedText = {
  kind: "paint";
  textLayer: RenderTextLayer;
  geometry: Rect;
  fontSize: number;
  lines: string[];
  trackingPixels: number;
};

type TextPreparation = PreparedText | { kind: "skip" } | { kind: "violation"; violation: TextPreflightViolation };

/**
 * Resolve the authored text size after geometry normalization. The optional
 * ratio is the pack's scale-independent type treatment and is intentionally
 * shared as a formula with the Fabric editor's geometry helper.
 */
/** Internal parity fixture helper; the package index intentionally exposes only render APIs. */
export function effectiveTextFontSize(layer: Pick<TextLayer, "fontSize"> & { sizeRatio?: number }, geometry: Rect): number {
  const ratio = Number(layer.sizeRatio);
  return Number.isFinite(ratio) && ratio > 0 ? geometry.height * ratio : layer.fontSize;
}

function renderText(ctx: SKRSContext2D, layer: TextLayer, input: RenderInput, placement: Placement, dims: CanvasDimensions): void {
  const prepared = prepareText(ctx, layer, input, placement, dims);
  if (prepared.kind === "skip") return;
  if (prepared.kind === "violation") throw new TextPreflightError([prepared.violation]);

  const { textLayer, geometry, fontSize, lines, trackingPixels } = prepared;
  ctx.save();
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.textAlign = layer.alignment;
  ctx.textBaseline = "alphabetic";
  ctx.font = fontDeclaration(textLayer, resolveTextFontFamily(textLayer), fontSize);

  const x = layer.alignment === "center" ? geometry.x + geometry.width / 2
    : layer.alignment === "right" ? geometry.x + geometry.width
    : geometry.x;
  // Fabric's textbox reserves the line box from the largest ascent/descent
  // in the text. Using the first line's ascent alone clips serif descenders
  // when a later line has different font metrics.
  const lineMetrics = lines.map((line) => textMetrics(ctx, line, fontSize));
  const maxAscent = Math.max(0, ...lineMetrics.map((metrics) => metrics.ascent));
  const baseline = geometry.y + maxAscent;
  lines.forEach((line, index) => drawTrackedText(
    ctx,
    line,
    x,
    baseline + index * fontSize * layer.lineHeight,
    trackingPixels,
    layer.alignment,
  ));
  ctx.restore();
}

function assertTextPreflight(input: RenderInput, placements: readonly Placement[]): void {
  const ctx = createCanvas(1, 1).getContext("2d");
  const violations: TextPreflightViolation[] = [];
  for (const placement of placements) {
    const layout = placement === "feed" ? input.template.feedLayout : input.template.storyLayout;
    for (const layer of layout.layers) {
      if (layer.type !== "text") continue;
      const prepared = prepareText(ctx, layer, input, placement, DIMENSIONS[placement]);
      if (prepared.kind === "violation") violations.push(prepared.violation);
    }
  }
  if (violations.length > 0) throw new TextPreflightError(violations);
}

function prepareText(
  ctx: SKRSContext2D,
  layer: TextLayer,
  input: RenderInput,
  placement: Placement,
  dims: CanvasDimensions,
): TextPreparation {
  const source = input.textValues[layer.inputKey];
  if (!source) return { kind: "skip" };
  if (layer.overflowBehaviour === "refuse" && source.length > layer.maxCharacters) return { kind: "skip" };
  const textLayer = layer as RenderTextLayer;
  const text = applyTextCase(source.slice(0, layer.maxCharacters), textLayer.case);
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  const family = resolveTextFontFamily(textLayer);
  const baseFontSize = effectiveTextFontSize(textLayer, geometry);
  const readabilityFloor = MINIMUM_TEXT_SIZE_PX[placement];
  if (baseFontSize < readabilityFloor) {
    return {
      kind: "violation",
      violation: textPreflightViolation(placement, layer.layerId, "below_readability_floor", readabilityFloor),
    };
  }
  // A shrink floor must also be bounded by the box's line budget. The old
  // unconditional 8px floor could exceed short authored boxes and clip
  // descenders; truncation gets the same geometry guard while refusal remains
  // strict at the explicit authored size.
  const boxFloor = geometry.height / Math.max(1, layer.maxLines * layer.lineHeight);
  const minimumSize = layer.overflowBehaviour === "scale_down"
    ? readabilityFloor
    : layer.overflowBehaviour === "truncate"
      ? Math.max(readabilityFloor, Math.min(baseFontSize, boxFloor))
      : baseFontSize;
  let fontSize = Math.max(1, baseFontSize);
  let lines: string[] = [];
  let fits = false;
  const trackingPixels = layer.tracking;
  for (; fontSize >= minimumSize - 0.001; fontSize -= 0.5) {
    ctx.font = fontDeclaration(textLayer, family, fontSize);
    lines = wrapText(ctx, text, geometry.width, trackingPixels);
    const widest = Math.max(0, ...lines.map((line) => measureTrackedTextWidth(ctx, line, trackingPixels)));
    const height = paintedHeight(ctx, lines, fontSize, layer.lineHeight);
    fits = lines.length <= layer.maxLines && widest <= geometry.width && height <= geometry.height;
    if (fits) break;
  }
  if (!fits && layer.overflowBehaviour === "refuse") {
    return { kind: "skip" };
  }
  if (!fits && layer.overflowBehaviour === "scale_down") {
    return {
      kind: "violation",
      violation: textPreflightViolation(placement, layer.layerId, "cannot_fit_readability_floor", readabilityFloor),
    };
  }
  if (!fits) {
    fontSize = Math.max(1, minimumSize);
    ctx.font = fontDeclaration(textLayer, family, fontSize);
    lines = wrapText(ctx, text, geometry.width, trackingPixels).slice(0, layer.maxLines);
    if (layer.overflowBehaviour === "truncate" && lines.length > 0) {
      let last = lines[lines.length - 1] ?? "";
      const suffix = "…";
      while (last && measureTrackedTextWidth(ctx, `${last}${suffix}`, trackingPixels) > geometry.width) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last.trimEnd()}${suffix}`;
    }
  }
  return { kind: "paint", textLayer, geometry, fontSize, lines, trackingPixels };
}

function resolveTextFontFamily(layer: RenderTextLayer): string {
  const registeredFamily = layer.font.file.replace(/\.[^.]+$/, "");
  // only when this process actually registered it; otherwise a family label
  // such as "Barlow" would silently select a host fallback face.
  const requestedFamily = layer.fontFamily?.trim();
  return requestedFamily && GlobalFonts.has(requestedFamily) ? requestedFamily : registeredFamily;
}

function textPreflightViolation(
  placement: Placement,
  layerId: string,
  kind: TextPreflightViolation["kind"],
  readabilityFloorPx: number,
): TextPreflightViolation {
  const safeLayerId = normalizeLayerId(layerId);
  const qualifier = kind === "below_readability_floor" ? "is below" : "cannot fit at";
  return {
    placement,
    layerId: safeLayerId,
    kind,
    readabilityFloorPx,
    reason: `${placement} text layer ${safeLayerId} ${qualifier} the ${readabilityFloorPx}px readability floor`,
  };
}

function normalizeTextPreflightViolation(violation: TextPreflightViolation): TextPreflightViolation {
  return textPreflightViolation(
    violation.placement,
    violation.layerId,
    violation.kind,
    violation.readabilityFloorPx,
  );
}

function normalizeLayerId(layerId: string): string {
  return layerId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160) || "unnamed-layer";
}

function applyTextCase(text: string, mode: RenderTextLayer["case"]): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  return text;
}

function fontDeclaration(layer: RenderTextLayer, family: string, size: number): string {
  const style = layer.italic ? "italic " : "";
  const weight = layer.fontWeight ? `${layer.fontWeight} ` : "";
  return `${style}${weight}${size}px "${family}"`;
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

/** Internal parity helper: tracking is absolute placement-canvas pixels per inter-grapheme gap. */
export function measureTrackedTextWidth(ctx: SKRSContext2D, text: string, trackingPixels: number): number {
  return text.length === 0 ? 0 : ctx.measureText(text).width + trackingPixels * Math.max(0, graphemes(text).length - 1);
}

function textMetrics(ctx: SKRSContext2D, text: string, fontSize: number): { ascent: number; descent: number; ink: number } {
  const metrics = ctx.measureText(text || "M");
  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : fontSize * 0.8;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 0.2;
  return { ascent, descent, ink: Math.max(1, ascent + descent) };
}

function paintedHeight(ctx: SKRSContext2D, lines: string[], fontSize: number, lineHeight: number): number {
  if (lines.length === 0) return 0;
  const metrics = lines.map((line) => textMetrics(ctx, line, fontSize));
  const ascent = Math.max(...metrics.map((line) => line.ascent));
  const descent = Math.max(...metrics.map((line) => line.descent));
  return ascent + descent + Math.max(0, lines.length - 1) * fontSize * lineHeight;
}

function drawTrackedText(ctx: SKRSContext2D, text: string, x: number, y: number, trackingPixels: number, align: TextLayer["alignment"]): void {
  if (text.length === 0) return;
  if (trackingPixels === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  const glyphs = graphemes(text);
  const total = measureTrackedTextWidth(ctx, text, trackingPixels);
  let cursor = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const glyph of glyphs) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + trackingPixels;
  }
  ctx.textAlign = previousAlign;
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, trackingPixels = 0): string[] {
  const output: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (measureTrackedTextWidth(ctx, word, trackingPixels) > maxWidth) {
        if (line) output.push(line);
        line = "";
        for (const glyph of graphemes(word)) {
          const candidate = `${line}${glyph}`;
          if (line && measureTrackedTextWidth(ctx, candidate, trackingPixels) > maxWidth) {
            output.push(line);
            line = glyph;
          } else line = candidate;
        }
        continue;
      }
      const candidate = `${line} ${word}`;
      if (!line || measureTrackedTextWidth(ctx, candidate.trim(), trackingPixels) <= maxWidth) line = line ? candidate : word;
      else {
        output.push(line);
        line = word;
      }
    }
    output.push(line);
  }
  return output;
}

async function renderLogo(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "logo" }>, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;
  const img = await loadImage(imageBuf);
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  ctx.drawImage(img, geometry.x, geometry.y, geometry.width, geometry.height);
}

function renderVector(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "vector" }>, input: RenderInput, dims: CanvasDimensions): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  const { x, y, width, height } = resolveRenderGeometry(layer.geometry, dims);
  if (layer.shape === "ring") {
    const squareTolerance = Math.max(1, Math.min(width, height) * 0.01);
    if (Math.abs(width - height) > squareTolerance) {
      ctx.restore();
      throw new Error(`ring vector ${layer.layerId} must use square geometry`);
    }
  }
  if (layer.shape === "circle" || layer.shape === "ring") {
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
    if (layer.shape === "ring") {
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(2, Math.min(width, height) * .08);
      ctx.stroke();
    } else ctx.fill();
  } else if (layer.shape === "line" || layer.shape === "wave") {
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + height / 2);
    if (layer.shape === "wave") {
      ctx.bezierCurveTo(x + width * .25, y - height / 2, x + width * .75, y + height * 1.5, x + width, y + height / 2);
    } else ctx.lineTo(x + width, y + height / 2);
    ctx.stroke();
  } else if (layer.shape === "notched") {
    const notch = Math.min(width, height) * .2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width - notch, y); ctx.lineTo(x + width, y + notch); ctx.lineTo(x + width, y + height); ctx.lineTo(x + notch, y + height); ctx.lineTo(x, y + height - notch); ctx.closePath(); ctx.fill();
  } else {
    roundRect(ctx, x, y, width, height, layer.shape === "pill" ? Math.min(width, height) / 2 : layer.shape === "rounded" ? Math.min(16, width / 4, height / 4) : 0);
    ctx.fill();
  }
  ctx.restore();
}

function renderIcon(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "icon" }>, input: RenderInput, dims: CanvasDimensions): void {
  const { x, y, width, height } = resolveRenderGeometry(layer.geometry, dims);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.min(width, height) * 0.34;
  ctx.save();
  ctx.strokeStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.1);
  ctx.beginPath();
  if (layer.icon === "arrow") {
    ctx.moveTo(x + width * .1, cy); ctx.lineTo(x + width * .9, cy);
    ctx.moveTo(x + width * .55, y + height * .18); ctx.lineTo(x + width * .9, cy); ctx.lineTo(x + width * .55, y + height * .82); ctx.stroke();
  } else if (layer.icon === "check" || layer.icon === "tick") {
    ctx.moveTo(x + width * 0.18, cy); ctx.lineTo(x + width * 0.42, y + height * 0.76); ctx.lineTo(x + width * 0.84, y + height * 0.24); ctx.stroke();
  } else {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

