import { z } from "zod";

/**
 * Common zod primitives reused across research.* schemas.
 *
 * Keep these tight. Loosening a primitive here loosens every payload that
 * passes through ingestion.
 */

export const uuidSchema = z.string().uuid();
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected YYYY-MM-DD");
export const confidenceSchema = z.number().min(0).max(100);
export const hashSchema = z.string().min(8);
export const jsonbSchema: z.ZodType<JsonbValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonbSchema),
    z.record(jsonbSchema),
  ]),
);

export type JsonbValue = unknown;

export const australianStateSchema = z.enum(["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"]);
export const postcodeSchema = z.string().regex(/^\d{4}$/u, "Expected 4-digit postcode");

export const platformSchema = z.enum(["facebook", "instagram", "meta_ad_library"]);
export const adPlatformSchema = z.enum([
  "facebook",
  "instagram",
  "audience_network",
  "messenger",
  "unknown",
]);
export const activeStatusSchema = z.enum(["active", "inactive", "unknown"]);

/**
 * source_provider — the identifier of the system that produced a payload.
 * Whenever we add a new provider, add it here AND to the matching CHECK
 * constraint conversation in docs/research-engine/README.md.
 */
export const sourceProviderSchema = z.enum([
  "apify_leadsbrary",
  "apify_automly",
  "apify_curious_coder",
  "apify_harvestlab",
  "apify_happitap",
  "apify_scrapers",
  "scrapling_self",
  "browserbase",
  "metapi",
  "demirs_register",
  "reiwa",
  "domain",
  "rea",
  "google_business_profile",
  "meta_ad_library_ui",
  "operator_upload",
]);
export type SourceProvider = z.infer<typeof sourceProviderSchema>;

export const reviewStatusSchema = z.enum(["ready", "needs_review"]);
export const entityStatusSchema = z.enum([
  "licensed_verified",
  "market_seen_unverified",
  "licensed_unresolved",
  "inactive",
]);
