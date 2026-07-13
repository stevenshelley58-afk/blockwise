// The AdStudio template gallery. Every entry mirrors a REAL source ad
// (sourceAd provenance) and carries its ad-radar classification — see
// hermes/skills/adstudio-template-builder/SKILL.md, which is law here.
//
// 2026-07-02: the previous 26 hand-made recreations were DELETED (not
// archived) on Steven's instruction — they had regressed into a look-alike
// mould. The gallery now grows one source ad at a time, with each template's
// composition built directly from that source. Their public sample assets stay
// in /adstudio-samples for gallery and campaign rendering.
import metaFeed020 from "./meta-feed-020.json" with { type: "json" };
import metaFeed021 from "./meta-feed-021.json" with { type: "json" };
import metaFeed022 from "./meta-feed-022.json" with { type: "json" };
import metaFeed023 from "./meta-feed-023.json" with { type: "json" };
import metaFeed024 from "./meta-feed-024.json" with { type: "json" };
import metaFeed025 from "./meta-feed-025.json" with { type: "json" };
import metaFeed026 from "./meta-feed-026.json" with { type: "json" };
import metaFeed027 from "./meta-feed-027.json" with { type: "json" };
import metaFeed028 from "./meta-feed-028.json" with { type: "json" };
import metaFeed029 from "./meta-feed-029.json" with { type: "json" };
import metaFeed030 from "./meta-feed-030.json" with { type: "json" };
import metaFeed031 from "./meta-feed-031.json" with { type: "json" };
import metaFeed032 from "./meta-feed-032.json" with { type: "json" };
import metaFeed033 from "./meta-feed-033.json" with { type: "json" };
import metaFeed034 from "./meta-feed-034.json" with { type: "json" };
import metaFeed035 from "./meta-feed-035.json" with { type: "json" };
import metaFeed036 from "./meta-feed-036.json" with { type: "json" };
import metaFeed037 from "./meta-feed-037.json" with { type: "json" };
import metaFeed038 from "./meta-feed-038.json" with { type: "json" };
import metaFeed039 from "./meta-feed-039.json" with { type: "json" };
import metaFeed040 from "./meta-feed-040.json" with { type: "json" };
import metaFeed041 from "./meta-feed-041.json" with { type: "json" };
import metaFeed042 from "./meta-feed-042.json" with { type: "json" };
import metaFeed043 from "./meta-feed-043.json" with { type: "json" };
import metaFeed044 from "./meta-feed-044.json" with { type: "json" };
import metaFeed045 from "./meta-feed-045.json" with { type: "json" };
import metaFullscreen008 from "./meta-fullscreen-008.json" with { type: "json" };
import metaFullscreen009 from "./meta-fullscreen-009.json" with { type: "json" };
import metaFullscreen010 from "./meta-fullscreen-010.json" with { type: "json" };
import metaFullscreen011 from "./meta-fullscreen-011.json" with { type: "json" };
import metaFullscreen012 from "./meta-fullscreen-012.json" with { type: "json" };
import metaFullscreen013 from "./meta-fullscreen-013.json" with { type: "json" };
import metaFullscreen014 from "./meta-fullscreen-014.json" with { type: "json" };
import metaFullscreen015 from "./meta-fullscreen-015.json" with { type: "json" };
import metaFullscreen016 from "./meta-fullscreen-016.json" with { type: "json" };
import metaFullscreen017 from "./meta-fullscreen-017.json" with { type: "json" };
import metaFullscreen018 from "./meta-fullscreen-018.json" with { type: "json" };
import metaFullscreen019 from "./meta-fullscreen-019.json" with { type: "json" };
import metaFullscreen020 from "./meta-fullscreen-020.json" with { type: "json" };
import metaFullscreen021 from "./meta-fullscreen-021.json" with { type: "json" };
import metaFullscreen022 from "./meta-fullscreen-022.json" with { type: "json" };
import metaFullscreen023 from "./meta-fullscreen-023.json" with { type: "json" };
import metaFullscreen024 from "./meta-fullscreen-024.json" with { type: "json" };
import metaFullscreen025 from "./meta-fullscreen-025.json" with { type: "json" };
import metaFullscreen026 from "./meta-fullscreen-026.json" with { type: "json" };
import metaFullscreen027 from "./meta-fullscreen-027.json" with { type: "json" };
import metaFullscreen028 from "./meta-fullscreen-028.json" with { type: "json" };
import metaFullscreen029 from "./meta-fullscreen-029.json" with { type: "json" };
import metaFullscreen030 from "./meta-fullscreen-030.json" with { type: "json" };
import metaFullscreen031 from "./meta-fullscreen-031.json" with { type: "json" };
import metaFullscreen032 from "./meta-fullscreen-032.json" with { type: "json" };

import type { AdStudioGalleryTemplate } from "../templates.ts";

// Each template is a self-contained JSON, imported here and validated at load
// by validateGalleryTemplate (via AD_STUDIO_TEMPLATES in ../templates.ts).
// Diversity + provenance are enforced by scripts/verify/adstudio-templates.mjs.
export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaFeed020 as unknown as AdStudioGalleryTemplate,
  metaFeed021 as unknown as AdStudioGalleryTemplate,
  metaFeed022 as unknown as AdStudioGalleryTemplate,
  metaFeed023 as unknown as AdStudioGalleryTemplate,
  metaFeed024 as unknown as AdStudioGalleryTemplate,
  metaFeed025 as unknown as AdStudioGalleryTemplate,
  metaFeed026 as unknown as AdStudioGalleryTemplate,
  metaFeed027 as unknown as AdStudioGalleryTemplate,
  metaFeed028 as unknown as AdStudioGalleryTemplate,
  metaFeed029 as unknown as AdStudioGalleryTemplate,
  metaFeed030 as unknown as AdStudioGalleryTemplate,
  metaFeed031 as unknown as AdStudioGalleryTemplate,
  metaFeed032 as unknown as AdStudioGalleryTemplate,
  metaFeed033 as unknown as AdStudioGalleryTemplate,
  metaFeed034 as unknown as AdStudioGalleryTemplate,
  metaFeed035 as unknown as AdStudioGalleryTemplate,
  metaFeed036 as unknown as AdStudioGalleryTemplate,
  metaFeed037 as unknown as AdStudioGalleryTemplate,
  metaFeed038 as unknown as AdStudioGalleryTemplate,
  metaFeed039 as unknown as AdStudioGalleryTemplate,
  metaFeed040 as unknown as AdStudioGalleryTemplate,
  metaFeed041 as unknown as AdStudioGalleryTemplate,
  metaFeed042 as unknown as AdStudioGalleryTemplate,
  metaFeed043 as unknown as AdStudioGalleryTemplate,
  metaFeed044 as unknown as AdStudioGalleryTemplate,
  metaFeed045 as unknown as AdStudioGalleryTemplate,
  metaFullscreen008 as unknown as AdStudioGalleryTemplate,
  metaFullscreen009 as unknown as AdStudioGalleryTemplate,
  metaFullscreen010 as unknown as AdStudioGalleryTemplate,
  metaFullscreen011 as unknown as AdStudioGalleryTemplate,
  metaFullscreen012 as unknown as AdStudioGalleryTemplate,
  metaFullscreen013 as unknown as AdStudioGalleryTemplate,
  metaFullscreen014 as unknown as AdStudioGalleryTemplate,
  metaFullscreen015 as unknown as AdStudioGalleryTemplate,
  metaFullscreen016 as unknown as AdStudioGalleryTemplate,
  metaFullscreen017 as unknown as AdStudioGalleryTemplate,
  metaFullscreen018 as unknown as AdStudioGalleryTemplate,
  metaFullscreen019 as unknown as AdStudioGalleryTemplate,
  metaFullscreen020 as unknown as AdStudioGalleryTemplate,
  metaFullscreen021 as unknown as AdStudioGalleryTemplate,
  metaFullscreen022 as unknown as AdStudioGalleryTemplate,
  metaFullscreen023 as unknown as AdStudioGalleryTemplate,
  metaFullscreen024 as unknown as AdStudioGalleryTemplate,
  metaFullscreen025 as unknown as AdStudioGalleryTemplate,
  metaFullscreen026 as unknown as AdStudioGalleryTemplate,
  metaFullscreen027 as unknown as AdStudioGalleryTemplate,
  metaFullscreen028 as unknown as AdStudioGalleryTemplate,
  metaFullscreen029 as unknown as AdStudioGalleryTemplate,
  metaFullscreen030 as unknown as AdStudioGalleryTemplate,
  metaFullscreen031 as unknown as AdStudioGalleryTemplate,
  metaFullscreen032 as unknown as AdStudioGalleryTemplate,
];
