import type { CreativeSkeleton } from "../ad-template-library/skeleton.ts";
import type { AdStudioFormat } from "./types.ts";

export type SkeletonGenerationContext = {
  brief: string;
  maskSvgDataUrl: string;
  copySafeZoneSummary: string;
};

const CANVAS_BY_FORMAT: Record<AdStudioFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "1.91:1": { width: 1200, height: 628 },
};

export function buildSkeletonGenerationContext(
  skeleton: CreativeSkeleton,
  input: { format: AdStudioFormat; fallbackBrief: string },
): SkeletonGenerationContext {
  const copySafeZoneSummary = skeleton.composition.copy_safe_zones
    .map((zone) => `${zone.id}: ${describeZone(zone)} (${zone.priority ?? "copy"})`)
    .join("; ");
  const subjectRegion = describeSubjectRegion(skeleton);
  const brief = [
    `Creative skeleton for a ${input.format} Australian real-estate ad.`,
    `Archetype: ${skeleton.archetype}.`,
    `Shot: ${skeleton.shot.type}; ${skeleton.shot.lighting}; mood ${skeleton.shot.mood}.`,
    `Composition: focal point ${skeleton.composition.focal_point}; horizon ${skeleton.composition.horizon}.`,
    `Reserve these copy-safe zones with simple low-detail texture: ${copySafeZoneSummary}.`,
    `Place the property or main subject toward ${subjectRegion}, away from the copy-safe zones.`,
    `Palette: ${skeleton.color.palette.join(", ")}; overlay ${skeleton.color.overlay}; contrast ${skeleton.color.contrast}.`,
    `Text system to support after compositing: ${skeleton.text_system.headline_zone}; badge ${skeleton.text_system.badge}; CTA ${skeleton.text_system.cta_style}.`,
    "Do NOT render text, logos, prices, badges, watermarks, or unsupported sale claims in the generated image.",
    input.fallbackBrief,
  ].join(" ");

  return {
    brief,
    maskSvgDataUrl: buildSkeletonMaskSvgDataUrl(skeleton, input.format),
    copySafeZoneSummary,
  };
}

export function buildSkeletonMaskSvgDataUrl(skeleton: CreativeSkeleton, format: AdStudioFormat): string {
  const canvas = CANVAS_BY_FORMAT[format];
  const rects = skeleton.composition.copy_safe_zones.map((zone) => {
    const x = Math.round(zone.x * canvas.width);
    const y = Math.round(zone.y * canvas.height);
    const width = Math.round(zone.width * canvas.width);
    const height = Math.round(zone.height * canvas.height);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><rect width="100%" height="100%" fill="black"/>${rects.join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function describeZone(zone: CreativeSkeleton["composition"]["copy_safe_zones"][number]): string {
  const horizontal = zone.x + zone.width / 2 < 0.4 ? "left" : zone.x + zone.width / 2 > 0.6 ? "right" : "centre";
  const vertical = zone.y + zone.height / 2 < 0.38 ? "upper" : zone.y + zone.height / 2 > 0.62 ? "lower" : "middle";
  return `${vertical}-${horizontal} ${Math.round(zone.width * 100)}% by ${Math.round(zone.height * 100)}%`;
}

function describeSubjectRegion(skeleton: CreativeSkeleton): string {
  const primary = skeleton.composition.copy_safe_zones.find((zone) => zone.priority === "primary")
    ?? skeleton.composition.copy_safe_zones[0];
  if (!primary) return "the opposite side of the copy area";
  const cx = primary.x + primary.width / 2;
  const cy = primary.y + primary.height / 2;
  if (cx < 0.4) return "the right side";
  if (cx > 0.6) return "the left side";
  if (cy < 0.4) return "the lower two-thirds";
  if (cy > 0.6) return "the upper two-thirds";
  return "the outer thirds";
}
