#!/usr/bin/env node

import { spawn } from "node:child_process";

import { assessCapturedImageQuality, readImageDimensions } from "./ad-classifier.mjs";
import { hermesSupabaseHeaders, resolveHermesSupabaseCredential } from "./supabase-credentials.mjs";

const env = process.env;
const dryRun = process.argv.includes("--dry-run");
const supabaseUrl = String(env.HERMES_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/+$/u, "");
const credential = resolveHermesSupabaseCredential(env);
const mediaBucket = env.HERMES_RESEARCH_AD_CREATIVES_BUCKET || "research-ad-creatives";
const batchSize = Math.max(1, Math.min(500, Number.parseInt(env.HERMES_MEDIA_QUALITY_BACKFILL_BATCH_SIZE || "200", 10)));

if (!supabaseUrl) throw new Error("Missing HERMES_SUPABASE_URL/SUPABASE_URL");
if (!credential) throw new Error("Missing Hermes Supabase server credential");

const stats = {
  scanned: 0,
  measured: 0,
  blocked: 0,
  unchanged: 0,
  fetchFailed: 0,
  probeFailed: 0,
  creativesRebuilt: 0,
};
const affectedCreativeIds = new Set();

let lastId = null;
for (;;) {
  const cursor = lastId ? `&id=gt.${encodeURIComponent(lastId)}` : "";
  const assets = await rest(
    "research",
    `media_assets?select=id,ad_creative_id,kind,source_url,storage_path,content_type,byte_size,width,height,capture_status,metadata,created_at&capture_status=eq.captured&kind=eq.image${cursor}&order=id.asc&limit=${batchSize}`,
  );
  if (!assets.length) break;

  for (const asset of assets) {
    stats.scanned += 1;
    lastId = asset.id;
    const url = mediaUrl(asset);
    if (!url) {
      stats.fetchFailed += 1;
      continue;
    }

    let response;
    try {
      response = await fetch(url, { headers: { "user-agent": "BlockwiseHermesMediaRepair/1.0" } });
      if (!response.ok) throw new Error(`media fetch failed ${response.status}`);
    } catch {
      stats.fetchFailed += 1;
      continue;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || asset.content_type || null;
    const dimensions = readImageDimensions(buffer, contentType) ?? await ffprobeImageDimensions(buffer);
    if (!dimensions) stats.probeFailed += 1;
    else stats.measured += 1;

    const quality = assessCapturedImageQuality({
      byteSize: buffer.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    });
    const patch = {
      byte_size: buffer.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      content_type: contentType,
      updated_at: new Date().toISOString(),
    };

    if (!quality.displayable) {
      patch.capture_status = "blocked";
      patch.last_error = `Media quality rejected: ${quality.reason}`;
      patch.metadata = {
        ...(asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {}),
        media_quality_rejection: quality.reason,
        repaired_by: "media-quality-backfill",
      };
      stats.blocked += 1;
      affectedCreativeIds.add(asset.ad_creative_id);
    } else if (
      asset.byte_size === buffer.length &&
      asset.width === (dimensions?.width ?? null) &&
      asset.height === (dimensions?.height ?? null)
    ) {
      stats.unchanged += 1;
      continue;
    }

    if (!dryRun) {
      await rest("research", `media_assets?id=eq.${encodeURIComponent(asset.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    }
  }

  if (assets.length < batchSize) break;
}

if (!dryRun) {
  for (const creativeId of affectedCreativeIds) {
    await refreshCreativeStoredMedia(creativeId);
    stats.creativesRebuilt += 1;
  }
}

console.log(JSON.stringify({ dryRun, ...stats }));

function mediaUrl(asset) {
  if (asset.storage_path) {
    const objectPath = String(asset.storage_path).split("/").map(encodeURIComponent).join("/");
    return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(mediaBucket)}/${objectPath}`;
  }
  return /^https?:\/\//iu.test(String(asset.source_url || "")) ? asset.source_url : null;
}

async function refreshCreativeStoredMedia(adCreativeId) {
  const [assets, creatives] = await Promise.all([
    rest("research", `media_assets?select=id,kind,storage_path,content_type,byte_size,width,height,capture_status,captured_at,created_at&ad_creative_id=eq.${encodeURIComponent(adCreativeId)}&capture_status=eq.captured&order=created_at.asc,id.asc&limit=100`),
    rest("research", `ad_creatives?select=id,format,display_state&id=eq.${encodeURIComponent(adCreativeId)}&limit=1`),
  ]);
  const creative = creatives[0];
  if (!creative) return;

  const firstImage = assets.find((asset) => asset.kind === "image")?.storage_path || null;
  const firstVideo = assets.find((asset) => asset.kind === "video")?.storage_path || null;
  const firstThumbnail = assets.find((asset) => asset.kind === "thumbnail")?.storage_path || null;
  const hasDisplayableMedia = assets.some((asset) => asset.kind === "video" || asset.kind === "image");

  await rest("research", `ad_creatives?id=eq.${encodeURIComponent(adCreativeId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      image_storage_path: firstImage,
      video_storage_path: firstVideo,
      video_thumbnail_url: firstThumbnail,
      media_assets: assets.map((asset) => ({
        kind: asset.kind,
        storagePath: asset.storage_path,
        contentType: asset.content_type,
        byteSize: asset.byte_size,
        width: asset.width,
        height: asset.height,
        captureStatus: asset.capture_status,
        capturedAt: asset.captured_at,
      })),
      display_state:
        ["image", "video", "carousel"].includes(creative.format) && !hasDisplayableMedia
          ? "hidden"
          : creative.display_state,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function rest(schema, path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: hermesSupabaseHeaders(credential, {
      "Accept-Profile": schema,
      "Content-Profile": schema,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${schema}.${path} failed ${response.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) : null;
}

function ffprobeImageDimensions(buffer) {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      "pipe:0",
    ], { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const stream = JSON.parse(output)?.streams?.[0];
        const width = Number(stream?.width);
        const height = Number(stream?.height);
        resolve(width > 0 && height > 0 ? { width, height } : null);
      } catch {
        resolve(null);
      }
    });
    child.stdin.end(buffer);
  });
}
