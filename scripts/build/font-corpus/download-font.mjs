// Downloads and caches font files by URL. Shared across every region/
// template that shortlists the same family — most popular families show up
// in many shortlists, so this cache is what keeps Stage B from re-fetching
// the same handful of megabytes-scale files thousands of times.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_DIR = path.resolve(process.cwd(), ".cache/font-corpus/fonts");

export async function downloadFont(url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const ext = url.endsWith(".woff2") ? "woff2" : "ttf";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  const cachePath = path.join(CACHE_DIR, `${hash}.${ext}`);

  try {
    await access(cachePath);
    return cachePath;
  } catch { /* not cached */ }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(cachePath, buffer);
  return cachePath;
}
