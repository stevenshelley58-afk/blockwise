import { ADSTUDIO_TEMPLATE_RESET_MESSAGE, type AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

function resetPreviewError(template: AdStudioTemplate): Error {
  return new Error(`${ADSTUDIO_TEMPLATE_RESET_MESSAGE} Template preview unavailable for ${template.id}.`);
}

export function templatePreviewSvg(template: AdStudioTemplate, _brandKit: AdStudioBrandKit): string {
  if (!template.gallery?.sampleImageSrc || !template.dimensions) throw resetPreviewError(template);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${template.dimensions.width} ${template.dimensions.height}" width="${template.dimensions.width}" height="${template.dimensions.height}"><image href="${escapeSvg(template.gallery.sampleImageSrc)}" x="0" y="0" width="${template.dimensions.width}" height="${template.dimensions.height}" preserveAspectRatio="xMidYMid slice"/></svg>`;
}

export function templatePreviewDataUrl(template: AdStudioTemplate, _brandKit: AdStudioBrandKit): string {
  if (!template.gallery?.thumbnailSrc) throw resetPreviewError(template);
  return template.gallery.thumbnailSrc;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
