// Asset loading for the renderer.
//
// Template assets (plates, overlay patches) are repo-versioned and hash-pinned:
// the loader verifies sha256 so a corrupted or tampered file fails loudly at
// render time instead of painting wrong pixels. Customer images (slot photos)
// are not hash-pinned — they are the customer's own bytes, decoded as-is.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { getNapiCanvas } from "./fonts.ts";

/**
 * Resolve a rooted fixture/public path against the repo root without allowing
 * traversal outside public/. Production plate/patch refs use the private
 * resolver below.
 */
export function resolvePublicPath(repoRoot: string, publicSrc: string): string {
  if (!publicSrc.startsWith("/") || publicSrc.includes("\\") || publicSrc.includes("\0")) {
    throw new Error(`refusing to resolve invalid public path: ${publicSrc}`);
  }
  const publicRoot = resolve(repoRoot, "public");
  const absolute = resolve(publicRoot, `.${publicSrc}`);
  const fromPublicRoot = relative(publicRoot, absolute);
  if (fromPublicRoot === ".." || fromPublicRoot.startsWith(`..${sep}`) || isAbsolute(fromPublicRoot)) {
    throw new Error(`refusing to resolve escaping public path: ${publicSrc}`);
  }
  return absolute;
}

const PRIVATE_TEMPLATE_ASSET = /^\/adstudio-templates\/([a-z0-9_-]+)\/((?:plate|patch)-[A-Za-z0-9._-]+)$/;

export function templateAssetsV2Dir(repoRoot = process.cwd()): string {
  return join(repoRoot, "src", "lib", "adstudio", "template-assets-v2");
}

/**
 * Template docs keep stable logical asset refs, but the corresponding bytes
 * live in the server bundle rather than public/. Browser clients can never
 * turn one of these refs into a static-file download.
 */
export function resolveTemplateAssetPath(repoRoot: string, src: string): string {
  const match = PRIVATE_TEMPLATE_ASSET.exec(src);
  if (!match) {
    if (src.startsWith("/adstudio-templates/")) {
      throw new Error(`refusing non-private template asset path: ${src}`);
    }
    return resolvePublicPath(repoRoot, src); // fixture-only public assets
  }
  return join(templateAssetsV2Dir(repoRoot), match[1]!, match[2]!);
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
  const { loadImage } = await getNapiCanvas();
  const absolute = resolveTemplateAssetPath(repoRoot, publicSrc);
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
  const { loadImage } = await getNapiCanvas();
  try {
    const image = await loadImage(bytes);
    return image as unknown as NodeCanvasImage;
  } catch (error) {
    throw new Error(`could not decode customer image for ${label}: ${(error as Error).message}`);
  }
}
