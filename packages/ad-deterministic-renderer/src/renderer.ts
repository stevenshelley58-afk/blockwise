import { createCanvas, loadImage, type SKRSContext2D, type Canvas } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import type {
  TemplatePack,
  LayoutLayer,
  ImageSlotLayer,
  TextLayer,
  Rect,
  Placement,
  ColourRole,
} from "../../ad-template-pack-contract/src/types.js";

export interface RenderInput {
  pack: TemplatePack;
  imageValues: Record<string, Buffer>;
  textValues: Record<string, string>;
  colourMap: Record<ColourRole, string>;
  cropOverrides?: Record<string, Rect>;
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

export async function renderPlacement(input: RenderInput, placement: Placement): Promise<RenderOutput> {
  const layout = placement === "feed" ? input.pack.feedLayout : input.pack.storyLayout;
  const dims = DIMENSIONS[placement];
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

async function renderLayer(ctx: SKRSContext2D, layer: LayoutLayer, input: RenderInput, placement: Placement): Promise<void> {
  switch (layer.type) {
    case "plate": return renderPlate(ctx, layer, input);
    case "image_slot": return renderImageSlot(ctx, layer, input);
    case "overlay_patch": return renderOverlay(ctx, layer, input);
    case "text": return renderText(ctx, layer, input);
    case "logo": return renderLogo(ctx, layer, input);
  }
}

function renderPlate(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "plate" }>, input: RenderInput): void {
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#FFFFFF";
  ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
}

function renderOverlay(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "overlay_patch" }>, input: RenderInput): void {
  ctx.globalAlpha = layer.opacity;
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
  ctx.globalAlpha = 1;
}

async function renderImageSlot(ctx: SKRSContext2D, layer: ImageSlotLayer, input: RenderInput): Promise<void> {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;
  const img = await loadImage(imageBuf);
  const crop = input.cropOverrides?.[layer.inputKey] ?? layer.defaultCrop;
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

function renderText(ctx: SKRSContext2D, layer: TextLayer, input: RenderInput): void {
  const text = input.textValues[layer.inputKey];
  if (!text) return;
  ctx.save();
  ctx.font = `${layer.fontSize}px "${layer.font.file.replace(/\.\w+$/, "")}"`;
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.textAlign = layer.alignment;
  ctx.textBaseline = "top";

  const metrics = ctx.measureText(text);
  if (layer.overflowBehaviour === "refuse") {
    if (text.length > layer.maxCharacters || metrics.width > layer.geometry.width) {
      ctx.restore();
      return;
    }
  }

  const x = layer.alignment === "center" ? layer.geometry.x + layer.geometry.width / 2
    : layer.alignment === "right" ? layer.geometry.x + layer.geometry.width
    : layer.geometry.x;
  ctx.fillText(text, x, layer.geometry.y);
  ctx.restore();
}

async function renderLogo(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "logo" }>, input: RenderInput): Promise<void> {
  const imageBuf = input.imageValues[layer.inputKey];
  if (!imageBuf) return;
  const img = await loadImage(imageBuf);
  ctx.drawImage(img, layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
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

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
