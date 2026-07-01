import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

// A missing gallery asset must degrade to a neutral card, never crash the picker.
const PLACEHOLDER_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350" width="1080" height="1350"><rect width="1080" height="1350" fill="#eef1f6"/><text x="540" y="675" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#94a3b8">Preview unavailable</text></svg>`;

function placeholderDataUrl(): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(PLACEHOLDER_PREVIEW_SVG)}`;
}

export function templatePreviewSvg(template: AdStudioTemplate, _brandKit: AdStudioBrandKit): string {
  if (!template.gallery?.sampleImageSrc || !template.dimensions) return PLACEHOLDER_PREVIEW_SVG;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${template.dimensions.width} ${template.dimensions.height}" width="${template.dimensions.width}" height="${template.dimensions.height}"><image href="${escapeSvg(template.gallery.sampleImageSrc)}" x="0" y="0" width="${template.dimensions.width}" height="${template.dimensions.height}" preserveAspectRatio="xMidYMid slice"/></svg>`;
}

export function templatePreviewDataUrl(template: AdStudioTemplate, _brandKit: AdStudioBrandKit): string {
  if (!template.gallery?.thumbnailSrc) return placeholderDataUrl();
  return template.gallery.thumbnailSrc;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
