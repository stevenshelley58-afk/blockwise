import { z } from "zod";

import {
  confidenceSchema,
  isoTimestampSchema,
  jsonbSchema,
  uuidSchema,
} from "./common.ts";

/**
 * research.agent_decisions — Hermes' structured decision log.
 *
 * Every page resolution, defect investigation, audit outcome, classification,
 * etc. is one row here. This is the system-of-record for "what did Hermes
 * decide, when, why, and with what evidence." The mem0 fuzzy-memory layer
 * runs alongside this; if mem0 and this table disagree, this table wins.
 */
export const decisionTypeSchema = z.enum([
  "page_resolution",
  "agent_match",
  "agency_match",
  "duplicate_merge",
  "coverage_audit",
  "defect_investigation",
  "ad_classification",
  "area_match",
  "cadence_change",
  "operator_chat",
]);
export type DecisionType = z.infer<typeof decisionTypeSchema>;

export const decisionSubjectTypeSchema = z.enum([
  "advertiser_page",
  "agent",
  "agency",
  "observed_ad",
  "ad_creative",
  "postcode",
  "coverage_defect",
  "operator_query",
]);
export type DecisionSubjectType = z.infer<typeof decisionSubjectTypeSchema>;

export const agentDecisionSchema = z.object({
  id: uuidSchema,
  decisionType: decisionTypeSchema,
  subjectType: decisionSubjectTypeSchema,
  subjectId: z.string().min(1),
  decidedAt: isoTimestampSchema,
  decision: jsonbSchema,
  rationale: z.string().nullable().optional(),
  confidence: confidenceSchema.default(0),
  evidence: jsonbSchema.default({}),
  sourceDocumentIds: z.array(uuidSchema).default([]),
  hermesSessionId: z.string().nullable().optional(),
  hermesSkill: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  costUsd: z.number().min(0).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  supersededBy: uuidSchema.nullable().optional(),
  createdAt: isoTimestampSchema,
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const agentDecisionInputSchema = agentDecisionSchema
  .omit({ id: true, createdAt: true })
  .extend({
    id: uuidSchema.optional(),
  });
export type AgentDecisionInput = z.infer<typeof agentDecisionInputSchema>;
