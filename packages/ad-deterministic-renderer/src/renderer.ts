import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
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
  registerPackFonts(input.pack);
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

async function renderPlate(ctx: SKRSContext2D, layer: Extract<LayoutLayer, { type: "plate" }>, input: RenderInput): Promise<void> {
  if (layer.assetKey) {
    const bytes = input.imageValues[layer.assetKey];
    if (!bytes) throw new Error(`Missing immutable plate asset: ${layer.assetKey}`);
    const image = await loadImage(bytes);
    ctx.drawImage(image, layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
    return;
  }
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#FFFFFF";
  ctx.fillRect(layer.geometry.x, layer.geometry.y, layer.geometry.width, layer.geometry.height);
}

const registeredFontFiles = new Set<string>();

function registerPackFonts(pack: TemplatePack): void {
  for (const font of pack.fonts) {
    const fileName = basename(font.file);
    if (registeredFontFiles.has(fileName)) continue;
    const absolute = join(process.cwd(), "public", "fonts", "adstudio", fileName);
    if (!existsSync(absolute)) continue;
    GlobalFonts.registerFromPath(absolute, fileName.replace(/\.[^.]+$/, ""));
    registeredFontFiles.add(fileName);
  }
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
  const source = input.textValues[layer.inputKey];
  if (!source) return;
  if (layer.overflowBehaviour === "refuse" && source.length > layer.maxCharacters) return;
  const text = source.slice(0, layer.maxCharacters);
  ctx.save();
  ctx.fillStyle = input.colourMap[layer.colourRole] ?? "#000000";
  ctx.textAlign = layer.alignment;
  ctx.textBaseline = "top";

  const family = layer.font.file.replace(/\.[^.]+$/, "");
  const minimumSize = layer.overflowBehaviour === "scale_down" ? Math.max(8, layer.fontSize * 0.45) : layer.fontSize;
  let fontSize = layer.fontSize;
  let lines: string[] = [];
  let fits = false;
  for (; fontSize >= minimumSize; fontSize -= 1) {
    ctx.font = `${fontSize}px "${family}"`;
    lines = wrapText(ctx, text, layer.geometry.width);
    const widest = Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
    const height = lines.length * fontSize * layer.lineHeight;
    fits = lines.length <= layer.maxLines && widest <= layer.geometry.width && height <= layer.geometry.height;
    if (fits) break;
  }
  if (!fits && layer.overflowBehaviour === "refuse") {
    ctx.restore();
    return;
  }
  if (!fits) {
    fontSize = Math.max(8, fontSize);
    ctx.font = `${fontSize}px "${family}"`;
    lines = wrapText(ctx, text, layer.geometry.width).slice(0, layer.maxLines);
    if (layer.overflowBehaviour === "truncate" && lines.length > 0) {
      let last = lines[lines.length - 1] ?? "";
      while (last && ctx.measureText(`${last}…`).width > layer.geometry.width) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last.trimEnd()}…`;
    }
  }

  const x = layer.alignment === "center" ? layer.geometry.x + layer.geometry.width / 2
    : layer.alignment === "right" ? layer.geometry.x + layer.geometry.width
    : layer.geometry.x;
  lines.forEach((line, index) => ctx.fillText(line, x, layer.geometry.y + index * fontSize * layer.lineHeight));
  ctx.restore();
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const output: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      output.push("");
      continue;
    }
    let line = words[0] ?? "";
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        output.push(line);
        line = word;
      }
    }
    output.push(line);
  }
  return output;
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
