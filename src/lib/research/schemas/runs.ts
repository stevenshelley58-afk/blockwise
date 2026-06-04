import { z } from "zod";

import {
  hashSchema,
  isoTimestampSchema,
  jsonbSchema,
  sourceProviderSchema,
  uuidSchema,
} from "./common.ts";

/**
 * research.source_documents — every raw payload we've fetched from an external
 * provider, with its content hash and pointer to Supabase Storage.
 */
export const sourceDocumentSchema = z.object({
  id: uuidSchema,
  source: sourceProviderSchema,
  sourceUrl: z.string().url().nullable().optional(),
  sourceExternalId: z.string().nullable().optional(),
  fetchedAt: isoTimestampSchema,
  storageBucket: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
  contentHash: hashSchema,
  mimeType: z.string().nullable().optional(),
  byteSize: z.number().int().min(0).nullable().optional(),
  metadata: jsonbSchema.default({}),
  createdAt: isoTimestampSchema,
});
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

/**
 * research.ad_fetch_runs — audit log of every provider call.
 */
export const fetchRunRoleSchema = z.enum(["primary", "verifier", "backfill", "manual"]);
export const fetchRunTriggerSchema = z.enum([
  "scheduled",
  "manual",
  "defect_investigation",
  "audit",
  "discovery",
]);
export const fetchRunTargetKindSchema = z.enum([
  "advertiser_page",
  "postcode",
  "suburb",
  "agent",
  "agency",
  "search_query",
  "ad_id",
]);
export const fetchRunStatusSchema = z.enum(["running", "success", "partial", "failed"]);

export const adFetchRunSchema = z.object({
  id: uuidSchema,
  sourceProvider: sourceProviderSchema,
  role: fetchRunRoleSchema.default("primary"),
  trigger: fetchRunTriggerSchema.default("scheduled"),
  targetKind: fetchRunTargetKindSchema,
  targetValue: z.string().min(1),
  inputPayload: jsonbSchema.default({}),
  inputHash: hashSchema,
  sourceDocumentId: uuidSchema.nullable().optional(),
  startedAt: isoTimestampSchema,
  completedAt: isoTimestampSchema.nullable().optional(),
  status: fetchRunStatusSchema.default("running"),
  resultSummary: jsonbSchema.default({}),
  error: z.string().nullable().optional(),
  costUsd: z.number().nullable().optional(),
  createdAt: isoTimestampSchema,
});
export type AdFetchRun = z.infer<typeof adFetchRunSchema>;

/**
 * Result summary shape that ingestion workers populate when finishing a run.
 */
export const fetchRunResultSummarySchema = z.object({
  adsObserved: z.number().int().min(0).default(0),
  adsNew: z.number().int().min(0).default(0),
  adsUpdated: z.number().int().min(0).default(0),
  adsUnchanged: z.number().int().min(0).default(0),
  adsMissing: z.number().int().min(0).default(0),
  creditsSpent: z.number().min(0).default(0),
  errorCount: z.number().int().min(0).default(0),
  warnings: z.array(z.string()).default([]),
});
export type FetchRunResultSummary = z.infer<typeof fetchRunResultSummarySchema>;

/**
 * research.ingest_events — every write into research.* with provenance.
 */
export const ingestEventTypeSchema = z.enum([
  "insert",
  "update",
  "upsert",
  "mark_inactive",
  "delete",
  "merge",
  "split",
]);
export type IngestEventType = z.infer<typeof ingestEventTypeSchema>;

export const ingestEventSchema = z.object({
  id: uuidSchema,
  eventType: ingestEventTypeSchema,
  tableName: z.string().min(1),
  rowId: uuidSchema,
  payload: jsonbSchema.default({}),
  payloadHash: hashSchema.nullable().optional(),
  diff: jsonbSchema.nullable().optional(),
  sourceProvider: sourceProviderSchema.nullable().optional(),
  adFetchRunId: uuidSchema.nullable().optional(),
  agentDecisionId: uuidSchema.nullable().optional(),
  sourceDocumentId: uuidSchema.nullable().optional(),
  createdAt: isoTimestampSchema,
});
export type IngestEvent = z.infer<typeof ingestEventSchema>;
