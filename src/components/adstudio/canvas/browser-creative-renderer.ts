"use client";

import type { CreativeExportRender } from "@/lib/adstudio/creative-export.ts";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCanvasObject,
  AdStudioCreative,
} from "@/lib/adstudio/types.ts";
import { getFabricImageLoadOptions } from "@/lib/adstudio/fabric-image-load.ts";

const META_EXPORT_FORMATS = new Set(["4:5", "9:16"]);
const IMAGE_LOAD_TIMEOUT_MS = 12_000;

export async function renderCreativeExports(
  pack: AdStudioCampaignPack,
  options: { storeInWorkspace?: boolean } = {},
): Promise<CreativeExportRender[]> {
  const renders: CreativeExportRender[] = [];

  for (const creative of pack.creatives) {
    if (!META_EXPORT_FORMATS.has(creative.format)) continue;
    renders.push(await renderCreative(creative, "image/png", pack.brandKit));
    renders.push(await renderCreative(creative, "image/jpeg", pack.brandKit));
  }

  if (!options.storeInWorkspace) return renders;
  return uploadCreativeRenders(pack, renders);
}

async function renderCreative(
  creative: AdStudioCreative,
  mimeType: CreativeExportRender["mimeType"],
  brandKit: AdStudioBrandKit,
): Promise<CreativeExportRender> {
  const canvas = document.createElement("canvas");
  canvas.width = creative.canvas.width;
  canvas.height = creative.canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable in this browser.");

  ctx.fillStyle = backgroundFill(creative);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const object of creative.canvas.objects) {
    if (object.type === "safe_zone") continue;
    if (object.type === "shape") drawShape(ctx, object);
    if (object.type === "text") drawText(ctx, object, brandKit);
    if (object.type === "image") await drawImageObject(ctx, object);
    if (object.type === "logo") await drawLogo(ctx, object, brandKit);
  }

  return {
    creativeId: creative.creativeId,
    variantId: creative.variantId,
    format: creative.format,
    width: creative.canvas.width,
    height: creative.canvas.height,
    mimeType,
    dataUrl: canvas.toDataURL(mimeType, mimeType === "image/jpeg" ? 0.92 : undefined),
  };
}

async function uploadCreativeRenders(
  pack: AdStudioCampaignPack,
  renders: CreativeExportRender[],
): Promise<CreativeExportRender[]> {
  const supabase = createSupabaseBrowserClient();
  const refs: CreativeExportRender[] = [];

  for (const render of renders) {
    if (!render.dataUrl) throw new Error("Creative render data is missing.");

    const extension = render.mimeType === "image/png" ? "png" : "jpg";
    const mimeLabel = render.mimeType === "image/png" ? "png" : "jpg";
    const storagePath = [
      pack.campaign.workspaceId,
      "adstudio",
      "exports",
      pack.campaign.campaignId,
      render.variantId,
      `${render.creativeId}-${safePathPart(render.format)}-${mimeLabel}.${extension}`,
    ].join("/");
    const { error } = await supabase.storage
      .from("workspace-artifacts")
      .upload(storagePath, dataUrlToBlob(render.dataUrl, render.mimeType), {
        contentType: render.mimeType,
        upsert: true,
      });

    if (error) throw new Error("Creative export failed while preparing images.");

    const { dataUrl, ...ref } = render;
    refs.push({ ...ref, storagePath });
  }

  return refs;
}

function dataUrlToBlob(dataUrl: string, mimeType: CreativeExportRender["mimeType"]): Blob {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new Error("Creative render data is invalid.");
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function safePathPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "creative";
}

function backgroundFill(creative: AdStudioCreative): string {
  return creative.canvas.objects.find((object) => object.role === "background_shape")?.fill ?? "#F1F5F9";
}

function drawShape(ctx: CanvasRenderingContext2D, object: AdStudioCanvasObject) {
  ctx.save();
  ctx.fillStyle = object.fill ?? "#123E75";
  ctx.globalAlpha = object.opacity ?? 1;
  const height = object.height ?? object.width;
  roundedRect(ctx, object.x, object.y, object.width, height, object.radius ?? 0);
  ctx.fill();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, object: AdStudioCanvasObject, brandKit: AdStudioBrandKit) {
  const fontSize = object.size ?? 48;
  ctx.save();
  ctx.fillStyle = object.fill ?? "#131B2E";
  ctx.font = `${object.weight ?? (object.role === "headline" ? 850 : 650)} ${fontSize}px ${fontFamily(object, brandKit)}`;
  ctx.textBaseline = "top";
  ctx.textAlign = object.align ?? "left";
  const textX = object.align === "center"
    ? object.x + object.width / 2
    : object.align === "right"
      ? object.x + object.width
      : object.x;
  const lineHeight = Math.round(fontSize * (object.lineHeight ?? 1.16));
  const lines = wrapText(object.content ?? "", object.width, fontSize);
  lines.forEach((line, index) => {
    ctx.fillText(line, textX, object.y + index * lineHeight);
  });
  ctx.restore();
}

async function drawImageObject(ctx: CanvasRenderingContext2D, object: AdStudioCanvasObject) {
  const width = object.width;
  const height = object.height ?? object.width;
  const src = object.content ?? object.assetId;

  if (!src) {
    drawImagePlaceholder(ctx, object.x, object.y, width, height);
    return;
  }

  try {
    const image = await loadImage(src);
    drawImageCover(ctx, image, object);
  } catch {
    drawImagePlaceholder(ctx, object.x, object.y, width, height);
  }
}

async function drawLogo(ctx: CanvasRenderingContext2D, object: AdStudioCanvasObject, brandKit: AdStudioBrandKit) {
  const width = object.width;
  const height = object.height ?? Math.round(width * 0.36);
  const src = object.assetId;

  if (src) {
    try {
      const image = await loadImage(src);
      drawImageContain(ctx, image, object.x, object.y, width, height);
      return;
    } catch {
      // Fall back to a simple locked brand mark.
    }
  }

  ctx.save();
  ctx.fillStyle = "#131B2E";
  roundedRect(ctx, object.x, object.y, width, height, 12);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 ${Math.max(18, Math.round(height * 0.42))}px ${fontFamily(object, brandKit)}`;
  ctx.textBaseline = "middle";
  ctx.fillText(brandLabel(object, brandKit), object.x + 18, object.y + height / 2);
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error("Image timed out while loading."));
    }, IMAGE_LOAD_TIMEOUT_MS);
    const options = getFabricImageLoadOptions(src);
    if (options?.crossOrigin) image.crossOrigin = options.crossOrigin;
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Image failed to load."));
    };
    image.src = src;
  });
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  object: AdStudioCanvasObject,
) {
  const { x, y, width } = object;
  const height = object.height ?? object.width;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = anchoredOffset(x, width, drawWidth, horizontalAnchor(object.imageAnchor));
  const drawY = anchoredOffset(y, height, drawHeight, verticalAnchor(object.imageAnchor));
  ctx.save();
  imageClipPath(ctx, object);
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
}

function imageClipPath(ctx: CanvasRenderingContext2D, object: AdStudioCanvasObject) {
  const height = object.height ?? object.width;
  ctx.beginPath();
  if (object.clip === "circle") {
    ctx.arc(
      object.x + object.width / 2,
      object.y + height / 2,
      Math.min(object.width, height) / 2,
      0,
      Math.PI * 2,
    );
    ctx.closePath();
    return;
  }
  if (object.clip === "arch") {
    const radius = object.width / 2;
    ctx.moveTo(object.x, object.y + height);
    ctx.lineTo(object.x, object.y + radius);
    ctx.arc(object.x + radius, object.y + radius, radius, Math.PI, 0);
    ctx.lineTo(object.x + object.width, object.y + height);
    ctx.closePath();
    return;
  }
  ctx.rect(object.x, object.y, object.width, height);
}

function anchoredOffset(start: number, frameSize: number, imageSize: number, anchor: "start" | "center" | "end") {
  if (anchor === "start") return start;
  if (anchor === "end") return start + frameSize - imageSize;
  return start + (frameSize - imageSize) / 2;
}

function horizontalAnchor(anchor: AdStudioCanvasObject["imageAnchor"]): "start" | "center" | "end" {
  if (anchor === "left" || anchor === "top_left" || anchor === "bottom_left") return "start";
  if (anchor === "right" || anchor === "top_right" || anchor === "bottom_right") return "end";
  return "center";
}

function verticalAnchor(anchor: AdStudioCanvasObject["imageAnchor"]): "start" | "center" | "end" {
  if (anchor === "top" || anchor === "top_left" || anchor === "top_right") return "start";
  if (anchor === "bottom" || anchor === "bottom_left" || anchor === "bottom_right") return "end";
  return "center";
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawImagePlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = "#D9E7E3";
  roundedRect(ctx, x, y, width, height, 22);
  ctx.fill();
  ctx.fillStyle = "#68746F";
  ctx.beginPath();
  ctx.arc(x + width / 2, y + height * 0.36, Math.min(width, height) * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + width * 0.18, y + height * 0.78);
  ctx.quadraticCurveTo(x + width * 0.5, y + height * 0.48, x + width * 0.82, y + height * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function wrapText(text: string, width: number, size: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const maxChars = Math.max(8, Math.floor(width / Math.max(1, size * 0.52)));
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fontFamily(object: AdStudioCanvasObject, brandKit: AdStudioBrandKit): string {
  if (object.fontFamily) return object.fontFamily;

  if (object.font === "brand_heading") {
    const fallback = brandKit.typography.fallbackHeading === "serif" ? "Georgia, serif" : "Inter, Arial, sans-serif";
    return brandKit.typography.headingFont ? `${brandKit.typography.headingFont}, ${fallback}` : fallback;
  }

  const fallback = brandKit.typography.fallbackBody === "serif" ? "Georgia, serif" : "Inter, Arial, sans-serif";
  return brandKit.typography.bodyFont ? `${brandKit.typography.bodyFont}, ${fallback}` : fallback;
}

function brandLabel(object: AdStudioCanvasObject, brandKit: AdStudioBrandKit): string {
  return object.content ?? brandKit.identity.tradingName ?? brandKit.identity.businessName ?? "Brand";
}
