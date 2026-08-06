// Asset loading for the renderer.
//
// Template assets (plates, overlay patches) are repo-versioned and hash-pinned:
// the loader verifies sha256 so a corrupted or tampered file fails loudly at
// render time instead of painting wrong pixels. Customer images (slot photos)
// are not hash-pinned — they are the customer's own bytes, decoded as-is.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Resolve a rooted public path ("/fonts/adstudio/…" or
 * "/adstudio-templates/<id>/plate-feed.webp") against the repo root.
 */
export function resolvePublicPath(repoRoot: string, publicSrc: string): string {
  const relative = publicSrc.replace(/^\//, "");
  if (relative.startsWith("..")) {
    throw new Error(`refusing to resolve escaping public path: ${publicSrc}`);
  }
  return join(repoRoot, "public", relative);
}

export async function verifySha256(bytes: Buffer, expected: string, label: string): Promise<void> {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`asset integrity failure for ${label}: sha256 ${actual} ≠ declared ${expected}`);
  }
}

export type NodeCanvasImage = { width: number; height: number } & Record<string, unknown>;

/**
 * Load one hash-pinned template asset (plate or overlay patch) in node.
 * Throws on missing file or sha256 mismatch — a template that cannot prove
 * its pixels must not render.
 */
export async function loadTemplateAssetNode(
  repoRoot: string,
  publicSrc: string,
  expectedSha256: string,
): Promise<NodeCanvasImage> {
  const { loadImage } = await import("@napi-rs/canvas");
  const absolute = resolvePublicPath(repoRoot, publicSrc);
  const bytes = await readFile(absolute);
  await verifySha256(bytes, expectedSha256, publicSrc);
  const image = await loadImage(bytes);
  return image as unknown as NodeCanvasImage;
}

/**
 * Load a customer slot image in node. No hash check (customer bytes), but
 * decode failure throws — generation surfaces it as a 400-class error.
 */
export async function loadSlotImageNode(bytes: Buffer, label: string): Promise<NodeCanvasImage> {
  const { loadImage } = await import("@napi-rs/canvas");
  try {
    const image = await loadImage(bytes);
    return image as unknown as NodeCanvasImage;
  } catch (error) {
    throw new Error(`could not decode customer image for ${label}: ${(error as Error).message}`);
  }
}
