import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import type {
  TemplatePack,
  LayoutLayer,
  ImageSlotLayer,
  TextLayer,
  Rect,
  Placement,
  ColourRole,
} from "@blockwise/ad-template-pack-contract";

// ---------------------------------------------------------------------------
// Canonical deterministic renderer (Phase 3 — Agent A).
//
// Contract obligations:
//  - Exact 1080×1350 (Feed) and 1080×1920 (Story) output.
//  - Deterministic layer ordering bottom→top.
//  - Font files loaded by RECORDED HASH — a declared font whose bytes do not
//    hash to pack.fonts[].sha256 is a hard error, never a silent fallback.
//  - Image-slot masks + normalized crop transforms with hard validation.
//  - Text measurement with lineHeight + tracking; overflow behaviour is
//    enforced (refuse throws a stable RenderFitError — text is NEVER silently
//    dropped from the output).
//  - No network access. Same inputs → byte-identical PNG hashes.
// ---------------------------------------------------------------------------

export class RenderFitError extends Error {
  code: string;
  layerId: string;
  constructor(code: string, layerId: string, message: string) {
    super(`${code}@${layerId}: ${message}`);
    this.code = code;
    this.layerId = layerId;
  }
}

export interface RenderInput {
  pack: TemplatePack;
  /** Customer image buffers keyed by shared input key. */
  imageValues: Record<string, Buffer>;
  textValues: Record<string, string>;
  colourMap: Record<ColourRole, string>;
  /**
   * Per-placement crop overrides keyed by slot input key (normalized [0,1]).
   * Feed and Story keep independent crops; falls back to layer.defaultCrop.
   */
  cropOverrides?: Partial<Record<Placement, Record<string, Rect>>>;
  /** Font file bytes keyed by FontRef.file — verified against pack.fonts hashes. */
  fonts?: Record<string, Buffer>;
}

export interface RenderOutput {
  placement: Placement;
  width: number;
  height: number;
  png: Buffer;
  sha256: string;
}

const DIMENSIONS: Record<Placement, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

/** Round-trip-stable: fonts are only registered once per unique hash. */
const registeredFontHashes = new Set<string>();

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fontFamilyFor(file: string): string {
  return file.replace(/\.\w+$/, "");
}

export async function renderPlacement(input: RenderInput, placement: Placement): Promise<RenderOutput> {
  const layout = placement === "feed" ? input.pack.feedLayout : input.pack.storyLayout;
  const dims = DIMENSIONS[placement];
  registerFonts(input);

  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (const layer of layout.layers) {
    await renderLayer(ctx, layer, input, placement);
  }

  const png = canvas.toBuffer("image/png");
  return { placement, width: dims.width, height: dims.height, png, sha256: sha256Buffer(png) };
}

export async function renderBoth(input: RenderInput): Promise<[RenderOutput, RenderOutput]> {
  return [await renderPlacement(input, "feed"), await renderPlacement(input, "story")];
}

// ---------------------------------------------------------------------------
// Fonts — loaded by recorded hash, never by filename trust
// ---------------------------------------------------------------------------

function registerFonts(input: RenderInput): void {
  const declared = input.pack.fonts;
  if (declared.length === 0) return;
  const provided = input.fonts ?? {};
  for (const ref of declared) {
    const buf = provided[ref.file];
    if (!buf) {
      throw new RenderFitError("font_missing", ref.file, `pack declares font ${ref.file} but no bytes were provided`);
    }
    const actual = sha256Buffer(buf);
    if (actual !== ref.sha256) {
      throw new RenderFitError("font_hash_mismatch", ref.file, `expected ${ref.sha256}, got ${actual}`);
    }
    if (registeredFontHashes.has(actual)) continue;
    const key = GlobalFonts.register(buf, fontFamilyFor(ref.file));
    if (!key) {
      throw new RenderFitError("font_invalid", ref.file, "font bytes passed hash check but failed to register");
    }
    registeredFontHashes.add(actual);
  }
}

// ---------------------------------------------------------------------------
// Layer rendering
// ---------------------------------------------------------------------------

async function renderLayer(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, placement: Placement): Promise<void> {
  switch (layer.type) {
    case "plate":
      ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#FFFFFF";
      ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
      return;
    case "overlay_patch": {
      ctx.globalAlpha = layer.opacity;
      ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
      ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
      ctx.globalAlpha = 1;
      return;
    }
    case "image_slot":
      return renderImageSlot(ctx, layer, input, placement);
    case "text":
      return renderText(ctx, layer, input);
    case "logo": {
      const buf = input.imageValues[layer.inputKey];
      if (!buf) return;
      const img = await loadImage(buf);
      ctx.drawImage(img, layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
      return;
    }
  }
}

function validateCrop(crop: Rect, layerId: string): Rect {
  const { x, y, width, height } = crop;
  const valid =
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1.0000001 && y + height <= 1.0000001;
  if (!valid) {
    throw new RenderFitError("invalid_crop", layerId, `crop ${JSON.stringify(crop)} outside normalized [0,1] bounds`);
  }
  return { x: Math.min(x, 1), y: Math.min(y, 1), width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

async function renderImageSlot(ctx: SKRSContext2D, layer: ImageSlotLayer, input: RenderInput, placement: Placement): Promise<void> {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;
  const img = await loadImage(imageBuf);

  if (img.width < layer.minSourceWidth || img.height < layer.minSourceHeight) {
    throw new RenderFitError(
      "image_too_small",
      layer.layerId,
      `source ${img.width}×${img.height} below slot minimum ${layer.minSourceWidth}×${layer.minSourceHeight}`,
    );
  }

  const crop = validateCrop(input.cropOverrides?.[placement]?.[layer.inputKey] ?? layer.defaultCrop, layer.layerId);
  const sx = crop.x * img.width;
  const sy = crop.y * img.height;
  const sw = crop.width * img.width;
  const sh = crop.height * img.height;

  ctx.save();
  if (layer.mask === "rounded_rect") {
    roundRect(ctx, layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height, 16);
    ctx.clip();
  } else if (layer.mask === "circle") {
    ctx.beginPath();
    const cx = layer.geometry.x + layer.geometry.width / 2;
    const cy = layer.geometry.y + layer.geometry.height / 2;
    ctx.arc(cx, cy, Math.min(layer.geometry.width, layer.geometry.height) / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(img, sx, sy, sw, sh, layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Text — measurement, wrapping, overflow policy
// ---------------------------------------------------------------------------

function renderText(ctx: SKRSContext2D, layer: TextLayer, input: RenderInput): void {
  const text = input.textValues[layer.inputKey];
  if (!text) return;

  const family = fontFamilyFor(layer.font.file);
  ctx.save();
  ctx.textBaseline = "top";
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";

  if (text.length > layer.maxCharacters) {
    if (layer.overflowBehaviour === "refuse") {
      throw new RenderFitError("text_overflow", layer.layerId, `${text.length} chars exceeds maxCharacters ${layer.maxCharacters}`);
    }
  }

  let fontSize = layer.fontSize;
  let lines = measureLayout(ctx, text, layer, fontSize);

  if (lines.length > layer.maxLines) {
    switch (layer.overflowBehaviour) {
      case "refuse":
        throw new RenderFitError("text_overflow", layer.layerId, `${lines.length} lines exceeds maxLines ${layer.maxLines}`);
      case "truncate":
        lines = lines.slice(0, layer.maxLines);
        break;
      case "scale_down": {
        // Shrink in 5% steps until it fits (floor at 40% of declared size).
        let fitted = false;
        while (fontSize > layer.fontSize * 0.4) {
          fontSize = Math.floor(fontSize * 0.95);
          lines = measureLayout(ctx, text, layer, fontSize);
          if (lines.length <= layer.maxLines) {
            fitted = true;
            break;
          }
        }
        if (!fitted) {
          throw new RenderFitError("text_overflow", layer.layerId, "text does not fit even at minimum scale");
        }
        break;
      }
    }
  }

  const lineHeightPx = fontSize * layer.lineHeight;
  const trackingPx = fontSize * layer.tracking;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const y = layer.geometry.y + i * lineHeightPx;
    const lineWidth = measureTracked(ctx, line, fontSize, family, trackingPx);
    const x =
      layer.alignment === "center" ? layer.geometry.x + (layer.geometry.width - lineWidth) / 2
      : layer.alignment === "right" ? layer.geometry.x + layer.geometry.width - lineWidth
      : layer.geometry.x;
    drawTracked(ctx, line, x, y, fontSize, family, trackingPx);
  }
  ctx.restore();
}

/** Word-wrap into lines that fit the geometry width (with tracking). */
function measureLayout(ctx: SKRSContext2D, text: string, layer: TextLayer, fontSize: number): string[] {
  const family = fontFamilyFor(layer.font.file);
  const trackingPx = fontSize * layer.tracking;
  const maxWidth = layer.geometry.width;
  const lines: string[] = [];
  for (const hard of text.split("\n")) {
    const words = hard.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (measureTracked(ctx, candidate, fontSize, family, trackingPx) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i]!;
      }
    }
    lines.push(current);
  }
  return lines;
}

function setFont(ctx: SKRSContext2D, fontSize: number, family: string): void {
  ctx.font = `${fontSize}px "${family}"`;
}

function measureTracked(ctx: SKRSContext2D, text: string, fontSize: number, family: string, trackingPx: number): number {
  setFont(ctx, fontSize, family);
  const base = ctx.measureText(text).width;
  return base + trackingPx * Math.max(0, text.length - 1);
}

function drawTracked(ctx: SKRSContext2D, text: string, x: number, y: number, fontSize: number, family: string, trackingPx: number): void {
  setFont(ctx, fontSize, family);
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + trackingPx;
  }
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
