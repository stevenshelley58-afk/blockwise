import type { AdStudioGalleryTemplate } from "../templates.ts";
import metaFeed001 from "./meta-feed-001.json" with { type: "json" };

// Each template is a self-contained JSON, imported here and validated at load by
// validateGalleryTemplate. Diversity + provenance are enforced by
// scripts/verify/adstudio-templates.mjs. See hermes/skills/adstudio-template-builder.
export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaFeed001 as unknown as AdStudioGalleryTemplate,
];
