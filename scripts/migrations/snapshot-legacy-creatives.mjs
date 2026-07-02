#!/usr/bin/env node
// Snapshot legacy canvas-composited AdStudio creatives to PNG (P2.3).
//
// This script is the guard that later allows deleting the legacy SVG/Fabric
// renderer (P2.4): per AGENTS.md, destructive follow-ups must be quantified
// first. It renders every composited creative to a durable PNG and records
// the artifact on the row, so old campaigns keep a preview after the renderer
// is gone. Run it against prod and verify the counts BEFORE deleting the
// renderer.
//
// For every adstudio_creatives row whose canvas_json has MORE THAN ONE object
// (composited by the legacy generator — new template clones are a single
// image) and whose render_status is not yet "legacy_snapshot":
//   1. rebuild its preview SVG with renderCreativeSvg (the same renderer the
//      app uses), with storage-proxied images inlined as data URLs,
//   2. rasterize the SVG to PNG with Playwright chromium,
//   3. upload the PNG to the private workspace-artifacts bucket at
//      {workspace_id}/adstudio/legacy-snapshots/{creative_id}.png,
//   4. update the row: render_status = "legacy_snapshot" and
//      canvas_json.legacySnapshotPath = <storage path> (every other
//      canvas_json key is preserved).
//
// Idempotent: snapshotted rows are excluded by the render_status filter and
// storage uploads use upsert, so re-running only processes what is left.
//
// Usage:
//   node scripts/migrations/snapshot-legacy-creatives.mjs --dry-run   # counts only
//   node scripts/migrations/snapshot-legacy-creatives.mjs
//
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// Requires Node >= 22.18 (imports the app's TypeScript renderer directly) and
// Playwright chromium (devDependency; PLAYWRIGHT_BROWSERS_PATH works as usual).

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { renderCreativeSvg } from "../../src/lib/adstudio/creative-svg.ts";

const BUCKET = "workspace-artifacts";
const BATCH_SIZE = 20;
const PAGE_SIZE = 1000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const dryRun = process.argv.includes("--dry-run");

function requireEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing env: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  return { url, serviceRoleKey };
}

function isCompositedCanvas(canvas) {
  return Boolean(canvas && Array.isArray(canvas.objects) && canvas.objects.length > 1);
}

/** Page through every non-snapshotted creative row (id-ordered, stable). */
async function loadPendingRows(supabase) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("adstudio_creatives")
      .select("id, workspace_id, campaign_id, format, width, height, render_status, canvas_json")
      .neq("render_status", "legacy_snapshot")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not list adstudio_creatives: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function countSnapshotted(supabase) {
  const { count, error } = await supabase
    .from("adstudio_creatives")
    .select("id", { count: "exact", head: true })
    .eq("render_status", "legacy_snapshot");
  if (error) throw new Error(`Could not count snapshotted creatives: ${error.message}`);
  return count ?? 0;
}

/**
 * Minimal brand-kit context for renderCreativeSvg (fonts + brand name for
 * logo fallbacks). Missing kits are fine — the renderer has safe defaults.
 */
async function loadBrandContext(supabase, campaignId, cache) {
  if (cache.has(campaignId)) return cache.get(campaignId);
  let context;
  try {
    const campaign = await supabase
      .from("adstudio_campaigns")
      .select("brand_kit_id")
      .eq("id", campaignId)
      .maybeSingle();
    const brandKitId = campaign.data?.brand_kit_id;
    if (brandKitId) {
      const kit = await supabase
        .from("adstudio_brand_kits")
        .select("business_name, identity_json, typography_json")
        .eq("id", brandKitId)
        .maybeSingle();
      if (kit.data) {
        const identity = kit.data.identity_json ?? {};
        const typography = kit.data.typography_json ?? {};
        context = {
          identity: {
            businessName: identity.businessName ?? kit.data.business_name ?? "",
            tradingName: identity.tradingName ?? null,
          },
          typography: {
            headingFont: typography.headingFont ?? "",
            bodyFont: typography.bodyFont ?? "",
            fallbackHeading: typography.fallbackHeading === "serif" ? "serif" : "sans-serif",
            fallbackBody: typography.fallbackBody === "serif" ? "serif" : "sans-serif",
          },
        };
      }
    }
  } catch (error) {
    console.warn(`  brand kit lookup failed for campaign ${campaignId}: ${error.message}`);
  }
  cache.set(campaignId, context);
  return context;
}

/**
 * Chromium cannot resolve the app's auth-gated media proxy or the app's public
 * files from a raw SVG document, so inline them as data URLs before rendering.
 */
async function inlineImageSrc(supabase, src) {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("data:") || /^https?:\/\//i.test(src)) return src;

  if (src.startsWith("/api/adstudio/media?")) {
    const storagePath = new URLSearchParams(src.split("?")[1] ?? "").get("path")?.trim();
    if (!storagePath) return src;
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      console.warn(`  could not download ${storagePath}: ${error?.message ?? "no data"}`);
      return src;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    return `data:${data.type || "image/jpeg"};base64,${buffer.toString("base64")}`;
  }

  if (src.startsWith("/")) {
    // App public asset (e.g. /adstudio-samples/..., /ads/...).
    try {
      const filePath = path.join(REPO_ROOT, "public", src.replace(/^\/+/, ""));
      const buffer = await readFile(filePath);
      const type = src.endsWith(".svg") ? "image/svg+xml" : src.endsWith(".png") ? "image/png" : "image/jpeg";
      return `data:${type};base64,${buffer.toString("base64")}`;
    } catch {
      return src;
    }
  }

  return src;
}

async function canvasWithInlinedImages(supabase, canvas) {
  const objects = [];
  for (const object of canvas.objects) {
    if (object?.type === "image" || object?.type === "logo") {
      objects.push({
        ...object,
        content: await inlineImageSrc(supabase, object.content),
        assetId: await inlineImageSrc(supabase, object.assetId),
      });
    } else {
      objects.push(object);
    }
  }
  return { ...canvas, objects };
}

async function rasterizeSvg(browser, svg, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(
      `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`,
      { waitUntil: "networkidle" },
    );
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
  } finally {
    await page.close();
  }
}

async function snapshotRow(supabase, browser, row, brandCache) {
  const canvas = row.canvas_json;
  const width = Number(canvas.width) || Number(row.width) || 1080;
  const height = Number(canvas.height) || Number(row.height) || 1080;

  const brandKit = await loadBrandContext(supabase, row.campaign_id, brandCache);
  const inlined = await canvasWithInlinedImages(supabase, canvas);
  const svg = renderCreativeSvg({ canvas: inlined }, brandKit);
  const png = await rasterizeSvg(browser, svg, width, height);

  const storagePath = `${row.workspace_id}/adstudio/legacy-snapshots/${row.id}.png`;
  const uploaded = await supabase.storage.from(BUCKET).upload(storagePath, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (uploaded.error) throw new Error(`upload failed: ${uploaded.error.message}`);

  // Preserve every existing canvas_json key; only add the snapshot pointer.
  const updated = await supabase
    .from("adstudio_creatives")
    .update({
      render_status: "legacy_snapshot",
      canvas_json: { ...canvas, legacySnapshotPath: storagePath },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updated.error) throw new Error(`row update failed: ${updated.error.message}`);

  return storagePath;
}

async function main() {
  const { url, serviceRoleKey } = requireEnv();
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  console.log(`Scanning adstudio_creatives (${dryRun ? "dry run" : "live run"})...`);
  const [pendingRows, alreadySnapshotted] = await Promise.all([
    loadPendingRows(supabase),
    countSnapshotted(supabase),
  ]);
  const candidates = pendingRows.filter((row) => isCompositedCanvas(row.canvas_json));
  const skippedSingleObject = pendingRows.length - candidates.length;

  console.log(`Rows scanned (render_status != legacy_snapshot): ${pendingRows.length}`);
  console.log(`Composited legacy creatives pending snapshot:    ${candidates.length}`);
  console.log(`Single-object rows left untouched (clones):      ${skippedSingleObject}`);
  console.log(`Rows already snapshotted (legacy_snapshot):      ${alreadySnapshotted}`);

  if (dryRun) {
    console.log("\nDry run — no snapshots rendered, no rows updated.");
    return;
  }
  if (candidates.length === 0) {
    console.log("\nNothing to snapshot. Done.");
    return;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const brandCache = new Map();
  let done = 0;
  const failures = [];

  try {
    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE);
      const batchNumber = Math.floor(start / BATCH_SIZE) + 1;
      const batchCount = Math.ceil(candidates.length / BATCH_SIZE);
      console.log(`\nBatch ${batchNumber}/${batchCount} (${batch.length} creatives)...`);
      for (const row of batch) {
        try {
          const storagePath = await snapshotRow(supabase, browser, row, brandCache);
          done += 1;
          console.log(`  [${done}/${candidates.length}] ${row.id} -> ${storagePath}`);
        } catch (error) {
          failures.push({ id: row.id, message: error.message });
          console.error(`  FAILED ${row.id}: ${error.message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  // Row-count summary: compare these numbers against prod before deleting the
  // legacy renderer (P2.4). Snapshot count must equal the composited count.
  const snapshottedNow = await countSnapshotted(supabase);
  console.log("\n=== Summary ===");
  console.log(`Composited creatives targeted this run: ${candidates.length}`);
  console.log(`Snapshotted this run:                   ${done}`);
  console.log(`Failed this run:                        ${failures.length}`);
  console.log(`Total rows with render_status=legacy_snapshot: ${snapshottedNow}`);
  if (failures.length > 0) {
    console.error("\nSome creatives failed to snapshot — re-run after fixing; the run is idempotent.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
