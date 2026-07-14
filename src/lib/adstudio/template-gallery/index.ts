// Gallery entries are safe samples made through the same reference-clone path
// customers use. Private source ads are provenance only and are never rendered
// in the gallery or sent to customer generations.
import metaFeed020 from "./meta-feed-020.json" with { type: "json" };

import type { AdStudioGalleryTemplate } from "../templates.ts";

export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaFeed020 as AdStudioGalleryTemplate,
];
