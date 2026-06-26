import { ADSTUDIO_TEMPLATE_RESET_MESSAGE, type AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit } from "./types.ts";

function resetPreviewError(template: AdStudioTemplate): Error {
  return new Error(`${ADSTUDIO_TEMPLATE_RESET_MESSAGE} Template preview unavailable for ${template.id}.`);
}

export function templatePreviewSvg(template: AdStudioTemplate, _brandKit: AdStudioBrandKit): string {
  throw resetPreviewError(template);
}

export function templatePreviewDataUrl(template: AdStudioTemplate, _brandKit: AdStudioBrandKit): string {
  throw resetPreviewError(template);
}
