import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdTemplate,
  LayoutLayer,
  ImageSlotLayer,
  TextLayer,
  Rect,
  Placement,
  ColourRole,
} from "@blockwise/ad-template-contract";
import {
  MINIMUM_MULTILINE_LINE_HEIGHT,
  MINIMUM_TEXT_SIZE_PX,
  MINIMUM_VECTOR_LINE_LENGTH_PX,
} from "@blockwise/ad-template-contract";
import {
  measureTrackedTextWidth as measureSharedTrackedTextWidth,
  prepareTextLayout,
  segmentGraphemes,
} from "./text-layout.js";

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

type TextPreflightViolationBase = {
  placement: Placement;
  layerId: string;
  reason: string;
};

type TextReadabilityPreflightViolation = TextPreflightViolationBase & {
  kind: "below_readability_floor" | "cannot_fit_readability_floor";
  readabilityFloorPx: number;
};

type MultilineLineHeightPreflightViolation = TextPreflightViolationBase & {
  kind: "multiline_line_height_below_minimum";
  maxLines: number;
  lineHeight: number;
  minimumLineHeight: number;
};

export type TextPreflightViolation = TextReadabilityPreflightViolation | MultilineLineHeightPreflightViolation;

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
  ctx.save();
  applyLayerEffects(ctx, layer, input, geometry);
  if (layer.assetKey) {
    const bytes = input.imageValues[layer.assetKey];
    if (!bytes) throw new Error(`Missing immutable plate asset: ${layer.assetKey}`);
    const image = await loadImage(bytes);
    ctx.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);
    strokeLayerRect(ctx, layer, input, geometry, layer.cornerRadius ?? 0);
    ctx.restore();
    return;
  }
  ctx.fillStyle = resolveLayerFill(ctx, layer, input, geometry, input.colourMap[layer.colourRole] ?? "#FFFFFF");
  fillLayerRect(ctx, geometry, layer.cornerRadius ?? 0);
  strokeLayerRect(ctx, layer, input, geometry, layer.cornerRadius ?? 0);
  ctx.restore();
}

const registeredFontAliases = new Set<string>();

function templateFontAlias(fontFile: string): string {
  return basename(fontFile).replace(/\.[^.]+$/, "");
}

function registerTemplateFonts(template: AdTemplate, fontValues: Record<string, Buffer> = {}): void {
  for (const font of template.fonts) {
    const fileName = basename(font.file);
    const alias = templateFontAlias(font.file);
    if (registeredFontAliases.has(alias)) {
      if (!GlobalFonts.has(alias)) throw new Error("Declared template font is no longer registered: " + fileName);
      continue;
    }
    const imported = fontValues[font.file] ?? fontValues[`font:${font.file}`];
    const absolute = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "fonts", "adstudio", fileName);
    if (!imported && !existsSync(absolute)) throw new Error("Missing declared template font: " + fileName);
    const registration = imported
      ? GlobalFonts.register(imported, alias)
      : GlobalFonts.registerFromPath(absolute, alias);
    if (!registration || !GlobalFonts.has(alias)) {
      throw new Error("Failed to register declared template font: " + fileName);
    }
    registeredFontAliases.add(alias);
  }
}

async function renderOverlay(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "overlay_patch" }>, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  ctx.save();
  applyLayerEffects(ctx, layer, input, geometry);
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
  if (layer.assetKey) {
    const bytes = input.imageValues[layer.assetKey];
    if (!bytes) throw new Error(`Missing immutable overlay asset: ${layer.assetKey}`);
    const image = await loadImage(bytes);
    ctx.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);
    strokeLayerRect(ctx, layer, input, geometry, layer.cornerRadius ?? 0);
    ctx.restore();
    return;
  }
  ctx.fillStyle = resolveLayerFill(ctx, layer, input, geometry, input.colourMap[layer.colourRole] ?? "#000000");
  fillLayerRect(ctx, geometry, layer.cornerRadius ?? 0);
  strokeLayerRect(ctx, layer, input, geometry, layer.cornerRadius ?? 0);
  ctx.restore();
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
  applyLayerEffects(ctx, layer, input, geometry);
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity ?? 1));
  if (layer.mask === "rounded_rect") {
    roundRect(ctx, geometry.x, geometry.y, geometry.width, geometry.height, layer.cornerRadius ?? imageMaskRadius(geometry));
    ctx.clip();
  } else if (layer.mask === "circle") {
    ctx.beginPath();
    const cx = geometry.x + geometry.width / 2;
    const cy = geometry.y + geometry.height / 2;
    ctx.arc(cx, cy, Math.min(geometry.width, geometry.height) / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(img, sx, sy, sw, sh, geometry.x, geometry.y, geometry.width, geometry.height);
  strokeLayerRect(ctx, layer, input, geometry, layer.cornerRadius ?? (layer.mask === "rounded_rect" ? imageMaskRadius(geometry) : 0), layer.mask === "circle");
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

type RuntimeOverflowBehaviour = TextLayer["overflowBehaviour"] | "shrink";

type PreparedText = {
  kind: "paint";
  textLayer: RenderTextLayer;
  geometry: Rect;
  fontSize: number;
  lines: string[];
  trackingPixels: number;
  ascent: number;
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
  applyLayerEffects(ctx, layer, input, geometry);
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity ?? 1));
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.textAlign = layer.alignment;
  ctx.textBaseline = "alphabetic";
  ctx.font = fontDeclaration(textLayer, resolveTextFontFamily(textLayer), fontSize);

  const x = layer.alignment === "center" ? geometry.x + geometry.width / 2
    : layer.alignment === "right" ? geometry.x + geometry.width
    : geometry.x;
  const baseline = geometry.y + prepared.ascent;
  lines.forEach((line, index) => drawTrackedText(
    ctx,
    line,
    x,
    baseline + index * fontSize * layer.lineHeight,
    trackingPixels,
    layer.alignment,
  ));
  if (layer.effects?.stroke) {
    const stroke = layer.effects.stroke;
    ctx.strokeStyle = colourWithOpacity(input.colourMap[stroke.colourRole] ?? "#000000", stroke.opacity);
    ctx.lineWidth = stroke.width;
    lines.forEach((line, index) => drawTrackedText(ctx, line, x, baseline + index * fontSize * layer.lineHeight, trackingPixels, layer.alignment, true));
  }
  ctx.restore();
}

function assertTextPreflight(input: RenderInput, placements: readonly Placement[]): void {
  const ctx = createCanvas(1, 1).getContext("2d");
  const violations: TextPreflightViolation[] = [];
  for (const placement of placements) {
    const layout = placement === "feed" ? input.template.feedLayout : input.template.storyLayout;
    for (const layer of layout.layers) {
      if (layer.type !== "text") continue;
      if (layer.maxLines > 1 && layer.lineHeight < MINIMUM_MULTILINE_LINE_HEIGHT) {
        violations.push(multilineLineHeightViolation(placement, layer));
      }
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
  const overflowBehaviour = normalizeOverflowBehaviour(layer);
  if (overflowBehaviour === "refuse" && source.length > layer.maxCharacters) return { kind: "skip" };
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
  const prepared = prepareTextLayout({
    text,
    width: geometry.width,
    height: geometry.height,
    baseFontSize,
    readabilityFloor,
    maxLines: layer.maxLines,
    lineHeight: layer.lineHeight,
    trackingPixels: layer.tracking,
    overflowBehaviour,
    measure: (value, fontSize) => {
      ctx.font = fontDeclaration(textLayer, family, fontSize);
      return textMetrics(ctx, value, fontSize);
    },
  });
  if (prepared.kind === "skip") return prepared;
  if (prepared.kind === "unfit") {
    return {
      kind: "violation",
      violation: textPreflightViolation(placement, layer.layerId, "cannot_fit_readability_floor", readabilityFloor),
    };
  }
  return { ...prepared, textLayer, geometry };
}

function resolveTextFontFamily(layer: RenderTextLayer): string {
  const alias = templateFontAlias(layer.font.file);
  if (!registeredFontAliases.has(alias) || !GlobalFonts.has(alias)) {
    throw new Error("Declared template font is not registered: " + basename(layer.font.file));
  }
  return alias;
}

/**
 * Hermes' exact-clone contract historically called scale-down overflow
 * `shrink`. Treat the two spellings identically at the renderer boundary so
 * a one-line layer can never fall into the truncation fallback merely because
 * of that wire-format alias. Unknown values fail closed.
 */
function normalizeOverflowBehaviour(layer: TextLayer): TextLayer["overflowBehaviour"] {
  const behaviour = (layer as unknown as { overflowBehaviour: RuntimeOverflowBehaviour }).overflowBehaviour;
  if (behaviour === "shrink") return "scale_down";
  if (behaviour === "refuse" || behaviour === "truncate" || behaviour === "scale_down") return behaviour;
  throw new Error(`Unsupported text overflow behaviour on ${normalizeLayerId(layer.layerId)}`);
}

function textPreflightViolation(
  placement: Placement,
  layerId: string,
  kind: TextReadabilityPreflightViolation["kind"],
  readabilityFloorPx: number,
): TextReadabilityPreflightViolation {
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

function multilineLineHeightViolation(
  placement: Placement,
  layer: Pick<TextLayer, "layerId" | "lineHeight" | "maxLines">,
): MultilineLineHeightPreflightViolation {
  const safeLayerId = normalizeLayerId(layer.layerId);
  return {
    placement,
    layerId: safeLayerId,
    kind: "multiline_line_height_below_minimum",
    maxLines: layer.maxLines,
    lineHeight: layer.lineHeight,
    minimumLineHeight: MINIMUM_MULTILINE_LINE_HEIGHT,
    reason: `${placement} text layer ${safeLayerId} with maxLines ${layer.maxLines} must use lineHeight at least ${MINIMUM_MULTILINE_LINE_HEIGHT}`,
  };
}

function normalizeTextPreflightViolation(violation: TextPreflightViolation): TextPreflightViolation {
  if (violation.kind === "multiline_line_height_below_minimum") {
    return multilineLineHeightViolation(violation.placement, violation);
  }
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

/** Internal parity helper: tracking is absolute placement-canvas pixels per inter-grapheme gap. */
export function measureTrackedTextWidth(ctx: SKRSContext2D, text: string, trackingPixels: number): number {
  return measureSharedTrackedTextWidth(
    (value) => textMetrics(ctx, value, 1), text, 1, trackingPixels,
  );
}

function textMetrics(ctx: SKRSContext2D, text: string, fontSize: number): { width: number; ascent: number; descent: number; ink: number } {
  const metrics = ctx.measureText(text || "M");
  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : fontSize * 0.8;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 0.2;
  return { width: text.length === 0 ? 0 : metrics.width, ascent, descent, ink: Math.max(1, ascent + descent) };
}

function drawTrackedText(ctx: SKRSContext2D, text: string, x: number, y: number, trackingPixels: number, align: TextLayer["alignment"], stroke = false): void {
  if (text.length === 0) return;
  if (trackingPixels === 0) {
    if (stroke) ctx.strokeText(text, x, y);
    else ctx.fillText(text, x, y);
    return;
  }
  const glyphs = segmentGraphemes(text);
  const total = measureTrackedTextWidth(ctx, text, trackingPixels);
  let cursor = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const glyph of glyphs) {
    if (stroke) ctx.strokeText(glyph, cursor, y);
    else ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + trackingPixels;
  }
  ctx.textAlign = previousAlign;
}

async function renderLogo(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "logo" }>, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;
  const img = await loadImage(imageBuf);
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  ctx.save();
  applyLayerEffects(ctx, layer, input, geometry);
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity ?? 1));
  if ((layer.cornerRadius ?? 0) > 0) { roundRect(ctx, geometry.x, geometry.y, geometry.width, geometry.height, layer.cornerRadius!); ctx.clip(); }
  ctx.drawImage(img, geometry.x, geometry.y, geometry.width, geometry.height);
  strokeLayerRect(ctx, layer, input, geometry, layer.cornerRadius ?? 0);
  ctx.restore();
}

function applyLayerEffects(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, geometry: Rect): void {
  const effects = layer.effects;
  if (!effects) return;
  if (effects.blendMode) ctx.globalCompositeOperation = effects.blendMode;
  if (effects.rotationDegrees) {
    const cx = geometry.x + geometry.width / 2;
    const cy = geometry.y + geometry.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(effects.rotationDegrees * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }
  if (effects.shadow) {
    const shadow = effects.shadow;
    ctx.shadowColor = colourWithOpacity(input.colourMap[shadow.colourRole] ?? "#000000", shadow.opacity);
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.offsetX;
    ctx.shadowOffsetY = shadow.offsetY;
  }
}

function resolveLayerFill(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, geometry: Rect, fallback: string): string | CanvasGradient {
  if (!("fill" in layer) || !layer.fill) return fallback;
  const radians = layer.fill.angleDegrees * Math.PI / 180;
  const cx = geometry.x + geometry.width / 2;
  const cy = geometry.y + geometry.height / 2;
  const length = Math.abs(geometry.width * Math.cos(radians)) + Math.abs(geometry.height * Math.sin(radians));
  const dx = Math.cos(radians) * length / 2;
  const dy = Math.sin(radians) * length / 2;
  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (const stop of layer.fill.stops) gradient.addColorStop(stop.offset, colourWithOpacity(input.colourMap[stop.colourRole] ?? fallback, stop.opacity));
  return gradient;
}

function colourWithOpacity(colour: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!match) return colour;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.min(1, Math.max(0, opacity))})`;
}

function fillLayerRect(ctx: SKRSContext2D, geometry: Rect, radius: number): void {
  if (radius > 0) { roundRect(ctx, geometry.x, geometry.y, geometry.width, geometry.height, Math.min(radius, geometry.width / 2, geometry.height / 2)); ctx.fill(); }
  else ctx.fillRect(geometry.x, geometry.y, geometry.width, geometry.height);
}

function strokeLayerRect(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, geometry: Rect, radius: number, circle = false): void {
  const stroke = layer.effects?.stroke;
  if (!stroke) return;
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = colourWithOpacity(input.colourMap[stroke.colourRole] ?? "#000000", stroke.opacity);
  ctx.lineWidth = stroke.width;
  if (circle) {
    ctx.beginPath();
    ctx.arc(geometry.x + geometry.width / 2, geometry.y + geometry.height / 2, Math.min(geometry.width, geometry.height) / 2, 0, Math.PI * 2);
  } else roundRect(ctx, geometry.x, geometry.y, geometry.width, geometry.height, Math.min(radius, geometry.width / 2, geometry.height / 2));
  ctx.stroke();
  ctx.restore();
}

function renderVector(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "vector" }>, input: RenderInput, dims: CanvasDimensions): void {
  ctx.save();
  const geometry = resolveRenderGeometry(layer.geometry, dims);
  applyLayerEffects(ctx, layer, input, geometry);
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
  ctx.fillStyle = resolveLayerFill(ctx, layer, input, geometry, input.colourMap[layer.colourRole] ?? "#000000");
  const { x, y, width, height } = geometry;
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
      const authoredStroke = layer.effects?.stroke;
      ctx.strokeStyle = authoredStroke ? colourWithOpacity(input.colourMap[authoredStroke.colourRole] ?? "#000000", authoredStroke.opacity) : ctx.fillStyle;
      ctx.lineWidth = authoredStroke?.width ?? Math.max(2, Math.min(width, height) * .08);
      ctx.stroke();
    } else {
      ctx.fill();
      if (layer.effects?.stroke) {
        ctx.strokeStyle = colourWithOpacity(input.colourMap[layer.effects.stroke.colourRole] ?? "#000000", layer.effects.stroke.opacity);
        ctx.lineWidth = layer.effects.stroke.width;
        ctx.stroke();
      }
    }
  } else if (layer.shape === "line" || layer.shape === "wave") {
    const authoredStroke = layer.effects?.stroke;
    ctx.strokeStyle = authoredStroke ? colourWithOpacity(input.colourMap[authoredStroke.colourRole] ?? "#000000", authoredStroke.opacity) : ctx.fillStyle;
    ctx.lineWidth = authoredStroke?.width ?? 2;
    ctx.beginPath();
    if (layer.shape === "wave") {
      ctx.moveTo(x, y + height / 2);
      ctx.bezierCurveTo(x + width * .25, y - height / 2, x + width * .75, y + height * 1.5, x + width, y + height / 2);
    } else {
      const lineLength = Math.max(width, height);
      if (lineLength < MINIMUM_VECTOR_LINE_LENGTH_PX) {
        ctx.restore();
        throw new Error(`${layer.layerId} line vector must be at least ${MINIMUM_VECTOR_LINE_LENGTH_PX}px long`);
      }
      if (height > width) {
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x + width / 2, y + height);
      } else {
        ctx.moveTo(x, y + height / 2);
        ctx.lineTo(x + width, y + height / 2);
      }
    }
    ctx.stroke();
  } else if (layer.shape === "notched") {
    const notch = Math.min(width, height) * .2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width - notch, y); ctx.lineTo(x + width, y + notch); ctx.lineTo(x + width, y + height); ctx.lineTo(x + notch, y + height); ctx.lineTo(x, y + height - notch); ctx.closePath(); ctx.fill();
    if (layer.effects?.stroke) { ctx.strokeStyle = colourWithOpacity(input.colourMap[layer.effects.stroke.colourRole] ?? "#000000", layer.effects.stroke.opacity); ctx.lineWidth = layer.effects.stroke.width; ctx.stroke(); }
  } else {
    const radius = layer.shape === "pill" ? Math.min(width, height) / 2 : layer.cornerRadius ?? (layer.shape === "rounded" ? Math.min(16, width / 4, height / 4) : 0);
    roundRect(ctx, x, y, width, height, radius);
    ctx.fill();
    strokeLayerRect(ctx, layer, input, geometry, radius);
  }
  ctx.restore();
}

function renderIcon(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "icon" }>, input: RenderInput, dims: CanvasDimensions): void {
  const { x, y, width, height } = resolveRenderGeometry(layer.geometry, dims);
  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.save();
  applyLayerEffects(ctx, layer, input, { x, y, width, height });
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity ?? 1));
  const authoredStroke = layer.effects?.stroke;
  ctx.strokeStyle = authoredStroke ? colourWithOpacity(input.colourMap[authoredStroke.colourRole] ?? "#000000", authoredStroke.opacity) : input.colourMap[layer.colourRole] ?? "#000000";
  ctx.lineWidth = authoredStroke?.width ?? Math.max(2, Math.min(width, height) * 0.1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (layer.icon === "arrow") {
    ctx.moveTo(x + width * .1, cy); ctx.lineTo(x + width * .9, cy);
    ctx.moveTo(x + width * .55, y + height * .18); ctx.lineTo(x + width * .9, cy); ctx.lineTo(x + width * .55, y + height * .82); ctx.stroke();
  } else if (layer.icon === "check" || layer.icon === "tick") {
    ctx.moveTo(x + width * 0.18, cy); ctx.lineTo(x + width * 0.42, y + height * 0.76); ctx.lineTo(x + width * 0.84, y + height * 0.24); ctx.stroke();
  } else if (layer.icon === "phone") {
    ctx.moveTo(x + width * .22, y + height * .16);
    ctx.bezierCurveTo(x + width * .12, y + height * .24, x + width * .2, y + height * .52, x + width * .43, y + height * .73);
    ctx.bezierCurveTo(x + width * .64, y + height * .92, x + width * .82, y + height * .89, x + width * .88, y + height * .76);
    ctx.lineTo(x + width * .68, y + height * .6);
    ctx.lineTo(x + width * .54, y + height * .7);
    ctx.bezierCurveTo(x + width * .43, y + height * .64, x + width * .34, y + height * .54, x + width * .29, y + height * .42);
    ctx.lineTo(x + width * .39, y + height * .3);
    ctx.closePath();
    ctx.stroke();
  } else if (layer.icon === "mail") {
    ctx.rect(x + width * .1, y + height * .22, width * .8, height * .58);
    ctx.moveTo(x + width * .1, y + height * .24);
    ctx.lineTo(cx, y + height * .56);
    ctx.lineTo(x + width * .9, y + height * .24);
    ctx.stroke();
  } else if (layer.icon === "globe") {
    const radius = Math.min(width, height) * .36;
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.moveTo(cx, cy - radius);
    ctx.bezierCurveTo(cx - radius * .45, cy - radius * .55, cx - radius * .45, cy + radius * .55, cx, cy + radius);
    ctx.moveTo(cx, cy - radius);
    ctx.bezierCurveTo(cx + radius * .45, cy - radius * .55, cx + radius * .45, cy + radius * .55, cx, cy + radius);
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.stroke();
  } else if (layer.icon === "location") {
    ctx.moveTo(cx, y + height * .9);
    ctx.bezierCurveTo(x + width * .28, y + height * .68, x + width * .2, y + height * .5, x + width * .2, y + height * .36);
    ctx.bezierCurveTo(x + width * .2, y + height * .14, x + width * .34, y + height * .08, cx, y + height * .08);
    ctx.bezierCurveTo(x + width * .66, y + height * .08, x + width * .8, y + height * .14, x + width * .8, y + height * .36);
    ctx.bezierCurveTo(x + width * .8, y + height * .5, x + width * .72, y + height * .68, cx, y + height * .9);
    ctx.closePath();
    ctx.moveTo(cx + width * .09, y + height * .35);
    ctx.arc(cx, y + height * .35, width * .09, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.restore();
    throw new Error(`unsupported icon ${normalizeLayerId(layer.layerId)}`);
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

