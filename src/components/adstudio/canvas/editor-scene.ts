// Seed-layout + scene-extraction helpers for the embedded design editor.
//
// A creative's first editor session is seeded from data the pipeline already
// owns: the clean plate (text-free background), the QA text regions (where
// each copy value sits), the QA copy checks (what each value says), and the
// brand kit (which fonts and colours the business uses). After the first save
// the stored Polotno scene is authoritative and these seeds are never rebuilt.
//
// This module is pure JSON-in/JSON-out so the seeding and extraction logic is
// unit-testable without Polotno or a browser.

import type { AdStudioBrandKit, AdStudioCloneRegion, AdStudioCreative } from "@/lib/adstudio/types.ts";

export type EditorSeedTextLayer = {
  fieldKey: string;
  text: string;
  /** Pixel-space frame on the creative canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  align: "left" | "center" | "right";
};

export type EditorSeedLayout = {
  width: number;
  height: number;
  cleanPlate: string;
  texts: EditorSeedTextLayer[];
};

const MIN_SEED_FONT_SIZE = 14;
const MAX_SEED_FONT_SIZE = 160;

/** Keys whose values read as display copy get the heading font; the rest body. */
function isHeadingKey(key: string): boolean {
  return /headline|title|hook|number|price|offer/i.test(key);
}

function seedFontSize(box: AdStudioCloneRegion["box"], canvasHeight: number, text: string): number {
  const boxHeightPx = box.height * canvasHeight;
  // Rough line-count estimate keeps long values from overflowing their box.
  const estimatedLines = Math.max(1, Math.ceil(text.length / 24));
  const size = Math.floor((boxHeightPx * 0.72) / estimatedLines);
  return Math.min(MAX_SEED_FONT_SIZE, Math.max(MIN_SEED_FONT_SIZE, size));
}

/**
 * Build the first-session layout for a plate-backed creative. Returns null when
 * the creative has no plate or no verified text to lay out.
 */
export function buildEditorSeedLayout(input: {
  creative: AdStudioCreative;
  brandKit: AdStudioBrandKit;
}): EditorSeedLayout | null {
  const { creative, brandKit } = input;
  const cleanPlate = creative.canvas.cloneEdit?.cleanPlate;
  const qa = creative.canvas.cloneQa;
  if (!cleanPlate || !qa) return null;

  const width = creative.canvas.width;
  const height = creative.canvas.height;
  const expectedByKey = new Map(qa.copyChecks.map((check) => [check.key, check.expected]));
  const headingFont = brandKit.typography.headingFont?.trim()
    || (brandKit.typography.fallbackHeading === "serif" ? "Georgia" : "Inter");
  const bodyFont = brandKit.typography.bodyFont?.trim()
    || (brandKit.typography.fallbackBody === "serif" ? "Georgia" : "Inter");

  const texts: EditorSeedTextLayer[] = qa.regions
    .filter((region) => region.kind === "text")
    .flatMap((region) => {
      const text = expectedByKey.get(region.key)?.trim();
      if (!text) return [];
      const box = region.box;
      if (box.width <= 0 || box.height <= 0) return [];
      return [{
        fieldKey: region.key,
        text,
        x: Math.round(box.x * width),
        y: Math.round(box.y * height),
        width: Math.max(24, Math.round(box.width * width)),
        height: Math.max(12, Math.round(box.height * height)),
        fontFamily: isHeadingKey(region.key) ? headingFont : bodyFont,
        fontSize: seedFontSize(box, height, text),
        align: "center" as const,
      }];
    });

  if (texts.length === 0) return null;
  return { width, height, cleanPlate, texts };
}

type SceneElementJson = {
  type?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  custom?: { fieldKey?: string } | null;
};

type SceneJson = {
  width?: number;
  height?: number;
  pages?: Array<{ children?: SceneElementJson[] }>;
};

function sceneTextElements(scene: unknown): SceneElementJson[] {
  const pages = (scene as SceneJson)?.pages;
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((page) => page?.children ?? []).filter(
    (element) => element?.type === "text" && typeof element?.custom?.fieldKey === "string",
  );
}

/** Exact text per copy-field key, straight from the scene's text layers. */
export function extractSceneText(scene: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const element of sceneTextElements(scene)) {
    result[element.custom!.fieldKey!] = String(element.text ?? "").trim();
  }
  return result;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Normalized text-layer boxes for the QA regions, so in-place hit targets and
 * future plate rebuilds stay truthful after the customer moves a layer.
 */
export function extractSceneRegions(
  scene: unknown,
  canvas: { width: number; height: number },
): AdStudioCloneRegion[] {
  if (!canvas.width || !canvas.height) return [];
  return sceneTextElements(scene).map((element) => ({
    key: element.custom!.fieldKey!,
    kind: "text" as const,
    box: {
      x: clamp01((element.x ?? 0) / canvas.width),
      y: clamp01((element.y ?? 0) / canvas.height),
      width: clamp01((element.width ?? 0) / canvas.width),
      height: clamp01((element.height ?? 0) / canvas.height),
    },
  }));
}
