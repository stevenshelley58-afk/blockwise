// Gallery entries are safe samples made through the same reference-clone path
// customers use. Private source ads are provenance only and are never rendered
// in the gallery or sent to customer generations.
import metaFeed018 from "./meta-feed-018.json" with { type: "json" };
import metaFeed020 from "./meta-feed-020.json" with { type: "json" };
import metaFeed162 from "./meta-feed-162.json" with { type: "json" };
import metaFeed128 from "./meta-feed-128.json" with { type: "json" };
import metaFeed160 from "./meta-feed-160.json" with { type: "json" };
import metaFeed156 from "./meta-feed-156.json" with { type: "json" };
import metaFeed161 from "./meta-feed-161.json" with { type: "json" };
import metaFeed165 from "./meta-feed-165.json" with { type: "json" };
import metaFeed179 from "./meta-feed-179.json" with { type: "json" };
import metaFeed163 from "./meta-feed-163.json" with { type: "json" };
import metaFeed197 from "./meta-feed-197.json" with { type: "json" };

import type { AdStudioGalleryTemplate } from "../templates.ts";

export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaFeed018 as AdStudioGalleryTemplate,
  metaFeed020 as AdStudioGalleryTemplate,
  metaFeed162 as AdStudioGalleryTemplate,
  metaFeed128 as AdStudioGalleryTemplate,
  metaFeed160 as AdStudioGalleryTemplate,
  metaFeed156 as AdStudioGalleryTemplate,
  metaFeed161 as AdStudioGalleryTemplate,
  metaFeed165 as AdStudioGalleryTemplate,
  metaFeed179 as AdStudioGalleryTemplate,
  metaFeed163 as AdStudioGalleryTemplate,
  metaFeed197 as AdStudioGalleryTemplate,
];
