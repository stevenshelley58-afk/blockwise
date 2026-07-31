// Editable regions for AI-cloned creatives.
//
// Customer generation does not run vision. Text hit-boxes are measured once
// from the approved sample during the offline template build and copied into
// each matching-format creative before it is persisted. The parsing helpers
// remain for legacy rows and offline tooling.

import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioCloneQa, AdStudioCloneRegion } from "./types.ts";

export type CloneRegion = AdStudioCloneRegion;
export type CloneBox = CloneRegion["box"];

/**
 * Build the editor map from the template's offline type-spec block. Both
 * supported canvases are 1080px wide. Story generation extends a Feed canvas
 * equally above and below; Feed generation from a Story sample centre-crops.
 * Applying that same deterministic transform keeps the offline boxes aligned
 * without inspecting the customer's finished render.
 */
export function buildPrebuiltTemplateCloneQa(
  template: AdStudioTemplate,
  expectedCopy: Record<string, string>,
  format: string,
): AdStudioCloneQa | undefined {
  const targetHeight = format === "4:5" ? 1350 : format === "9:16" ? 1920 : null;
  if (!targetHeight) return undefined;
  const sourceHeight = template.dimensions.height;
  const verticalOffset = (targetHeight - sourceHeight) / 2;
  const mapSampleBox = (sampleBox: CloneBox): CloneBox | null => {
    const rawY = (sampleBox.y * sourceHeight + verticalOffset) / targetHeight;
    const rawBottom = rawY + (sampleBox.height * sourceHeight) / targetHeight;
    const y = Math.max(0, rawY);
    const bottom = Math.min(1, rawBottom);
    if (bottom <= y) return null;
    return {
      x: sampleBox.x,
      y,
      width: sampleBox.width,
      height: bottom - y,
    };
  };
  const regions = template.inputs.text.flatMap<AdStudioCloneRegion>((field) => {
    const sampleBox = template.typography?.[field.key]?.sampleBox;
    if (!sampleBox) return [];
    const box = mapSampleBox(sampleBox);
    if (!box) return [];
    return [{
      key: field.key,
      kind: "text",
      box,
    }];
  });
  for (const field of template.inputs.images) {
    const sampleBox = template.deterministicEditing?.imageBoxes[field.key];
    if (!sampleBox) continue;
    const box = mapSampleBox(sampleBox);
    if (box) regions.push({ key: field.key, kind: "image", box });
  }
  return regions.length > 0 ? { regions, copyValues: { ...expectedCopy } } : undefined;
}

function clamp01(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, num));
}

/**
 * Vision models localize far more accurately in their native detection format
 * (box_2d = [ymin, xmin, ymax, xmax] integers scaled 0-1000) than when asked
 * for fractional x/y/width/height, which drifts and undersizes. Convert to the
 * editor's fractional box here. Legacy fractional "box" objects (older prompt
 * versions may still be active in the DB) remain accepted.
 */
export function boxFromRegionEntry(item: Record<string, unknown>): CloneBox {
  const box2d = item.box_2d;
  if (Array.isArray(box2d) && box2d.length === 4) {
    const values = box2d.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
    // A model that ignores the 0-1000 scale and answers in 0-1 fractions would
    // otherwise collapse every box into the top-left 0.1% of the image.
    const scale = values.every((value) => value <= 1) ? 1 : 1 / 1000;
    const [ymin, xmin, ymax, xmax] = values.map((value) => clamp01(value * scale)) as [number, number, number, number];
    return {
      x: Math.min(xmin, xmax),
      y: Math.min(ymin, ymax),
      width: Math.abs(xmax - xmin),
      height: Math.abs(ymax - ymin),
    };
  }
  const box = (item.box ?? {}) as Record<string, unknown>;
  return {
    x: clamp01(box.x),
    y: clamp01(box.y),
    width: clamp01(box.width),
    height: clamp01(box.height),
  };
}

export function parseCloneRegions(
  raw: unknown,
  expectedCopy: Record<string, string>,
): CloneRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: CloneRegion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!key) continue;
    regions.push({
      key,
      // Declared copy keys are authoritative. Vision occasionally labels a
      // text box inside a large photo region as an image, which would open the
      // file picker instead of the text editor.
      kind: Object.hasOwn(expectedCopy, key) ? "text" : item.kind === "image" ? "image" : "text",
      box: boxFromRegionEntry(item),
    });
  }
  return regions;
}
