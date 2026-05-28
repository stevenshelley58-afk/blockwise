import { z } from "zod";

import {
  australianStateSchema,
  isoTimestampSchema,
  jsonbSchema,
  postcodeSchema,
  uuidSchema,
} from "./common.ts";

/**
 * research.coverage_audits — periodic per-postcode audits.
 */
export const auditMethodSchema = z.enum([
  "sampled_manual_browse",
  "license_register_diff",
  "provider_cross_check",
  "operator_review",
]);
export const auditStatusSchema = z.enum(["covered", "watch", "needs_work", "unknown"]);

export const coverageAuditSchema = z.object({
  id: uuidSchema,
  postcode: postcodeSchema,
  suburb: z.string().min(1),
  state: australianStateSchema.default("WA"),
  auditedAt: isoTimestampSchema,
  auditMethod: auditMethodSchema.default("sampled_manual_browse"),
  status: auditStatusSchema,
  score: z.number().min(0).max(100).default(0),
  agentsKnown: z.number().int().min(0).default(0),
  agentsEstimated: z.number().int().min(0).default(0),
  adsKnown: z.number().int().min(0).default(0),
  adsSampledExternal: z.number().int().min(0).default(0),
  sampleEvidence: jsonbSchema.default({}),
  decidedByDecisionId: uuidSchema.nullable().optional(),
  sourceDocumentId: uuidSchema.nullable().optional(),
  createdAt: isoTimestampSchema,
});
export type CoverageAudit = z.infer<typeof coverageAuditSchema>;

/**
 * research.coverage_defects — gaps either found by the auditor or reported
 * by an operator / customer / Hermes' defect_investigator.
 */
export const defectReporterSchema = z.enum([
  "auditor",
  "operator",
  "customer",
  "investigator",
  "system",
]);
export const defectStatusSchema = z.enum(["open", "investigating", "resolved", "dismissed"]);

export const coverageDefectSchema = z.object({
  id: uuidSchema,
  postcode: postcodeSchema.nullable().optional(),
  suburb: z.string().nullable().optional(),
  state: australianStateSchema.nullable().optional(),
  agentName: z.string().nullable().optional(),
  agencyName: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  evidenceUrl: z.string().url().nullable().optional(),
  notes: z.string().min(1),
  reportedBy: defectReporterSchema.default("auditor"),
  reporterIdentity: z.string().nullable().optional(),
  status: defectStatusSchema.default("open"),
  resolution: jsonbSchema.default({}),
  resolutionDecisionId: uuidSchema.nullable().optional(),
  resolvedAgentId: uuidSchema.nullable().optional(),
  resolvedAgencyId: uuidSchema.nullable().optional(),
  resolvedAdvertiserPageId: uuidSchema.nullable().optional(),
  resolvedAt: isoTimestampSchema.nullable().optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type CoverageDefect = z.infer<typeof coverageDefectSchema>;

/**
 * research.refresh_policies — operator-editable per-postcode cadence.
 */
export const refreshPolicySchema = z.object({
  id: uuidSchema,
  postcode: postcodeSchema,
  state: australianStateSchema.default("WA"),
  priority: z.number().int().min(1).max(5).default(3),
  refreshCadenceMinutes: z.number().int().min(15).max(60 * 24 * 30).default(1440),
  lastRefreshedAt: isoTimestampSchema.nullable().optional(),
  nextRefreshAt: isoTimestampSchema,
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type RefreshPolicy = z.infer<typeof refreshPolicySchema>;
