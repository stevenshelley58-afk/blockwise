import type { AdStudioGalleryTemplate } from "../templates.ts";
import metaFeed001 from "./meta-feed-001.json" with { type: "json" };
import metaFeed002 from "./meta-feed-002.json" with { type: "json" };
import metaFeed003 from "./meta-feed-003.json" with { type: "json" };
import metaFeed004 from "./meta-feed-004.json" with { type: "json" };
import metaFeed005 from "./meta-feed-005.json" with { type: "json" };
import metaFeed006 from "./meta-feed-006.json" with { type: "json" };
import metaFeed007 from "./meta-feed-007.json" with { type: "json" };
import metaFeed008 from "./meta-feed-008.json" with { type: "json" };
import metaFeed009 from "./meta-feed-009.json" with { type: "json" };
import metaFeed010 from "./meta-feed-010.json" with { type: "json" };
import metaFeed011 from "./meta-feed-011.json" with { type: "json" };
import metaFeed012 from "./meta-feed-012.json" with { type: "json" };
import metaFeed013 from "./meta-feed-013.json" with { type: "json" };
import metaFeed014 from "./meta-feed-014.json" with { type: "json" };
import metaFeed015 from "./meta-feed-015.json" with { type: "json" };
import metaFeed016 from "./meta-feed-016.json" with { type: "json" };
import metaFeed017 from "./meta-feed-017.json" with { type: "json" };
import metaFeed018 from "./meta-feed-018.json" with { type: "json" };
import metaFeed019 from "./meta-feed-019.json" with { type: "json" };
import metaFullscreen001 from "./meta-fullscreen-001.json" with { type: "json" };
import metaFullscreen002 from "./meta-fullscreen-002.json" with { type: "json" };
import metaFullscreen003 from "./meta-fullscreen-003.json" with { type: "json" };
import metaFullscreen004 from "./meta-fullscreen-004.json" with { type: "json" };
import metaFullscreen005 from "./meta-fullscreen-005.json" with { type: "json" };
import metaFullscreen006 from "./meta-fullscreen-006.json" with { type: "json" };
import metaFullscreen007 from "./meta-fullscreen-007.json" with { type: "json" };

// Each template is a self-contained JSON, imported here and validated at load by
// validateGalleryTemplate. Diversity + provenance are enforced by
// scripts/verify/adstudio-templates.mjs. See hermes/skills/adstudio-template-builder.
export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaFeed001 as unknown as AdStudioGalleryTemplate,
  metaFeed002 as unknown as AdStudioGalleryTemplate,
  metaFeed003 as unknown as AdStudioGalleryTemplate,
  metaFeed004 as unknown as AdStudioGalleryTemplate,
  metaFeed005 as unknown as AdStudioGalleryTemplate,
  metaFeed006 as unknown as AdStudioGalleryTemplate,
  metaFeed007 as unknown as AdStudioGalleryTemplate,
  metaFeed008 as unknown as AdStudioGalleryTemplate,
  metaFeed009 as unknown as AdStudioGalleryTemplate,
  metaFeed010 as unknown as AdStudioGalleryTemplate,
  metaFeed011 as unknown as AdStudioGalleryTemplate,
  metaFeed012 as unknown as AdStudioGalleryTemplate,
  metaFeed013 as unknown as AdStudioGalleryTemplate,
  metaFeed014 as unknown as AdStudioGalleryTemplate,
  metaFeed015 as unknown as AdStudioGalleryTemplate,
  metaFeed016 as unknown as AdStudioGalleryTemplate,
  metaFeed017 as unknown as AdStudioGalleryTemplate,
  metaFeed018 as unknown as AdStudioGalleryTemplate,
  metaFeed019 as unknown as AdStudioGalleryTemplate,
  metaFullscreen001 as unknown as AdStudioGalleryTemplate,
  metaFullscreen002 as unknown as AdStudioGalleryTemplate,
  metaFullscreen003 as unknown as AdStudioGalleryTemplate,
  metaFullscreen004 as unknown as AdStudioGalleryTemplate,
  metaFullscreen005 as unknown as AdStudioGalleryTemplate,
  metaFullscreen006 as unknown as AdStudioGalleryTemplate,
  metaFullscreen007 as unknown as AdStudioGalleryTemplate,
];
