import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { VideoAdProject, VideoAssetRef } from "./types.js";

export async function renderBeatFrame(project: VideoAdProject, beat: { narration: string; overlay: string; assetIds: string[]; index: number }, assets: Map<string, { bytes?: Uint8Array; path?: string }>): Promise<Buffer> {
  const primary = validColour(project.brandSnapshot?.primaryColour, "#11263d");
  const secondary = validColour(project.brandSnapshot?.secondaryColour, "#d5a24a");
  const canvas = createCanvas(1080, 1920); const ctx = canvas.getContext("2d");
  ctx.fillStyle = primary; ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(0, 0, 1080, 1920);
  const visual = project.assets.find((asset) => beat.assetIds.includes(asset.id) && (asset.kind === "photo" || asset.kind === "video" || asset.kind === "logo" || asset.kind === "testimonial" || asset.kind === "proof"))
    ?? (beat.index === 1 ? project.assets.find((asset) => asset.id === project.brandSnapshot?.logoAssetId || asset.kind === "logo") : undefined);
  if (visual) await drawVisual(ctx, visual, assets.get(visual.id), 70, 220, 940, 780);
  else { ctx.fillStyle = secondary; ctx.fillRect(70, 220, 18, 780); }
  ctx.fillStyle = "#ffffff"; ctx.font = "700 42px Arial"; ctx.fillText(beatName(beat.index), 70, 130);
  ctx.fillStyle = secondary; ctx.font = "700 34px Arial"; drawWrapped(ctx, beat.overlay || "A clear local next step", 70, 1160, 860, 52, 4);
  ctx.fillStyle = "#ffffff"; ctx.font = "400 38px Arial"; drawWrapped(ctx, beat.narration, 70, 1400, 860, 56, 5);
  ctx.fillStyle = secondary; ctx.fillRect(70, 1770, 940, 4);
  ctx.fillStyle = "#ffffff"; ctx.font = "600 27px Arial"; ctx.fillText(project.brandSnapshot?.businessName?.trim() || "Local property team", 70, 1835);
  ctx.fillStyle = secondary; ctx.font = "700 28px Arial"; ctx.fillText(`${beat.index}/4`, 940, 1835);
  return canvas.toBuffer("image/png");
}

async function drawVisual(ctx: SKRSContext2D, asset: VideoAssetRef, resolved: { bytes?: Uint8Array; path?: string } | undefined, x: number, y: number, width: number, height: number): Promise<void> {
  if (!resolved?.bytes && !resolved?.path) return;
  try {
    const image = await loadImage(resolved.bytes ? Buffer.from(resolved.bytes) : resolved.path!);
    const ratio = Math.max(width / image.width, height / image.height); const w = image.width * ratio; const h = image.height * ratio;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h); ctx.restore();
    ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.fillRect(x, y, width, height);
  } catch { /* An optional image never makes the deterministic text path fail. */ }
}

function drawWrapped(ctx: SKRSContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number): void {
  const words = text.trim().split(/\s+/u); const lines: string[] = []; let line = "";
  for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (ctx.measureText(candidate).width > width && line) { lines.push(line); line = word; } else line = candidate; }
  if (line) lines.push(line); for (const item of lines.slice(0, maxLines)) { ctx.fillText(item, x, y); y += lineHeight; }
}
function beatName(index: number): string { return ["", "HOOK", "PROOF", "VALUE", "CTA"][index] ?? "SCENE"; }
function validColour(value: string | undefined, fallback: string): string { return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim() : fallback; }
