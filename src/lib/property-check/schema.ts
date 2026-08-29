import { z } from "zod";

import { PROPERTY_CHECK_CLIENT_SITUATIONS } from "./types.ts";

export const propertyCheckClientSituationSchema = z.enum(PROPERTY_CHECK_CLIENT_SITUATIONS);

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const propertyCheckCreateSchema = z.object({
  address: z.string().trim().min(3).max(500),
  clientSituation: propertyCheckClientSituationSchema.default("general"),
  notes: optionalTrimmedString(1500),
});

export const citationSourceTypeSchema = z.enum([
  "planning_scheme",
  "local_policy",
  "rcode",
  "overlay",
  "council_page",
  "other",
]);

const citationIdSchema = z.string().trim().min(1).max(160);

export const citationSchema = z.object({
  id: citationIdSchema,
  title: z.string().trim().min(1).max(240),
  sourceType: citationSourceTypeSchema,
  url: z.string().trim().url().optional(),
  excerpt: z.string().trim().max(1000).optional(),
  retrievedAt: z.string().trim().max(80).optional(),
});

const planningItemSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(1200),
  citationIds: z.array(citationIdSchema).default([]),
  severity: z.enum(["info", "watch", "important"]).optional(),
});

export const propertySignalSchema = planningItemSchema;
export const propertyConstraintSchema = planningItemSchema;

export const draftCheckResultSchema = z.object({
  status: z.enum(["success", "no_source", "unsupported", "error"]),
  normalizedFacts: z.record(z.unknown()).optional(),
  signals: z.array(propertySignalSchema).optional(),
  likelyConstraints: z.array(propertyConstraintSchema).optional(),
  talkingPoints: z.array(z.string().trim().min(1).max(500)).optional(),
  citations: z.array(citationSchema).optional(),
  disclaimer: z.string().trim().min(1).max(1000),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  engineRequestId: z.string().trim().min(1).max(240).optional(),
});

export type PropertyCheckCreateInput = z.infer<typeof propertyCheckCreateSchema>;
