import { createCanvas, loadImage, type SKRSContext2D, type Canvas } from "@napi-rs/canvas";
import type {
  TemplatePack,
  Layout,
  LayoutLayer,
  ImageSlotLayer,
  TextLayer,
  Rect,
  Placement,
  ColourRole,
} from "@blockwise/ad-template-pack-contract";

// ---------------------------------------------------------------------------
// Renderer config
// ---------------------------------------------------------------------------

export interface RenderInput {
  pack: TemplatePack;
  /** Resolved image values keyed by input key — absolute file paths or buffers. */
  imageValues: Record<string, Buffer>;
  /** Resolved text values keyed by input key. */
  textValues: Record<string, string>;
  /** Colour map — template colours or Brand Pack overrides. */
  colourMap: Record<ColourRole, string>;
  /** Placement-specific image crop overrides. */
  cropOverrides?: Record<string, Rect>;
}

export interface RenderOutput {
  placement: Placement;
  width: number;
  height: number;
  /** PNG buffer — byte-identical for same inputs. */
  png: Buffer;
  /** SHA-256 of the PNG buffer. */
  sha256: string;
}

// ---------------------------------------------------------------------------
// Placement dimensions
// ---------------------------------------------------------------------------

const DIMENSIONS: Record<Placement, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a single placement. Deterministic: same inputs → byte-identical PNG.
 * No network access. No randomness.
 */
export function renderPlacement(input: RenderInput, placement: Placement): RenderOutput {
  const layout = placement === "feed" ? input.pack.feedLayout : input.pack.storyLayout;
  const dims = DIMENSIONS[placement];
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");

  // Disable image smoothing for deterministic pixel output
  ctx.imageSmoothingEnabled = false;

  // Render layers bottom-to-top
  for (const layer of layout.layers) {
    renderLayer(ctx, layer, input, placement);
  }

  const png = canvas.toBuffer("image/png");
  const sha256 = sha256Buffer(png);

  return { placement, width: dims.width, height: dims.height, png, sha256 };
}

/**
 * Render both placements. Returns [feed, story].
 */
export function renderBoth(input: RenderInput): [RenderOutput, RenderOutput] {
  return [renderPlacement(input, "feed"), renderPlacement(input, "story")];
}

// ---------------------------------------------------------------------------
// Layer rendering
// ---------------------------------------------------------------------------

function renderLayer(
  ctx: SKRSContext2D,
  layer: LayoutLayer,
  input: RenderInput,
  placement: Placement,
): void {
  switch (layer.type) {
    case "plate":
      return renderPlate(ctx, layer, input);
    case "image_slot":
      return renderImageSlot(ctx, layer, input, placement);
    case "overlay_patch":
      return renderOverlay(ctx, layer, input);
    case "text":
      return renderText(ctx, layer, input);
    case "logo":
      return renderLogo(ctx, layer, input);
  }
}

function renderPlate(
  ctx: SKRSContext2D,
  layer: Extract<LayoutLayer, { type: "plate" }>,
  input: RenderInput,
): void {
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#FFFFFF";
  ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
}

function renderOverlay(
  ctx: SKRSContext2D,
  layer: Extract<LayoutLayer, { type: "overlay_patch" }>,
  input: RenderInput,
): void {
  ctx.globalAlpha = layer.opacity;
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
  ctx.globalAlpha = 1;
}

function renderImageSlot(
  ctx: SKRSContext2D,
  layer: ImageSlotLayer,
  input: RenderInput,
  placement: Placement,
): void {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;

  const img = loadImage(imageBuf);
  const crop = input.cropOverrides?.[layer.inputKey] ?? layer.defaultCrop;

  // Source region in image pixels
  const sx = crop.x * img.width;
  const sy = crop.y * img.height;
  const sw = crop.width * img.width;
  const sh = crop.height * img.height;

  // Apply mask
  ctx.save();
  if (layer.mask === "rounded_rect") {
    const r = 16; // corner radius
    roundRect(ctx, layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height, r);
    ctx.clip();
  } else if (layer.mask === "circle") {
    ctx.beginPath();
    const cx = layer.geometry.x + layer.geometry.width / 2;
    const cy = layer.geometry.y + layer.geometry.height / 2;
    const radius = Math.min(layer.geometry.width, layer.geometry.height) / 2;
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
  }

  ctx.drawImage(
    img,
    sx, sy, sw, sh,
    layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height,
  );
  ctx.restore();
}

function renderText(
  ctx: SKRSContext2D,
  layer: TextLayer,
  input: RenderInput,
): void {
  const text = input.textValues[layer.inputKey];
  if (!text) return;

  ctx.save();
  ctx.font = `${layer.fontSize}px "${layer.font.file.replace(/\.\w+$/, "")}"`;
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.textAlign = layer.alignment;
  ctx.textBaseline = "top";

  // Measure and check overflow
  const metrics = ctx.measureText(text);
  const lineHeight = layer.fontSize * layer.lineHeight;

  if (layer.overflowBehaviour === "refuse") {
    if (text.length > layer.maxCharacters || metrics.width > layer.geometry.width) {
      ctx.restore();
      return; // Silently refuse — real implementation would report defect
    }
  }

  // Simple single-line rendering (multi-line would wrap)
  const x = layer.alignment === "center"
    ? layer.geometry.x + layer.geometry.width / 2
    : layer.alignment === "right"
      ? layer.geometry.x + layer.geometry.width
      : layer.geometry.x;

  const y = layer.geometry.y;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function renderLogo(
  ctx: SKRSContext2D,
  layer: Extract<LayoutLayer, { type: "logo" }>,
  input: RenderInput,
): void {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;

  const img = loadImage(imageBuf);
  ctx.drawImage(
    img,
    layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundRect(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
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

import { createHash } from "node:crypto";

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
