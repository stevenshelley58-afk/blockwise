import type { AdStudioCreative } from "./types.ts";

/**
 * Derives a plain-language composition brief from a creative's real layout
 * geometry so the image model knows where copy will be overlaid and keeps the
 * subject + horizon out of those zones. This is what makes a generated photo
 * actually fit the template instead of being a generic stock image.
 *
 * Pure + deterministic: safe to import on the client (no server-only deps).
 */

type Box = { x: number; y: number; width: number; height: number };

const COPY_ROLES = new Set(["headline", "subheadline", "cta_button", "cta_text"]);

export function buildLayoutBrief(creative: Pick<AdStudioCreative, "canvas" | "format">): string {
  const width = creative.canvas?.width ?? 1080;
  const height = creative.canvas?.height ?? 1080;
  const objects = creative.canvas?.objects ?? [];

  const copyBoxes = objects
    .filter((object) => COPY_ROLES.has(object.role))
    .map((object) => ({ x: object.x, y: object.y, width: object.width, height: object.height ?? 0 }))
    .filter((box) => Number.isFinite(box.x) && Number.isFinite(box.y));

  const region = copyBoxes.length
    ? describeRegion(unionBox(copyBoxes), width, height)
    : "lower portion";
  const subjectRegion = complementaryRegion(region);

  return [
    `Composition for a ${creative.format} real-estate ad creative.`,
    `Reserve the ${region} of the frame as clean, low-detail, copy-safe space:`,
    `a headline, sub-headline and a call-to-action button will be overlaid there afterward,`,
    `so keep the main subject, the horizon line and any busy detail out of that area.`,
    `Place the property (or main subject) toward the ${subjectRegion} and keep it sharp and well lit.`,
    `Photoreal, editorial real-estate quality, even natural lighting, uncluttered background.`,
    `Do NOT render any text, headlines, logos, badges, price tags or watermarks in the image -`,
    `all text is composited separately by the template.`,
  ].join(" ");
}

function unionBox(boxes: Box[]): Box {
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function describeRegion(box: Box, width: number, height: number): string {
  const cx = (box.x + box.width / 2) / width;
  const cy = (box.y + box.height / 2) / height;
  const vertical = cy < 0.38 ? "upper" : cy > 0.62 ? "lower" : "middle";
  const horizontal = cx < 0.4 ? "left" : cx > 0.6 ? "right" : "centre";

  // Wide copy blocks span the full width — describe as a horizontal band.
  if (box.width / width > 0.7) {
    return `${vertical} third`;
  }
  if (vertical === "middle") {
    return `${horizontal} side`;
  }
  return `${vertical}-${horizontal}`;
}

function complementaryRegion(region: string): string {
  if (region.includes("lower")) return "upper two-thirds";
  if (region.includes("upper")) return "lower two-thirds";
  if (region.includes("left")) return "right side";
  if (region.includes("right")) return "left side";
  return "opposite side of the copy area";
}
