import { z } from "zod";

const idString = z.string().min(1);

export const metaAdLibraryAdSchema = z.object({
  adArchiveID: z.union([z.string(), z.number()]).transform(String),
  id: z.union([z.string(), z.number()]).optional().transform((value) => value == null ? undefined : String(value)),
  pageID: z.union([z.string(), z.number()]).nullable().optional().transform((value) => value == null ? null : String(value)),
  pageName: z.string().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  status: z.string().nullable().optional(),
  startDate: z.union([z.string(), z.number()]).nullable().optional(),
  endDate: z.union([z.string(), z.number()]).nullable().optional(),
  publisherPlatform: z.array(z.string()).default(["facebook"]),
  snapshot: z.record(z.unknown()).default({}),
  inputUrl: z.string().nullable().optional(),
}).passthrough();

export const metaAdLibraryDatasetSchema = z.array(metaAdLibraryAdSchema);

export const captureRealEstateGateSchema = z.object({
  verified: z.literal(true),
  verifiedBySkill: z.literal("blockwise-agent-census"),
  decisionId: idString,
  sourceDocumentIds: z.array(idString).min(1),
}).strict();

export const metaCaptureInputSchema = z.object({
  advertiserPageId: idString,
  metaPageId: idString,
  country: z.string().length(2).transform((value) => value.toUpperCase()).default("AU"),
  activeStatus: z.enum(["active", "inactive", "all"]).default("active"),
  resultsLimit: z.number().int().positive().max(250).default(50),
  realEstateGate: captureRealEstateGateSchema,
  resolverDecisionId: idString,
}).strict();

export type MetaAdLibraryAd = z.infer<typeof metaAdLibraryAdSchema>;
export type MetaCaptureInput = z.infer<typeof metaCaptureInputSchema>;

export type MetaCaptureProvider = "disabled" | "http_json";

export type MetaCaptureOutcome = {
  runId: string;
  provider: MetaCaptureProvider;
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED" | "OTHER";
  startedAt: string;
  finishedAt: string | null;
  costUsd: number;
  itemCount: number;
  items: MetaAdLibraryAd[];
  rawDatasetId: string | null;
  errorMessage: string | null;
  metadata?: Record<string, unknown>;
};

export function validateMetaCaptureInput(input: unknown): MetaCaptureInput {
  return metaCaptureInputSchema.parse(input);
}
