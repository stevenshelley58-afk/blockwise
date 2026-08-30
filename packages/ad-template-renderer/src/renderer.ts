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

const DIMENSIONS: Record<Placement, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

export async function renderPlacement(input: RenderInput, placement: Placement): Promise<RenderOutput> {
  registerTemplateFonts(input.template, input.fontValues);
  const layout = placement === "feed" ? input.template.feedLayout : input.template.storyLayout;
  const dims = DIMENSIONS[placement];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  // Customer images are frequently scaled down from large camera originals.
  // Skia's high-quality sampler avoids the jagged, pixel-stepped result the
  // old nearest-neighbour configuration produced in final Meta assets.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (const layer of layout.layers) {
    await renderLayer(ctx, layer, input, placement, dims);
  }

  const png = canvas.toBuffer("image/png");
  return { placement, width: dims.width, height: dims.height, png };
}

export async function renderBoth(input: RenderInput): Promise<[RenderOutput, RenderOutput]> {
  return [await renderPlacement(input, "feed"), await renderPlacement(input, "story")];
}

async function renderLayer(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, placement: Placement, dims: { width: number; height: number }): Promise<void> {
  switch (layer.type) {
    case "plate": return renderPlate(ctx, layer, input, dims);
    case "image_slot": return renderImageSlot(ctx, layer, input, dims);
    case "overlay_patch": return renderOverlay(ctx, layer, input, dims);
    case "text": return renderText(ctx, layer, input, dims);
    case "logo": return renderLogo(ctx, layer, input, dims);
    case "vector": return renderVector(ctx, layer, input, dims);
    case "icon": return renderIcon(ctx, layer, input, dims);
  }
}

type CanvasDimensions = { width: number; height: number };

function resolveGeometry(geometry: Rect, dims: CanvasDimensions): Rect {
  const values = [geometry.x, geometry.y, geometry.width, geometry.height];
  if (values.every((value) => Number.isFinite(value)) && values.every((value) => Math.abs(value) <= 1.001)) {
    return { x: geometry.x * dims.width, y: geometry.y * dims.height, width: geometry.width * dims.width, height: geometry.height * dims.height };
  }
  return geometry;
}

async function renderPlate(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "plate" }>, input: RenderInput, dims: CanvasDimensions): Promise<void> {
  const geometry = resolveGeometry(layer.geometry, dims);
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
  const geometry = resolveGeometry(layer.geometry, dims);
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
  const geometry = resolveGeometry(layer.geometry, dims);
  const source = resolveCoverSourceRect(
    img.width,
    img.height,
    input.cropOverrides?.[layer.inputKey] ?? layer.defaultCrop,
    geometry.width,
    geometry.height,
  );

  ctx.save();
  if (layer.mask === "rounded_rect") {
    roundRect(ctx, geometry.x, geometry.y, geometry.width, geometry.height, 16);
    ctx.clip();
  } else if (layer.mask === "circle") {
    ctx.beginPath();
    const cx = geometry.x + geometry.width / 2;
    const cy = geometry.y + geometry.height / 2;
    ctx.arc(cx, cy, Math.min(geometry.width, geometry.height) / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(img, source.x, source.y, source.width, source.height, geometry.x, geometry.y, geometry.width, geometry.height);
  ctx.restore();
}

/**
 * Resolve a normalised customer crop/focal rectangle to a source rectangle
 * with the destination aspect ratio. The selected region is never stretched:
 * any excess is trimmed equally around its centre, exactly like object-fit
 * cover while respecting the customer's chosen focal area.
 */
export function resolveCoverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  rawCrop: Rect,
  destinationWidth: number,
  destinationHeight: number,
): Rect {
  const crop = normalizeCrop(rawCrop);
  const region = {
    x: crop.x * sourceWidth,
    y: crop.y * sourceHeight,
    width: crop.width * sourceWidth,
    height: crop.height * sourceHeight,
  };
  const destinationAspect = Math.max(Number.EPSILON, destinationWidth) / Math.max(Number.EPSILON, destinationHeight);
  const regionAspect = region.width / region.height;

  if (regionAspect > destinationAspect) {
    const width = region.height * destinationAspect;
    return { ...region, x: region.x + (region.width - width) / 2, width };
  }
  if (regionAspect < destinationAspect) {
    const height = region.width / destinationAspect;
    return { ...region, y: region.y + (region.height - height) / 2, height };
  }
  return region;
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

function renderText(ctx: SKRSContext2D, layer: TextLayer, input: RenderInput, dims: CanvasDimensions): void {
  const source = input.textValues[layer.inputKey];
  if (!source) return;
  if (layer.overflowBehaviour === "refuse" && source.length > layer.maxCharacters) return;
  const textLayer = layer as RenderTextLayer;
  const text = applyTextCase(source.slice(0, layer.maxCharacters), textLayer.case);
  const geometry = resolveGeometry(layer.geometry, dims);
  ctx.save();
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.textAlign = layer.alignment;
  ctx.textBaseline = "alphabetic";

  const registeredFamily = layer.font.file.replace(/\.[^.]+$/, "");
  // only when this process actually registered it; otherwise a family label
  // such as "Barlow" would silently select a host fallback face.
  const requestedFamily = textLayer.fontFamily?.trim();
  const family = requestedFamily && GlobalFonts.has(requestedFamily) ? requestedFamily : registeredFamily;
  const authoredRatio = Number(textLayer.sizeRatio);
  const baseFontSize = Number.isFinite(authoredRatio) && authoredRatio > 0
    ? geometry.height * authoredRatio
    : layer.fontSize;
  // A shrink floor must also be bounded by the box's line budget. The old
  // unconditional 8px floor could exceed short authored boxes and clip
  // descenders; truncation gets the same geometry guard while refusal remains
  // strict at the explicit authored size.
  const boxFloor = geometry.height / Math.max(1, layer.maxLines * layer.lineHeight);
  const minimumSize = layer.overflowBehaviour === "scale_down"
    ? Math.max(1, Math.min(baseFontSize * 0.45, boxFloor))
    : layer.overflowBehaviour === "truncate"
      ? Math.max(1, Math.min(baseFontSize, boxFloor))
      : baseFontSize;
  let fontSize = Math.max(1, baseFontSize);
  let lines: string[] = [];
  let fits = false;
  for (; fontSize >= minimumSize - 0.001; fontSize -= 0.5) {
    ctx.font = fontDeclaration(textLayer, family, fontSize);
    lines = wrapText(ctx, text, geometry.width, layer.tracking * fontSize);
    const widest = Math.max(0, ...lines.map((line) => measuredWidth(ctx, line, layer.tracking * fontSize)));
    const height = paintedHeight(ctx, lines, fontSize, layer.lineHeight);
    fits = lines.length <= layer.maxLines && widest <= geometry.width && height <= geometry.height;
    if (fits) break;
  }
  if (!fits && layer.overflowBehaviour === "refuse") {
    ctx.restore();
    return;
  }
  if (!fits) {
    fontSize = Math.max(1, minimumSize);
    ctx.font = fontDeclaration(textLayer, family, fontSize);
    lines = wrapText(ctx, text, geometry.width, layer.tracking * fontSize).slice(0, layer.maxLines);
    if (layer.overflowBehaviour === "truncate" && lines.length > 0) {
      let last = lines[lines.length - 1] ?? "";
      const suffix = "…";
      while (last && measuredWidth(ctx, `${last}${suffix}`, layer.tracking * fontSize) > geometry.width) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last.trimEnd()}${suffix}`;
    }
  }

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
    layer.tracking * fontSize,
    layer.alignment,
  ));
  ctx.restore();
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

function measuredWidth(ctx: SKRSContext2D, text: string, tracking: number): number {
  return text.length === 0 ? 0 : ctx.measureText(text).width + tracking * Math.max(0, graphemes(text).length - 1);
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

function drawTrackedText(ctx: SKRSContext2D, text: string, x: number, y: number, tracking: number, align: TextLayer["alignment"]): void {
  if (text.length === 0) return;
  if (tracking === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  const glyphs = graphemes(text);
  const total = measuredWidth(ctx, text, tracking);
  let cursor = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const glyph of glyphs) {
    ctx.fillText(glyph, cursor, y);
    cursor += ctx.measureText(glyph).width + tracking;
  }
  ctx.textAlign = previousAlign;
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, tracking = 0): string[] {
  const output: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (measuredWidth(ctx, word, tracking) > maxWidth) {
        if (line) output.push(line);
        line = "";
        for (const glyph of graphemes(word)) {
          const candidate = `${line}${glyph}`;
          if (line && measuredWidth(ctx, candidate, tracking) > maxWidth) {
            output.push(line);
            line = glyph;
          } else line = candidate;
        }
        continue;
      }
      const candidate = `${line} ${word}`;
      if (!line || measuredWidth(ctx, candidate.trim(), tracking) <= maxWidth) line = line ? candidate : word;
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
  const geometry = resolveGeometry(layer.geometry, dims);
  ctx.drawImage(img, geometry.x, geometry.y, geometry.width, geometry.height);
}

function renderVector(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "vector" }>, input: RenderInput, dims: CanvasDimensions): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  const { x, y, width, height } = resolveGeometry(layer.geometry, dims);
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
  const { x, y, width, height } = resolveGeometry(layer.geometry, dims);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.min(width, height) * 0.36;
  const px = (fraction: number) => x + width * fraction;
  const py = (fraction: number) => y + height * fraction;
  ctx.save();
  ctx.strokeStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.08);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  switch (layer.icon) {
    case "arrow":
      ctx.moveTo(px(0.1), cy);
      ctx.lineTo(px(0.9), cy);
      ctx.moveTo(px(0.55), py(0.18));
      ctx.lineTo(px(0.9), cy);
      ctx.lineTo(px(0.55), py(0.82));
      break;
    case "check":
      ctx.moveTo(px(0.18), cy);
      ctx.lineTo(px(0.42), py(0.76));
      ctx.lineTo(px(0.84), py(0.24));
      break;
    case "phone":
      ctx.moveTo(px(0.28), py(0.17));
      ctx.bezierCurveTo(px(0.18), py(0.23), px(0.18), py(0.38), px(0.3), py(0.56));
      ctx.bezierCurveTo(px(0.43), py(0.75), px(0.66), py(0.88), px(0.8), py(0.78));
      ctx.lineTo(px(0.68), py(0.61));
      ctx.bezierCurveTo(px(0.61), py(0.66), px(0.54), py(0.63), px(0.46), py(0.54));
      ctx.bezierCurveTo(px(0.38), py(0.45), px(0.35), py(0.38), px(0.4), py(0.31));
      ctx.closePath();
      break;
    case "mail":
      ctx.rect(px(0.12), py(0.22), width * 0.76, height * 0.56);
      ctx.moveTo(px(0.13), py(0.24));
      ctx.lineTo(cx, py(0.55));
      ctx.lineTo(px(0.87), py(0.24));
      break;
    case "globe":
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.moveTo(cx, cy - radius);
      ctx.bezierCurveTo(cx - radius * 0.48, cy - radius * 0.52, cx - radius * 0.48, cy + radius * 0.52, cx, cy + radius);
      ctx.moveTo(cx, cy - radius);
      ctx.bezierCurveTo(cx + radius * 0.48, cy - radius * 0.52, cx + radius * 0.48, cy + radius * 0.52, cx, cy + radius);
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      break;
    case "pin":
      ctx.moveTo(cx, py(0.9));
      ctx.bezierCurveTo(px(0.34), py(0.69), px(0.22), py(0.52), px(0.22), py(0.36));
      ctx.bezierCurveTo(px(0.22), py(0.16), px(0.35), py(0.08), cx, py(0.08));
      ctx.bezierCurveTo(px(0.65), py(0.08), px(0.78), py(0.16), px(0.78), py(0.36));
      ctx.bezierCurveTo(px(0.78), py(0.52), px(0.66), py(0.69), cx, py(0.9));
      ctx.closePath();
      ctx.moveTo(px(0.59), py(0.36));
      ctx.arc(cx, py(0.36), width * 0.09, 0, Math.PI * 2);
      break;
  }
  ctx.stroke();
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

