// Read-only Template Studio queue projection. This module intentionally stays
// independent from the authoring, renderer, and schema modules so queue pages
// do not pull those production dependencies into their server trace.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GALLERY_DIR = join(
  /* turbopackIgnore: true */ process.cwd(),
  "src",
  "lib",
  "adstudio",
  "template-gallery-v2",
);

export type StudioQueueEntry = {
  id: string;
  status: string;
  intent: string;
  hasStory: boolean;
  bakedCount: number;
  residualMax: number | null;
  restyleTrivial: boolean;
};

type QueueTemplateDocument = {
  id?: unknown;
  classification?: { primary_intent?: unknown };
  formats?: { story?: unknown };
  exactness?: {
    status?: unknown;
    bakedTextKeys?: unknown;
    residuals?: unknown;
  };
  restyle?: {
    paletteMap?: unknown;
    replacedAssets?: unknown;
  };
};

function queueEntry(doc: QueueTemplateDocument, fallbackId: string): StudioQueueEntry {
  const residuals = doc.exactness?.residuals;
  const residualValues = residuals && typeof residuals === "object"
    ? Object.values(residuals).filter((value): value is number => typeof value === "number")
    : [];
  const paletteMap = doc.restyle?.paletteMap;
  const replacedAssets = doc.restyle?.replacedAssets;

  return {
    id: typeof doc.id === "string" ? doc.id : fallbackId,
    status: typeof doc.exactness?.status === "string" ? doc.exactness.status : "broken",
    intent: typeof doc.classification?.primary_intent === "string" ? doc.classification.primary_intent : "other",
    hasStory: Boolean(doc.formats?.story),
    bakedCount: Array.isArray(doc.exactness?.bakedTextKeys) ? doc.exactness.bakedTextKeys.length : 0,
    residualMax: residualValues.length > 0 ? Math.max(...residualValues) : null,
    restyleTrivial:
      (!paletteMap || typeof paletteMap !== "object" || Object.keys(paletteMap).length === 0)
      && (!Array.isArray(replacedAssets) || replacedAssets.length === 0),
  };
}

export function studioQueue(): StudioQueueEntry[] {
  if (!existsSync(GALLERY_DIR)) return [];

  const entries: StudioQueueEntry[] = [];
  for (const entry of readdirSync(GALLERY_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(GALLERY_DIR, entry.name, "template.json");
    if (!existsSync(path)) continue;
    try {
      entries.push(queueEntry(JSON.parse(readFileSync(path, "utf8")) as QueueTemplateDocument, entry.name));
    } catch {
      entries.push({ id: entry.name, status: "broken", intent: "other", hasStory: false, bakedCount: 0, residualMax: null, restyleTrivial: true });
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
