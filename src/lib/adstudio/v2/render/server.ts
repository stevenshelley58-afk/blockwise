// THE canonical pixel producer.
//
// renderAdDocToPng(doc, instance, format) rasterizes a template (+ customer
// instance) at exact 1080×1350 / 1080×1920 via @napi-rs/canvas. Every
// customer-visible pixel in v2 comes from this function — creation, edit-save,
// publish export, gallery samples. Same doc in, identical bytes out.
//
// Slot images are injected as raw bytes (or a resolver): resolving the
// src kinds (workspace-media bucket fetch, data URLs, builtin, remote) needs
// storage/network access that lives one level up (v2/generate.ts), so the
// renderer stays pure.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdDocInstance, AdTemplateDocV2 } from "../template-doc.ts";
import { TEMPLATE_FORMAT_DIMENSIONS } from "../template-doc.ts";
import { loadSlotImageNode, loadTemplateAssetNode, type NodeCanvasImage } from "./assets.ts";
import { getNapiCanvas, registerNodeFonts } from "./fonts.ts";
import { renderAdDoc, type AdDocFormat, type AdDocLayoutKey } from "./render-doc.ts";
import type { RenderedAssets } from "./types.ts";

/**
 * Repo root derivation that survives bundling. Walking up from the module
 * file works when the file tree is intact (local, VPS); under Turbopack on
 * Vercel the compiled chunk's import.meta.url no longer maps to the source
 * tree, so the marker check falls back to process.cwd() (/var/task), where
 * Next places the project files including public/.
 */
export function repoRootFromHere(): string {
  const here = fileURLToPath(import.meta.url);
  const fromModule = join(here, "..", "..", "..", "..", "..");
  if (existsSync(join(fromModule, "public", "fonts", "adstudio"))) return fromModule;
  if (existsSync(join(process.cwd(), "public", "fonts", "adstudio"))) return process.cwd();
  return fromModule;
}

const registeredFontDirs = new Set<string>();
const registrationPromises = new Map<string, Promise<void>>();

/** Idempotent per-process registration of a font corpus directory. */
export function ensureAdStudioFonts(fontsDir: string): Promise<void> {
  if (registeredFontDirs.has(fontsDir)) return Promise.resolve();
  let pending = registrationPromises.get(fontsDir);
  if (!pending) {
    pending = registerNodeFonts(fontsDir).then(() => {
      registeredFontDirs.add(fontsDir);
    });
    registrationPromises.set(fontsDir, pending);
  }
  return pending;
}

/** For tests: forget registered dirs (isolation between font sets). */
export function resetFontRegistrationCache(): void {
  registeredFontDirs.clear();
  registrationPromises.clear();
}

export type SlotBytesResolver = (src: string, inputKey: string) => Promise<Buffer>;

export type RenderAdDocOptions = {
  /** Defaults to the repo root derived from this module's location. */
  repoRoot?: string;
  /** Defaults to <repoRoot>/public/fonts/adstudio. */
  fontsDir?: string;
  /** Pre-decoded customer photos, keyed by inputs.images[].key. */
  slotBytes?: Map<string, Buffer>;
  /** Fetches bytes for any slot not covered by slotBytes. */
  resolveSlotSrc?: SlotBytesResolver;
};

async function loadSlotAssets(
  doc: AdTemplateDocV2,
  instance: AdDocInstance | null,
  options: RenderAdDocOptions,
): Promise<Map<string, NodeCanvasImage>> {
  const slotImages = new Map<string, NodeCanvasImage>();
  const keys = new Set<string>();
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "image_slot") keys.add(layer.inputKey);
    }
  }
  for (const key of keys) {
    const preloaded = options.slotBytes?.get(key);
    if (preloaded) {
      slotImages.set(key, await loadSlotImageNode(preloaded, key));
      continue;
    }
    const src = instance?.values.images[key]?.src;
    if (src && options.resolveSlotSrc) {
      slotImages.set(key, await loadSlotImageNode(await options.resolveSlotSrc(src, key), key));
    }
    // No bytes and no resolver: the slot simply shows the plate through.
    // Guided customer generation always supplies every required slot (the
    // input-contract validation upstream rejects missing required images).
  }
  return slotImages;
}

/**
 * Load the hash-pinned template assets (plate + overlay patches) for one
 * format. Any integrity failure throws — wrong pixels never render silently.
 */
export async function loadDocAssets(
  repoRoot: string,
  doc: AdTemplateDocV2,
  layoutKey: AdDocLayoutKey,
  slotImages: Map<string, NodeCanvasImage>,
): Promise<RenderedAssets> {
  const layout = doc.formats[layoutKey];
  if (!layout) throw new Error(`template ${doc.id} has no ${layoutKey} layout`);

  const plate = await loadTemplateAssetNode(repoRoot, layout.plate.src, layout.plate.sha256);
  const patches = new Map<string, NodeCanvasImage>();
  for (const layer of layout.layers) {
    if (layer.type === "overlay_patch" && !patches.has(layer.id)) {
      patches.set(layer.id, await loadTemplateAssetNode(repoRoot, layer.src, layer.sha256));
    }
  }
  return { plate, patches, slotImages: slotImages as RenderedAssets["slotImages"] };
}

/**
 * Render one format to a PNG buffer. THE deterministic pixel function:
 * every customer-facing render in v2 passes through here.
 */
export async function renderAdDocToPng(
  doc: AdTemplateDocV2,
  instance: AdDocInstance | null,
  format: AdDocFormat,
  options: RenderAdDocOptions = {},
): Promise<Buffer> {
  const { Canvas } = await getNapiCanvas();
  const repoRoot = options.repoRoot ?? repoRootFromHere();
  const dims = TEMPLATE_FORMAT_DIMENSIONS[format];
  const layoutKey: AdDocLayoutKey = format === "4:5" ? "feed" : "story";

  const layout = doc.formats[layoutKey];
  if (!layout || layout.format !== format) {
    throw new Error(`template ${doc.id} has no ${format} layout under ${layoutKey}`);
  }

  await ensureAdStudioFonts(options.fontsDir ?? join(repoRoot, "public", "fonts", "adstudio"));
  const slotImages = await loadSlotAssets(doc, instance, options);
  const assets = await loadDocAssets(repoRoot, doc, layoutKey, slotImages);

  const canvas = new Canvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  renderAdDoc(
    ctx as unknown as Parameters<typeof renderAdDoc>[0],
    doc,
    instance,
    assets,
    layoutKey,
  );
  return canvas.toBuffer("image/png");
}
