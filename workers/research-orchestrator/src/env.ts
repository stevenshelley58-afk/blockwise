import { z } from "zod";

/**
 * Strict env parsing for the orchestrator.
 */

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    const s = v.toLowerCase().trim();
    return s === "true" || s === "1" || s === "yes";
  });

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  AD_COLLECTOR_PROVIDER: z
    .enum(["self_hosted_meta", "searchapi_meta", "official_meta_archive"])
    .default("self_hosted_meta"),
  AD_COLLECTOR_COUNTRY: z.string().length(2).default("AU"),
  AD_COLLECTOR_ACTIVE_STATUS: z.enum(["active", "inactive", "all"]).default("active"),
  AD_COLLECTOR_DAILY_SPEND_LIMIT_USD: z.coerce.number().nonnegative().default(0),
  AD_COLLECTOR_RESULTS_LIMIT_PER_PAGE: z.coerce.number().int().positive().default(50),
  SELF_HOSTED_META_COLLECTOR_URL: z.string().url().default("http://meta-ad-library-collector:9100"),
  SEARCHAPI_API_KEY: z.string().optional(),
  SEARCHAPI_BASE_URL: z.string().url().default("https://www.searchapi.io/api/v1/search"),
  SEARCHAPI_ESTIMATED_COST_PER_RUN_USD: z.coerce.number().nonnegative().default(0),
  META_AD_LIBRARY_API_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v20.0"),
  RESEARCH_RAW_EVIDENCE_BUCKET: z.string().default("research-raw-evidence"),
  RESEARCH_AD_CREATIVES_BUCKET: z.string().default("research-ad-creatives"),
  ORCHESTRATOR_MODE: z.enum(["once", "loop"]).default("once"),
  ORCHESTRATOR_LOOP_INTERVAL_MS: z.coerce.number().default(5 * 60 * 1000),
  ORCHESTRATOR_MAX_PAGES_PER_TICK: z.coerce.number().default(20),
  ORCHESTRATOR_TARGET_PAGE_ID: z.string().min(1).optional(),
  ORCHESTRATOR_DRY_RUN: booleanFromString.default(false),
});

export type OrchestratorEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): OrchestratorEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid orchestrator env:\n${issues}`);
  }
  return parsed.data;
}
