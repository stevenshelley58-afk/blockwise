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
  type: z
    .enum([
      "listing",
      "brand",
      "just_sold",
      "open_home",
      "recruitment",
      "lead_magnet",
      "appraisal",
      "other",
      "unknown",
    ])
    .default("unknown"),
  hooks: z.array(z.string()).default([]),
  tone: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  targetSignal: z
    .object({
      suburb: z.string().nullable().optional(),
      postcode: postcodeSchema.nullable().optional(),
      priceBand: z.string().nullable().optional(),
      audience: z.string().nullable().optional(),
    })
    .partial()
    .default({}),
  confidence: confidenceSchema.default(0),
});
export type AdClassification = z.infer<typeof adClassificationSchema>;

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
  videoUrl: z.string().url().nullable().optional(),
  videoThumbnailUrl: z.string().url().nullable().optional(),
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
