import { z } from "zod";

/**
 * Apify Meta Ad Library actor response shapes.
 *
 * Supports both the canonical camelCase shape (apify/facebook-ads-scraper)
 * and the snake_case shape used by community actors (leadsbrary, automly).
 *
 * Real sample fixture: tests/research-engine/fixtures-apify-real.json
 *
 * Rule: every field that could be null in the wild is .nullable().optional().
 * Anything we do not list passes through via .passthrough().
 */

const nstr = () => z.string().nullable().optional();
const nnum = () => z.number().nullable().optional();
const nbool = () => z.boolean().nullable().optional();
const nstrnum = () => z.union([z.string(), z.number()]).nullable().optional();


/** snapshot.body can be a string OR { text: string } OR null */
const snapshotBodyLike = z
  .union([
    z.string(),
    z.object({ text: nstr(), markup: z.unknown().nullable().optional() }).passthrough(),
    z.null(),
  ])
  .nullable()
  .optional();

export const apifySnapshotCardSchema = z
  .object({
    body: nstr(),
    title: nstr(),
    caption: nstr(),
    ctaType: nstr(),
    ctaText: nstr(),
    cta_type: nstr(),
    cta_text: nstr(),
    linkUrl: nstr(),
    link_url: nstr(),
    linkDescription: nstr(),
    link_description: nstr(),
    imageUrl: nstr(),
    image_url: nstr(),
    videoHdUrl: nstr(),
    videoSdUrl: nstr(),
    video_hd_url: nstr(),
    video_sd_url: nstr(),
    videoPreviewImageUrl: nstr(),
    video_preview_image_url: nstr(),
  })
  .passthrough();
export type ApifySnapshotCard = z.infer<typeof apifySnapshotCardSchema>;

const snapshotImageSchema = z
  .object({
    originalImageUrl: nstr(),
    resizedImageUrl: nstr(),
    watermarkedResizedImageUrl: nstr(),
  })
  .passthrough();

const snapshotVideoSchema = z
  .object({
    videoHdUrl: nstr(),
    videoSdUrl: nstr(),
    videoPreviewImageUrl: nstr(),
    watermarkedVideoHdUrl: nstr(),
  })
  .passthrough();

export const apifySnapshotSchema = z
  .object({
    title: nstr(),
    body: snapshotBodyLike,
    caption: nstr(),
    cards: z.array(apifySnapshotCardSchema).nullable().optional(),
    images: z.array(snapshotImageSchema).nullable().optional(),
    videos: z.array(snapshotVideoSchema).nullable().optional(),
    ctaType: nstr(),
    ctaText: nstr(),
    cta_type: nstr(),
    cta_text: nstr(),
    linkUrl: nstr(),
    link_url: nstr(),
    linkDescription: nstr(),
    displayFormat: nstr(),
    pageName: nstr(),
    page_name: nstr(),
    pageId: nstrnum(),
    page_id: nstrnum(),
    pageProfileUri: nstr(),
    page_profile_uri: nstr(),
    pageProfilePictureUrl: nstr(),
    page_profile_picture_url: nstr(),
    pageLikeCount: nnum(),
    pageCategories: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
export type ApifySnapshot = z.infer<typeof apifySnapshotSchema>;

export const apifyMetaAdSchema = z
  .object({
    adArchiveID: nstrnum(),
    adArchiveId: nstrnum(),
    ad_archive_id: nstrnum(),
    ad_id: nstrnum(),
    adId: nstrnum(),
    library_id: nstrnum(),
    id: nstrnum(),

    pageID: nstrnum(),
    pageId: nstrnum(),
    page_id: nstrnum(),
    pageName: nstr(),
    page_name: nstr(),
    pageProfileUri: nstr(),
    page_profile_uri: nstr(),

    isActive: nbool(),
    is_active: nbool(),
    status: nstr(),

    startDate: nstrnum(),
    start_date: nstrnum(),
    started_at: nstrnum(),
    endDate: nstrnum(),
    end_date: nstrnum(),
    stopped_at: nstrnum(),
    startDateFormatted: nstr(),
    endDateFormatted: nstr(),
    creation_time: nstrnum(),

    publisherPlatform: z.array(z.string()).nullable().optional(),
    publisher_platform: z.array(z.string()).nullable().optional(),
    platforms: z.array(z.string()).nullable().optional(),

    snapshot: apifySnapshotSchema.nullable().optional(),
    cards: z.array(apifySnapshotCardSchema).nullable().optional(),

    body: nstr(),
    title: nstr(),
    cta_text: nstr(),
    cta_type: nstr(),
    link_url: nstr(),
    image_url: nstr(),
    video_hd_url: nstr(),
    video_sd_url: nstr(),

    inputUrl: nstr(),
    collationId: nstr(),
    collationCount: nnum(),
    categories: z.array(z.string()).nullable().optional(),
    targetedOrReachedCountries: z.array(z.string()).nullable().optional(),
    targeted_or_reached_countries: z.array(z.string()).nullable().optional(),

    impressionsWithIndex: z.unknown().nullable().optional(),
    impressions: z.unknown().nullable().optional(),
    spend: z.unknown().nullable().optional(),

    languages: z.array(z.string()).nullable().optional(),
    locales: z.array(z.string()).nullable().optional(),

    ad_details: z.record(z.unknown()).nullable().optional(),
    pageInfo: z.record(z.unknown()).nullable().optional(),
    page_info: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();
export type ApifyMetaAd = z.infer<typeof apifyMetaAdSchema>;

export const apifyMetaAdsDatasetSchema = z.array(apifyMetaAdSchema);

export function extractExternalAdId(ad: ApifyMetaAd): string {
  const candidate =
    ad.adArchiveID ??
    ad.adArchiveId ??
    ad.ad_archive_id ??
    ad.ad_id ??
    ad.adId ??
    ad.library_id ??
    ad.id;
  if (candidate === undefined || candidate === null || candidate === "") {
    throw new Error("Apify ad payload is missing every known external_ad_id field");
  }
  return String(candidate);
}

export function extractPageId(ad: ApifyMetaAd): string | null {
  const candidate =
    ad.pageID ?? ad.pageId ?? ad.page_id ?? ad.snapshot?.pageId ?? ad.snapshot?.page_id;
  if (candidate === undefined || candidate === null || candidate === "") return null;
  return String(candidate);
}

export function extractPageName(ad: ApifyMetaAd): string | null {
  return ad.pageName ?? ad.page_name ?? ad.snapshot?.pageName ?? ad.snapshot?.page_name ?? null;
}

export function deriveActiveStatus(ad: ApifyMetaAd): "active" | "inactive" | "unknown" {
  if (typeof ad.isActive === "boolean") return ad.isActive ? "active" : "inactive";
  if (typeof ad.is_active === "boolean") return ad.is_active ? "active" : "inactive";
  const status = ad.status?.toLowerCase();
  if (status === "active") return "active";
  if (status === "inactive" || status === "stopped" || status === "ended") return "inactive";
  return "unknown";
}
