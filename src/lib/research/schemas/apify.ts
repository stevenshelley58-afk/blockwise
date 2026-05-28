import { z } from "zod";

/**
 * Apify Meta Ad Library actor response shapes.
 *
 * Apify actors are independently authored, so field names and shapes drift
 * between actors. We parse loosely with `.passthrough()` and `.optional()`
 * on everything we don't strictly need, then normalise inside the ingestion
 * worker into our internal ObservedAdIngestInput shape.
 *
 * This file represents the LOWEST COMMON DENOMINATOR fields across the
 * Apify actors we evaluated:
 *   - apify/facebook-ads-scraper (official Apify)
 *   - leadsbrary/meta-ads-library-scraper
 *   - automly/facebook-ad-library-scraper
 *   - curious_coder/facebook-ads-library-scraper
 *   - harvestlab/facebook-ads-library-scraper
 *
 * When we add a new actor, extend the union types below — don't loosen the
 * existing ones.
 */

const isoDateLike = z.union([z.string(), z.number()]).transform((v) => {
  if (typeof v === "number") {
    // Some actors emit unix seconds, others milliseconds. >1e12 -> ms.
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  return v;
});

export const apifyMetaAdSnippetCardSchema = z
  .object({
    body: z.string().optional(),
    title: z.string().optional(),
    caption: z.string().optional(),
    cta_type: z.string().optional(),
    cta_text: z.string().optional(),
    link_url: z.string().optional(),
    link_description: z.string().optional(),
    image_url: z.string().optional(),
    video_hd_url: z.string().optional(),
    video_sd_url: z.string().optional(),
    video_preview_image_url: z.string().optional(),
  })
  .passthrough();
export type ApifyMetaAdSnippetCard = z.infer<typeof apifyMetaAdSnippetCardSchema>;

export const apifyMetaAdSchema = z
  .object({
    // Stable Ad Library IDs (one of these will be present)
    ad_archive_id: z.union([z.string(), z.number()]).optional(),
    ad_id: z.union([z.string(), z.number()]).optional(),
    library_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),

    page_id: z.union([z.string(), z.number()]).optional(),
    page_name: z.string().optional(),
    page_profile_uri: z.string().optional(),
    page_profile_picture_url: z.string().optional(),

    is_active: z.boolean().optional(),
    status: z.string().optional(),

    start_date: isoDateLike.optional(),
    end_date: isoDateLike.optional(),
    started_at: isoDateLike.optional(),
    stopped_at: isoDateLike.optional(),
    creation_time: isoDateLike.optional(),

    publisher_platform: z.array(z.string()).optional(),
    platforms: z.array(z.string()).optional(),

    snapshot: apifyMetaAdSnippetCardSchema.optional(),
    cards: z.array(apifyMetaAdSnippetCardSchema).optional(),

    body: z.string().optional(),
    title: z.string().optional(),
    cta_text: z.string().optional(),
    cta_type: z.string().optional(),
    link_url: z.string().optional(),
    image_url: z.string().optional(),
    video_hd_url: z.string().optional(),
    video_sd_url: z.string().optional(),

    targeted_or_reached_countries: z.array(z.string()).optional(),
    impressions: z
      .object({
        lower_bound: z.number().optional(),
        upper_bound: z.number().optional(),
      })
      .partial()
      .optional(),
    spend: z
      .object({
        lower_bound: z.number().optional(),
        upper_bound: z.number().optional(),
        currency: z.string().optional(),
      })
      .partial()
      .optional(),

    languages: z.array(z.string()).optional(),
    locales: z.array(z.string()).optional(),
  })
  .passthrough();
export type ApifyMetaAd = z.infer<typeof apifyMetaAdSchema>;

export const apifyMetaAdsDatasetSchema = z.array(apifyMetaAdSchema);

/**
 * Extract a single stable external_ad_id from whichever id field the actor
 * provided. Throws if none are present — ingestion must skip and log such rows.
 */
export function extractExternalAdId(ad: ApifyMetaAd): string {
  const candidate =
    ad.ad_archive_id ?? ad.ad_id ?? ad.library_id ?? ad.id;
  if (candidate === undefined || candidate === null || candidate === "") {
    throw new Error("Apify ad payload is missing every known external_ad_id field");
  }
  return String(candidate);
}

/**
 * Best-effort active status derivation.
 */
export function deriveActiveStatus(ad: ApifyMetaAd): "active" | "inactive" | "unknown" {
  if (typeof ad.is_active === "boolean") {
    return ad.is_active ? "active" : "inactive";
  }
  const status = ad.status?.toLowerCase();
  if (status === "active") return "active";
  if (status === "inactive" || status === "stopped" || status === "ended") return "inactive";
  return "unknown";
}
