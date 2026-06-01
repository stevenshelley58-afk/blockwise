import { z } from "zod";

const idString = z.string().min(1);
const postcode = z.string().regex(/^\d{4}$/u);
const state = z.string().min(2).max(3).transform((value) => value.toUpperCase());

export const researchJobKinds = [
  "blockwise-agent-census",
  "blockwise-page-resolver",
  "blockwise-ad-collector",
  "blockwise-media-collector",
  "blockwise-ad-classifier",
  "blockwise-coverage-auditor",
  "blockwise-defect-investigator",
] as const;

export type ResearchJobKind = typeof researchJobKinds[number];

export const realEstateGateSchema = z.object({
  verified: z.literal(true),
  verifiedBySkill: z.literal("blockwise-agent-census"),
  decisionId: idString,
  sourceDocumentIds: z.array(idString).min(1),
  verifiedAt: z.string().min(1).optional(),
}).strict();

export const agentCensusPayloadSchema = z.object({
  postcode,
  state,
  build_run_id: idString.optional(),
  verified_roster_first: z.literal(true).default(true),
  location_search_allowed: z.literal(false).default(false),
  legacy_discovery_allowed: z.literal(false).default(false),
}).passthrough();

export const pageResolverPayloadSchema = z.object({
  subjectKind: z.enum(["agent", "agency"]),
  subjectId: idString,
  censusDecisionId: idString,
  sourceDocumentIds: z.array(idString).min(1),
  forceRevisit: z.boolean().default(false),
  location_search_allowed: z.literal(false).default(false),
}).passthrough();

export const adCollectorPayloadSchema = z.object({
  advertiserPageId: idString,
  metaPageId: idString,
  country: z.string().length(2).default("AU"),
  activeStatus: z.enum(["active", "inactive", "all"]).default("active"),
  resultsLimit: z.number().int().positive().max(250).default(50),
  realEstateGate: realEstateGateSchema,
  resolverDecisionId: idString,
}).strict();

export const mediaCollectorPayloadSchema = z.object({
  adCreativeId: idString,
  observedAdId: idString,
  sourceUrls: z.array(z.string().url()).default([]),
}).passthrough();

export const adClassifierPayloadSchema = z.object({
  adCreativeId: idString,
  sourceDocumentId: idString.optional(),
  force: z.boolean().default(false),
}).strict();

export const researchJobInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blockwise-agent-census"), payload: agentCensusPayloadSchema }).passthrough(),
  z.object({ kind: z.literal("blockwise-page-resolver"), payload: pageResolverPayloadSchema }).passthrough(),
  z.object({ kind: z.literal("blockwise-ad-collector"), payload: adCollectorPayloadSchema }).passthrough(),
  z.object({ kind: z.literal("blockwise-media-collector"), payload: mediaCollectorPayloadSchema }).passthrough(),
  z.object({ kind: z.literal("blockwise-ad-classifier"), payload: adClassifierPayloadSchema }).passthrough(),
  z.object({ kind: z.literal("blockwise-coverage-auditor"), payload: z.record(z.unknown()) }).passthrough(),
  z.object({ kind: z.literal("blockwise-defect-investigator"), payload: z.record(z.unknown()) }).passthrough(),
]);

export type RealEstateGate = z.infer<typeof realEstateGateSchema>;
export type ResearchJobInput = z.input<typeof researchJobInputSchema>;
export type ParsedResearchJobInput = z.output<typeof researchJobInputSchema>;

export type SupabaseResearchJob = {
  id: string;
  queue_name: string;
  job_type: ResearchJobKind | string;
  payload: Record<string, unknown>;
  priority: number;
  status: "pending" | "claimed" | "complete" | "failed" | "blocked";
  claim_token: string | null;
  attempts: number;
  max_attempts: number;
};

export type SkillRunResult =
  | { status: "complete"; result: Record<string, unknown> }
  | { status: "blocked"; blocked_reason: string; result: Record<string, unknown> };
