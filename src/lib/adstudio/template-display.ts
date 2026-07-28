import type { AdStudioTemplate } from "./templates.ts";

const BASE = "/adstudio-thumbnails/meta";

export function templateDisplaySrc(template: AdStudioTemplate, profile: "320" | "640" | "preview"): string {
  return `${BASE}/${template.sample.contentHash}-${profile}.webp`;
}

export function templateThumbnailSrcSet(template: AdStudioTemplate): string {
  return `${templateDisplaySrc(template, "320")} 320w, ${templateDisplaySrc(template, "640")} 640w`;
}
