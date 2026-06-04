import { z } from "zod";

import {
  australianStateSchema,
  confidenceSchema,
  entityStatusSchema,
  isoTimestampSchema,
  jsonbSchema,
  postcodeSchema,
  reviewStatusSchema,
  uuidSchema,
} from "./common.ts";

/**
 * research.agencies — top-level businesses (Acton, Ray White, etc.)
 */
export const agencySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  normalizedName: z.string().min(1),
  tradingName: z.string().nullable().optional(),
  licenceNumber: z.string().nullable().optional(),
  abn: z.string().nullable().optional(),
  state: australianStateSchema.default("WA"),
  primarySuburb: z.string().nullable().optional(),
  primaryPostcode: postcodeSchema.nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  isRealEstate: z.boolean().default(false),
  status: entityStatusSchema.default("market_seen_unverified"),
  reviewStatus: reviewStatusSchema.default("ready"),
  confidence: confidenceSchema.default(0),
  metadata: jsonbSchema.default({}),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type Agency = z.infer<typeof agencySchema>;

export const agencyInputSchema = agencySchema
  .omit({ id: true, createdAt: true, updatedAt: true, firstSeenAt: true, lastSeenAt: true })
  .extend({
    id: uuidSchema.optional(),
  });
export type AgencyInput = z.infer<typeof agencyInputSchema>;

/**
 * research.agents — individual real-estate agents.
 */
export const agencyRoleSchema = z.enum([
  "principal",
  "director",
  "sales",
  "property_manager",
  "leasing",
  "admin",
  "unknown",
]);

export const agentSchema = z.object({
  id: uuidSchema,
  fullName: z.string().min(1),
  normalizedName: z.string().min(1),
  givenName: z.string().nullable().optional(),
  familyName: z.string().nullable().optional(),
  licenceNumber: z.string().nullable().optional(),
  agencyId: uuidSchema.nullable().optional(),
  agencyRole: agencyRoleSchema.nullable().optional(),
  state: australianStateSchema.default("WA"),
  primarySuburb: z.string().nullable().optional(),
  primaryPostcode: postcodeSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  websiteUrl: z.string().url().nullable().optional(),
  status: entityStatusSchema.default("market_seen_unverified"),
  reviewStatus: reviewStatusSchema.default("ready"),
  confidence: confidenceSchema.default(0),
  metadata: jsonbSchema.default({}),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type Agent = z.infer<typeof agentSchema>;

export const agentInputSchema = agentSchema
  .omit({ id: true, createdAt: true, updatedAt: true, firstSeenAt: true, lastSeenAt: true })
  .extend({
    id: uuidSchema.optional(),
  });
export type AgentInput = z.infer<typeof agentInputSchema>;

/**
 * research.agent_service_areas — which postcodes each agent/agency covers.
 * Either agentId or agencyId must be set (enforced at the DB level too).
 */
export const serviceAreaMatchTypeSchema = z.enum([
  "office_postcode",
  "listing_attribution",
  "service_suburb",
  "agent_profile_listing",
  "ad_targeting_observed",
  "manual",
  "nearby_market",
]);

export const agentServiceAreaSchema = z
  .object({
    id: uuidSchema,
    agentId: uuidSchema.nullable().optional(),
    agencyId: uuidSchema.nullable().optional(),
    postcode: postcodeSchema,
    suburb: z.string().min(1),
    state: australianStateSchema.default("WA"),
    matchType: serviceAreaMatchTypeSchema,
    confidence: confidenceSchema.default(0),
    evidence: jsonbSchema.default({}),
    sourceDocumentId: uuidSchema.nullable().optional(),
    firstSeenAt: isoTimestampSchema,
    lastSeenAt: isoTimestampSchema,
    createdAt: isoTimestampSchema,
  })
  .refine(
    (row) => Boolean(row.agentId) || Boolean(row.agencyId),
    "agent_service_areas must reference an agent or an agency",
  );
export type AgentServiceArea = z.infer<typeof agentServiceAreaSchema>;
