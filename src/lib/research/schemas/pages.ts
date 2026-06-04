import { z } from "zod";

import {
  confidenceSchema,
  isoTimestampSchema,
  jsonbSchema,
  platformSchema,
  uuidSchema,
} from "./common.ts";

/**
 * research.advertiser_pages — Meta/Instagram pages tied to agents/agencies.
 *
 * page_id is the platform's stable identifier (Facebook Page ID, IG account ID).
 * (platform, page_id) is unique in the DB.
 */
export const advertiserPageStatusSchema = z.enum([
  "resolved",
  "unresolved",
  "duplicate",
  "needs_review",
  "inactive",
]);
export type AdvertiserPageStatus = z.infer<typeof advertiserPageStatusSchema>;

export const advertiserPageSchema = z.object({
  id: uuidSchema,
  platform: platformSchema,
  pageId: z.string().min(1),
  pageName: z.string().min(1),
  pageUrl: z.string().url().nullable().optional(),
  agentId: uuidSchema.nullable().optional(),
  agencyId: uuidSchema.nullable().optional(),
  status: advertiserPageStatusSchema.default("unresolved"),
  confidence: confidenceSchema.default(0),
  resolutionDecisionId: uuidSchema.nullable().optional(),
  lastCheckedAt: isoTimestampSchema.nullable().optional(),
  lastSuccessfulCheckAt: isoTimestampSchema.nullable().optional(),
  consecutiveFailedChecks: z.number().int().min(0).default(0),
  metadata: jsonbSchema.default({}),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type AdvertiserPage = z.infer<typeof advertiserPageSchema>;

export const advertiserPageInputSchema = advertiserPageSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    firstSeenAt: true,
    lastSeenAt: true,
    lastCheckedAt: true,
    lastSuccessfulCheckAt: true,
    consecutiveFailedChecks: true,
    resolutionDecisionId: true,
  })
  .extend({
    id: uuidSchema.optional(),
  });
export type AdvertiserPageInput = z.infer<typeof advertiserPageInputSchema>;
