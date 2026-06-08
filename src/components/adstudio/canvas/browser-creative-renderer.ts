"use client";

import type { CreativeExportRender } from "@/lib/adstudio/creative-export.ts";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCanvasObject,
  AdStudioCreative,
} from "@/lib/adstudio/types.ts";

const META_EXPORT_FORMATS = new Set(["1:1", "4:5", "9:16"]);
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
  const height = object.height ?? object.width;
  const radius = object.role === "cta_button" ? 18 : 0;
  roundedRect(ctx, object.x, object.y, object.width, height, radius);
  ctx.fill();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, object: AdStudioCanvasObject, brandKit: AdStudioBrandKit) {
  const fontSize = object.size ?? 36;
  ctx.save();
  ctx.fillStyle = object.fill ?? "#131B2E";
  ctx.font = `${object.role === "headline" ? 800 : 650} ${fontSize}px ${fontFamily(object, brandKit)}`;
  ctx.textBaseline = "top";
  const lineHeight = Math.round(fontSize * (object.role === "headline" ? 1.1 : 1.25));
  const lines = wrapText(ctx, object.content ?? "", object.width);
  lines.forEach((line, index) => {
    ctx.fillText(line, object.x, object.y + index * lineHeight);
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
    const radius = object.x === 0 && object.y === 0 && width === ctx.canvas.width && height === ctx.canvas.height ? 0 : 22;
    drawImageCover(ctx, image, object.x, object.y, width, height, radius);
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
    image.crossOrigin = "anonymous";
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
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
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
 