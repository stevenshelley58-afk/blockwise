import type { Rect } from "../../../packages/ad-template-pack-contract/src/types";

/** Map a normalized source crop into the schematic's slot coordinates. */
export function normalizedImagePlacement(slot: Rect, crop: Rect): Rect {
  const safe = normalizeCrop(crop);
  return {
    x: slot.x - (safe.x / safe.width) * slot.width,
    y: slot.y - (safe.y / safe.height) * slot.height,
    width: slot.width / safe.width,
    height: slot.height / safe.height,
  };
}

function normalizeCrop(crop: Rect): Rect {
  const width = clampUnit(crop.width);
  const height = clampUnit(crop.height);
  return {
    x: Math.min(clampUnit(crop.x), 1 - width),
    y: Math.min(clampUnit(crop.y), 1 - height),
    width,
    height,
  };
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0.0001, value)) : 1;
}

export function wrapSchematicText(value: string, maxCharacters: number, maxLines: number, width: number, fontSize: number): string[] {
  const clean = value.trim().slice(0, Math.max(0, maxCharacters));
  if (!clean) return [];
  const charsPerLine = Math.max(1, Math.floor(width / Math.max(fontSize * 0.58, 1)));
  const lines: string[] = [];
  let line = "";
  for (const word of clean.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > charsPerLine) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const limited = lines.slice(0, Math.max(1, maxLines));
  if (lines.length > limited.length) {
    const last = limited.length - 1;
    limited[last] = `${limited[last]!.slice(0, Math.max(1, charsPerLine - 1)).trimEnd()}…`;
  }
  return limited;
}
