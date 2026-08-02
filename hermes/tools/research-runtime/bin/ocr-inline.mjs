/**
 * ocr-inline.mjs — Lightweight inline OCR for a single creative image.
 *
 * Used by the supervisor before classification to extract text from the
 * creative's primary image when ocr_text is not yet populated. Falls back
 * gracefully: returns null on any error (missing tesseract, download failure,
 * timeout) so classification proceeds with text-only evidence.
 *
 * Requires: `tesseract` binary on PATH.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_LANGUAGES = "eng";
const MIN_TEXT_LENGTH = 3;

/**
 * Attempt OCR on a creative's primary image.
 *
 * @param {object} creative — ad_creatives row (needs primary_image_url or image_storage_path).
 * @param {object} options
 * @param {string} [options.supabaseUrl] — for resolving storage paths.
 * @param {string} [options.bucket] — storage bucket name.
 * @param {string} [options.languages] — tesseract -l value (default: eng).
 * @param {number} [options.timeoutMs] — max time for download + OCR.
 * @param {typeof fetch} [options.fetchImpl] — fetch implementation.
 * @returns {Promise<string|null>} Extracted text, or null if unavailable/empty/error.
 */
export async function ocrForCreative(creative, options = {}) {
  const url = resolveUrl(creative, options);
  if (!url) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let buffer;
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": "BlockwiseHermesOCR/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }

  if (buffer.length < 100) return null;

  const text = await runTesseract(buffer, options.languages ?? DEFAULT_LANGUAGES, timeoutMs);
  if (!text) return null;

  const cleaned = text
    .replace(/[|_~`^\\{}[\]<>]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return cleaned.length >= MIN_TEXT_LENGTH ? cleaned : null;
}

function resolveUrl(creative, options) {
  const supabaseUrl = (options.supabaseUrl || "").replace(/\/+$/u, "");
  const bucket = options.bucket || "research-ad-creatives";

  if (creative.image_storage_path && supabaseUrl) {
    const objectPath = String(creative.image_storage_path).split("/").map(encodeURIComponent).join("/");
    return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
  }
  if (creative.primary_image_url && /^https?:\/\//iu.test(creative.primary_image_url)) {
    return creative.primary_image_url;
  }
  const urls = creative.image_urls;
  if (Array.isArray(urls) && urls.length > 0 && /^https?:\/\//iu.test(String(urls[0] || ""))) {
    return urls[0];
  }
  return null;
}

function runTesseract(imageBuffer, languages, timeoutMs) {
  return new Promise((resolve) => {
    let tmpDir = null;
    const cleanup = () => { if (tmpDir) rm(tmpDir, { recursive: true, force: true }).catch(() => {}); };

    (async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "ocr-inline-"));
      const inputPath = join(tmpDir, "input.png");
      const outputBase = join(tmpDir, "output");
      await writeFile(inputPath, imageBuffer);

      const child = spawn("tesseract", [
        inputPath,
        outputBase,
        "-l", languages,
        "--psm", "6",
        "--oem", "3",
      ], { stdio: ["ignore", "ignore", "pipe"] });

      const timeout = setTimeout(() => { child.kill("SIGKILL"); cleanup(); resolve(null); }, timeoutMs);
      child.on("error", () => { clearTimeout(timeout); cleanup(); resolve(null); });
      child.on("close", async (code) => {
        clearTimeout(timeout);
        if (code !== 0) { cleanup(); resolve(null); return; }
        try {
          const output = await readFile(`${outputBase}.txt`, "utf8");
          cleanup();
          resolve(output);
        } catch {
          cleanup();
          resolve(null);
        }
      });
    })().catch(() => { cleanup(); resolve(null); });
  });
}
