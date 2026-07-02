// The AdStudio template gallery. Every entry mirrors a REAL source ad
// (sourceAd provenance) and carries its ad-radar classification — see
// hermes/skills/adstudio-template-builder/SKILL.md, which is law here.
//
// 2026-07-02: the previous 26 hand-made recreations were DELETED (not
// archived) on Steven's instruction — they had regressed into a look-alike
// mould. The gallery now grows one eye-approved template at a time, each
// cloned from its original source-ad image (never a recreation). Their public
// sample assets stay in /adstudio-samples for legacy campaign rendering.
import metaFeed020 from "./meta-feed-020.json" with { type: "json" };

import type { AdStudioGalleryTemplate } from "../templates.ts";

// Each template is a self-contained JSON, imported here and validated at load
// by validateGalleryTemplate (via AD_STUDIO_TEMPLATES in ../templates.ts).
// Diversity + provenance are enforced by scripts/verify/adstudio-templates.mjs.
export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaFeed020 as unknown as AdStudioGalleryTemplate,
];
