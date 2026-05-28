import { z } from "zod";

/**
 * Strict env parsing for the orchestrator. If a required env is missing or
 * placeholder-shaped, the process exits 1 with a readable error BEFORE any
 * API calls happen.
 */
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  APIFY_API_TOKEN: z.string().min(20),
  APIFY_DEFAULT_ACTOR: z.string().default("apify/facebook-ads-scraper"),
  APIFY_DAILY_SPEND_LIMIT_USD: z.coerce.number().default(10),
  APIFY_RESULTS_LIMIT_PER_PAGE: z.coerce.number().default(50),
  RESEARCH_RAW_EVIDENCE_BUCKET: z.string().default("research-raw-evidence"),
  ORCHESTRATOR_MODE: z.enum(["once", "loop"]).default("once"),
  ORCHESTRATOR_LOOP_INTERVAL_MS: z.coerce.number().default(5 * 60 * 1000),
  ORCHESTRATOR_MAX_PAGES_PER_TICK: z.coerce.number().default(20),
  // Set to 'true' to halt all upserts (kill switch for the operator)
  ORCHESTRATOR_DRY_RUN: z.coerce.boolean().default(false),
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
