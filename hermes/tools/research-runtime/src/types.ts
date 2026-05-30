import { z } from "zod";

const isoDateTime = z.string().min(1);
const idString = z.string().min(1);
const postcode = z.string().regex(/^\d{4}$/u, "postcode must be a four digit Australian postcode");
const state = z.string().min(2).max(3).transform((value) => value.toUpperCase());

export const researchJobKinds = [
  "blockwise-agent-census",
  "blockwise-page-resolver",
  "blockwise-ad-collector",
  "blockwise-ad-classifier",
  "blockwise-coverage-auditor",
  "blockwise-defect-investigator",
] as const;

export const realEstateGateSchema = z.object({
  verified: z.literal(true),
  verifiedBySkill: z.literal("blockwise-agent-census"),
  decisionId: idString,
  sourceDocumentIds: z.array(idString).min(1),
  verifiedAt: isoDateTime.optional(),
}).strict();

export const agentCensusPayloadSchema = z.object({
  postcode,
  state,
  maxAgeDays: z.number().int().positive().default(7),
  forceRefresh: z.boolean().default(false),
}).strict();

export const pageResolverPayloadSchema = z.object({
  subjectKind: z.enum(["agent", "agency"]),
  subjectId: idString,
  censusDecisionId: idString,
  sourceDocumentIds: z.array(idString).min(1),
  forceRevisit: z.boolean().default(false),
}).strict();

export const adCollectorPayloadSchema = z.object({
  advertiserPageId: idString,
  metaPageId: idString,
  platform: z.enum(["facebook", "instagram", "meta_ad_library"]).default("meta_ad_library"),
  country: z.string().length(2).transform((value) => value.toUpperCase()).default("AU"),
  activeStatus: z.enum(["active", "inactive", "all"]).default("active"),
  resultsLimit: z.number().int().positive().max(250).default(50),
  realEstateGate: realEstateGateSchema,
  resolverDecisionId: idString,
}).strict();

export const adClassifierPayloadSchema = z.object({
  adCreativeId: idString,
  sourceDocumentId: idString,
  force: z.boolean().default(false),
}).strict();

export const coverageAuditorPayloadSchema = z.object({
  postcode,
  state,
  method: z.enum(["resolved_roster_sample", "operator_defect_replay"]).default("resolved_roster_sample"),
  sampleSize: z.number().int().positive().max(50).default(5),
}).strict();

export const defectInvestigatorPayloadSchema = z.object({
  coverageDefectId: idString,
  operatorDecisionId: idString.optional(),
}).strict();

const jobMetaSchema = {
  priority: z.number().int().min(0).max(100).default(50),
  availableAt: isoDateTime.optional(),
  source: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  maxAttempts: z.number().int().positive().max(10).default(3),
};

function jobSchema<K extends typeof researchJobKinds[number], P extends z.ZodTypeAny>(
  kind: K,
  payload: P,
) {
  return z.object({
    kind: z.literal(kind),
    payload,
    ...jobMetaSchema,
  }).strict();
}

export const researchJobInputSchema = z.discriminatedUnion("kind", [
  jobSchema("blockwise-agent-census", agentCensusPayloadSchema),
  jobSchema("blockwise-page-resolver", pageResolverPayloadSchema),
  jobSchema("blockwise-ad-collector", adCollectorPayloadSchema),
  jobSchema("blockwise-ad-classifier", adClassifierPayloadSchema),
  jobSchema("blockwise-coverage-auditor", coverageAuditorPayloadSchema),
  jobSchema("blockwise-defect-investigator", defectInvestigatorPayloadSchema),
]);

export type RealEstateGate = z.infer<typeof realEstateGateSchema>;
export type AgentCensusPayload = z.infer<typeof agentCensusPayloadSchema>;
export type PageResolverPayload = z.infer<typeof pageResolverPayloadSchema>;
export type AdCollectorPayload = z.infer<typeof adCollectorPayloadSchema>;
export type AdClassifierPayload = z.infer<typeof adClassifierPayloadSchema>;
export type CoverageAuditorPayload = z.infer<typeof coverageAuditorPayloadSchema>;
export type DefectInvestigatorPayload = z.infer<typeof defectInvestigatorPayloadSchema>;
export type ResearchJobInput = z.input<typeof researchJobInputSchema>;
export type ParsedResearchJobInput = z.output<typeof researchJobInputSchema>;
export type ResearchJobKind = ParsedResearchJobInput["kind"];
export type ResearchJobPayload<K extends ResearchJobKind> = Extract<ParsedResearchJobInput, { kind: K }>["payload"];

export type ResearchJobStatus = "queued" | "running" | "succeeded" | "failed" | "deferred";

export type SkillRunResult =
  | {
      status: "succeeded";
      summary: string;
      enqueue?: ResearchJobInput[];
      metadata?: Record<string, unknown>;
    }
  | {
      status: "failed";
      error: string;
      retryable?: boolean;
      retryAfterMs?: number;
      metadata?: Record<string, unknown>;
    }
  | {
      status: "deferred";
      summary: string;
      retryAfterMs: number;
      enqueue?: ResearchJobInput[];
      metadata?: Record<string, unknown>;
    };

export type ResearchJob = ParsedResearchJobInput & {
  id: string;
  deterministicKey: string;
  status: ResearchJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  lockOwner: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  result: SkillRunResult | null;
};

export function validateResearchJobInput(input: unknown): ParsedResearchJobInput {
  return researchJobInputSchema.parse(input);
}
