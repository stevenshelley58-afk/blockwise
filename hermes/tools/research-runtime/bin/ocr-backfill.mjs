#!/usr/bin/env node
/**
 * ocr-backfill.mjs — Extract text from ad creative images via system tesseract.
 *
 * Follows the same standalone backfill pattern as media-quality-backfill.mjs.
 * Requires: `tesseract` binary on PATH (apt install tesseract-ocr).
 *
 * Usage:
 *   node bin/ocr-backfill.mjs [--dry-run] [--batch=200] [--concurrency=4]
 *
 * Env:
 *   HERMES_SUPABASE_URL / SUPABASE_URL   — Supabase project URL
 *   HERMES_SUPABASE_SERVICE_ROLE_KEY      — service-role key (or HERMES_SUPABASE_ANON_KEY)
 *   HERMES_RESEARCH_AD_CREATIVES_BUCKET   — storage bucket (default: research-ad-creatives)
 *   HERMES_OCR_BATCH_SIZE                 — creatives per batch (default: 200)
 *   HERMES_OCR_CONCURRENCY                — parallel OCR workers (default: 4)
 *   HERMES_OCR_LANGUAGES                  — tesseract languages (default: eng)
 *   HERMES_OCR_FETCH_TIMEOUT_MS           — image download timeout (default: 15000)
 *   HERMES_OCR_MIN_TEXT_LENGTH            — minimum chars to consider "done" (default: 3)
 *
 * stdout: final JSON stats object.
 * stderr: progress logs.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hermesSupabaseHeaders, resolveHermesSupabaseCredential } from "./supabase-credentials.mjs";

const env = process.env;
const dryRun = process.argv.includes("--dry-run");
const supabaseUrl = String(env.HERMES_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/+$/u, "");
const credential = resolveHermesSupabaseCredential(env);
const mediaBucket = env.HERMES_RESEARCH_AD_CREATIVES_BUCKET || "research-ad-creatives";
const batchSize = Math.max(1, Math.min(1000, Number.parseInt(env.HERMES_OCR_BATCH_SIZE || "200", 10)));
const concurrency = Math.max(1, Math.min(16, Number.parseInt(env.HERMES_OCR_CONCURRENCY || "4", 10)));
const languages = env.HERMES_OCR_LANGUAGES || "eng";
const fetchTimeoutMs = Math.max(1_000, Math.min(60_000, Number.parseInt(env.HERMES_OCR_FETCH_TIMEOUT_MS || "15000", 10)));
const minTextLength = Math.max(1, Number.parseInt(env.HERMES_OCR_MIN_TEXT_LENGTH || "3", 10));

if (!supabaseUrl) throw new Error("Missing HERMES_SUPABASE_URL/SUPABASE_URL");
if (!credential) throw new Error("Missing Hermes Supabase server credential");

const stats = { scanned: 0, done: 0, empty: 0, failed: 0, skipped: 0, fetchFailed: 0, totalChars: 0 };

let lastId = null;
for (;;) {
  const cursor = lastId ? `&id=gt.${encodeURIComponent(lastId)}` : "";
  // Find creatives with images that haven't been OCR-processed yet.
  const creatives = await rest(
    "research",
    `ad_creatives?select=id,primary_image_url,image_urls,image_storage_path,format,ocr_status&or=(ocr_status.is.null,ocr_status.eq.pending)&or=(primary_image_url.not.is.null,image_storage_path.not.is.null)&order=id.asc&limit=${batchSize}${cursor}`,
  );
  if (!creatives.length) break;

  await mapWithConcurrency(creatives, concurrency, processCreative);
  lastId = creatives.at(-1)?.id || lastId;

  console.error(JSON.stringify({ event: "progress", dryRun, ...stats }));
  if (creatives.length < batchSize) break;
}

console.log(JSON.stringify({ dryRun, ...stats }));

// --- Core OCR logic ---

async function processCreative(creative) {
  stats.scanned += 1;
  const imageUrl = resolveImageUrl(creative);
  if (!imageUrl) {
    stats.skipped += 1;
    if (!dryRun) await patchOcrStatus(creative.id, "skipped", null);
    return;
  }

  let buffer;
  try {
    const response = await fetch(imageUrl, {
      headers: { "user-agent": "BlockwiseHermesOCR/1.0" },
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    stats.fetchFailed += 1;
    if (!dryRun) await patchOcrStatus(creative.id, "failed", null);
    return;
  }

  if (buffer.length < 100) {
    // Too small to be a real image (likely a tracking pixel or placeholder).
    stats.skipped += 1;
    if (!dryRun) await patchOcrStatus(creative.id, "skipped", null);
    return;
  }

  const text = await runTesseract(buffer);
  if (text === null) {
    stats.failed += 1;
    if (!dryRun) await patchOcrStatus(creative.id, "failed", null);
    return;
  }

  const cleaned = cleanOcrText(text);
  if (cleaned.length < minTextLength) {
    stats.empty += 1;
    if (!dryRun) await patchOcrStatus(creative.id, "empty", null);
    return;
  }

  stats.done += 1;
  stats.totalChars += cleaned.length;
  if (!dryRun) await patchOcrStatus(creative.id, "done", cleaned);
}

/**
 * Run tesseract on an image buffer. Returns extracted text or null on error.
 * Uses a temp file because tesseract CLI requires a file path (not stdin for images).
 */
async function runTesseract(imageBuffer) {
  let tmpDir = null;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "ocr-"));
    const inputPath = join(tmpDir, "input.png");
    const outputBase = join(tmpDir, "output");
    await writeFile(inputPath, imageBuffer);

    const text = await new Promise((resolve) => {
      const child = spawn("tesseract", [
        inputPath,
        outputBase,
        "-l", languages,
        "--psm", "6", // Assume a single uniform block of text (good for ad creatives).
        "--oem", "3", // Default: LSTM + legacy.
      ], { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });

      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.on("error", () => { clearTimeout(timeout); resolve(null); });
      child.on("close", async (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve(null);
          return;
        }
        try {
          const { readFile } = await import("node:fs/promises");
          const output = await readFile(`${outputBase}.txt`, "utf8");
          resolve(output);
        } catch {
          resolve(null);
        }
      });
    });

    return text;
  } catch {
    return null;
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// --- Helpers ---

function resolveImageUrl(creative) {
  // Prefer stored image (Supabase storage) over external URL (Meta CDN may expire).
  if (creative.image_storage_path) {
    const objectPath = String(creative.image_storage_path).split("/").map(encodeURIComponent).join("/");
    return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(mediaBucket)}/${objectPath}`;
  }
  if (creative.primary_image_url && /^https?:\/\//iu.test(creative.primary_image_url)) {
    return creative.primary_image_url;
  }
  // Fall back to first entry in image_urls array.
  const urls = creative.image_urls;
  if (Array.isArray(urls) && urls.length > 0 && /^https?:\/\//iu.test(String(urls[0] || ""))) {
    return urls[0];
  }
  return null;
}

function cleanOcrText(raw) {
  if (!raw) return "";
  return raw
    // Remove common OCR noise: lone special chars, excessive whitespace.
    .replace(/[|_~`^\\{}[\]<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

async function patchOcrStatus(creativeId, status, text) {
  const patch = { ocr_status: status, updated_at: new Date().toISOString() };
  if (text !== null) patch.ocr_text = text;
  await rest("research", `ad_creatives?id=eq.${encodeURIComponent(creativeId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function mapWithConcurrency(items, limit, operation) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await operation(items[index]);
    }
  });
  await Promise.all(workers);
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
