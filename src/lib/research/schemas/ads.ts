import { z } from "zod";

import {
  activeStatusSchema,
  adPlatformSchema,
  australianStateSchema,
  confidenceSchema,
  hashSchema,
  isoDateSchema,
  isoTimestampSchema,
  jsonbSchema,
  postcodeSchema,
  sourceProviderSchema,
  uuidSchema,
} from "./common.ts";

/**
 * research.observed_ads — canonical record of an ad we've seen.
 *
 * Unique on (advertiser_page_id, external_ad_id). The raw_payload is the
 * provider's payload after normalisation; payload_hash lets us short-circuit
 * "no change" observations.
 */
export const observedAdSchema = z.object({
  id: uuidSchema,
  externalAdId: z.string().min(1),
  advertiserPageId: uuidSchema,
  firstSeenProvider: sourceProviderSchema,
  platform: adPlatformSchema.default("unknown"),
  activeStatus: activeStatusSchema.default("unknown"),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
  lastCheckedAt: isoTimestampSchema,
  missingSuccessiveChecks: z.number().int().min(0).default(0),
  metaPublisherPlatforms: z.array(z.string()).default([]),
  adDeliveryStartedAt: isoTimestampSchema.nullable().optional(),
  adDeliveryStoppedAt: isoTimestampSchema.nullable().optional(),
  adCreationDate: isoDateSchema.nullable().optional(),
  rawPayload: jsonbSchema.default({}),
  payloadHash: hashSchema,
  metadata: jsonbSchema.default({}),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type ObservedAd = z.infer<typeof observedAdSchema>;

/**
 * Input shape used by the ingestion worker BEFORE we know the row id.
 * advertiser_page_id is required.
 */
export const observedAdIngestInputSchema = z.object({
  externalAdId: z.string().min(1),
  advertiserPageId: uuidSchema,
  observedByProvider: sourceProviderSchema,
  platform: adPlatformSchema.default("unknown"),
  activeStatus: activeStatusSchema.default("active"),
  metaPublisherPlatforms: z.array(z.string()).default([]),
  adDeliveryStartedAt: isoTimestampSchema.nullable().optional(),
  adDeliveryStoppedAt: isoTimestampSchema.nullable().optional(),
  adCreationDate: isoDateSchema.nullable().optional(),
  rawPayload: jsonbSchema,
  metadata: jsonbSchema.default({}),
});
export type ObservedAdIngestInput = z.infer<typeof observedAdIngestInputSchema>;

/**
 * research.ad_snapshots — append-only history of an observed_ad's payload
 * over time. Unique on (observed_ad_id, payload_hash).
 */
export const adSnapshotSchema = z.object({
  id: uuidSchema,
  observedAdId: uuidSchema,
  adFetchRunId: uuidSchema,
  sourceProvider: sourceProviderSchema,
  payload: jsonbSchema,
  payloadHash: hashSchema,
  changesFromPrior: jsonbSchema.default({}),
  snapshotAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
});
export type AdSnapshot = z.infer<typeof adSnapshotSchema>;

/**
 * research.ad_creatives — extracted creative content tied to an observation
 * (and the specific snapshot it came from).
 */
export const adFormatSchema = z.enum(["image", "video", "carousel", "dco", "unknown"]);
export type AdFormat = z.infer<typeof adFormatSchema>;

export const adClassificationSchema = z.object({
  isRealEstateAd: z.boolean().default(false),
  realEstateRelevance: z
    .enum([
      "agent_brand",
      "appraisal",
      "listing",
      "sold",
      "rental",
      "recruitment",
      "irrelevant",
    ])
    .default("irrelevant"),
  adType: z
    .enum([
      "appraisal",
      "just_listed",
      "just_sold",
      "agent_brand",
      "market_update",
      "suburb_report",
      "recruitment",
      "rental",
      "other",
    ])
    .default("other"),
  primaryIntent: z
    .enum([
      "generate_appraisals",
      "win_listings",
      "promote_listing",
      "build_agent_brand",
      "recruit_staff",
      "lease_property",
      "other",
    ])
    .default("other"),
  propertyOrAgentFocus: z.enum(["property", "agent", "agency", "suburb", "unknown"]).default("unknown"),
  hooks: z.array(z.string()).default([]),
  tone: z.string().default(""),
  style: z.string().default(""),
  audience: z.string().default(""),
  suburbSignals: z.array(z.string()).default([]),
  confidence: confidenceSchema.default(0),
  rejectionReason: z.string().nullable().default(null),
}).strict();
export type AdClassification = z.infer<typeof adClassificationSchema>;

export const mediaAssetSchema = z.object({
  id: z.string().nullable().optional(),
  kind: z.enum(["image", "video", "thumbnail", "carousel_card", "document", "unknown"]).default("unknown"),
  sourceUrl: z.string().url().nullable().optional(),
  storageBucket: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  sha256: z.string().nullable().optional(),
  downloadStatus: z.enum(["pending", "captured", "failed", "blocked", "missing"]).default("pending"),
  failureReason: z.string().nullable().optional(),
  capturedAt: isoTimestampSchema.nullable().optional(),
}).strict();
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const adCreativeSchema = z.object({
  id: uuidSchema,
  observedAdId: uuidSchema,
  adSnapshotId: uuidSchema.nullable().optional(),
  format: adFormatSchema.default("unknown"),
  headline: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  cta: z.string().nullable().optional(),
  ctaUrl: z.string().url().nullable().optional(),
  primaryImageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).default([]),
  imageStoragePath: z.string().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
  videoStoragePath: z.string().nullable().optional(),
  videoThumbnailUrl: z.string().url().nullable().optional(),
  mediaAssets: z.array(mediaAssetSchema).default([]),
  landingUrl: z.string().url().nullable().optional(),
  locale: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  creativeHash: hashSchema,
  classification: adClassificationSchema.optional(),
  classifiedAt: isoTimestampSchema.nullable().optional(),
  classifiedByDecisionId: uuidSchema.nullable().optional(),
  metadata: jsonbSchema.default({}),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type AdCreative = z.infer<typeof adCreativeSchema>;

/**
 * research.ad_area_matches — which postcodes/suburbs an ad targets or is
 * relevant to. Multiple matches per ad are expected (one per area).
 */
export const adAreaMatchTypeSchema = z.enum([
  "meta_targeting",
  "copy_mention",
  "agent_service_area",
  "agency_service_area",
  "landing_url",
  "manual",
]);
export type AdAreaMatchType = z.infer<typeof adAreaMatchTypeSchema>;

export const adAreaMatchSchema = z.object({
  id: uuidSchema,
  observedAdId: uuidSchema,
  postcode: postcodeSchema,
  suburb: z.string().min(1),
  state: australianStateSchema.default("WA"),
  matchType: adAreaMatchTypeSchema,
  confidence: confidenceSchema.default(0),
  evidence: jsonbSchema.default({}),
  createdAt: isoTimestampSchema,
});
export type AdAreaMatch = z.infer<typeof adAreaMatchSchema>;
