import { z } from "zod";

export const openRouterTasks = [
  "page_resolution",
  "ad_classification",
  "coverage_audit",
  "defect_investigation",
] as const;

export type OpenRouterTask = typeof openRouterTasks[number];

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    const normalised = value.trim().toLowerCase();
    return normalised === "1" || normalised === "true" || normalised === "yes";
  });

const openRouterModelsSchema = z.string().optional().transform((value, context): Partial<Record<OpenRouterTask, string>> => {
  if (!value || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a JSON object" });
      return z.NEVER;
    }
    const out: Partial<Record<OpenRouterTask, string>> = {};
    for (const task of openRouterTasks) {
      const model = (parsed as Record<string, unknown>)[task];
      if (typeof model === "string" && model.trim()) out[task] = model.trim();
    }
    return out;
  } catch (err) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `invalid JSON: ${(err as Error).message}` });
    return z.NEVER;
  }
});

const envSchema = z.object({
  HERMES_PROVIDER: z.enum(["openrouter"]).default("openrouter"),
  HERMES_RESEARCH_MODE: z.enum(["build", "maintain"]).default("maintain"),
  HERMES_BUILD_CONCURRENCY: z.coerce.number().int().positive().default(4),
  HERMES_MAINTAIN_CONCURRENCY: z.coerce.number().int().positive().default(1),
  HERMES_COLLECTION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),
  HERMES_DAILY_SPEND_LIMIT_USD: z.coerce.number().nonnegative().default(25),
  HERMES_RESEARCH_QUEUE_PATH: z.string().min(1).default(".hermes/research-queue.json"),
  HERMES_QUEUE_WORKER_ID: z.string().min(1).default("hermes-research-worker"),
  HERMES_QUEUE_LOOP_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  HERMES_QUEUE_DRY_RUN: booleanFromString.default(false),
  HERMES_SUPABASE_URL: z.string().url().optional(),
  HERMES_SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  HERMES_RESEARCH_AD_CREATIVES_BUCKET: z.string().min(1).default("research-ad-creatives"),
  HERMES_RESEARCH_SCREENSHOTS_BUCKET: z.string().min(1).default("research-screenshots"),
  HERMES_RESEARCH_RAW_EVIDENCE_BUCKET: z.string().min(1).default("research-raw-evidence"),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_SITE_URL: z.string().url().optional(),
  OPENROUTER_APP_NAME: z.string().min(1).optional(),
  HERMES_DEFAULT_MODEL: z.string().min(1).optional(),
  HERMES_ESCALATION_MODEL: z.string().min(1).optional(),
  HERMES_OPENROUTER_MODEL: z.string().min(1).optional(),
  HERMES_OPENROUTER_MODELS_JSON: openRouterModelsSchema.default("{}"),
});

export type ResearchRuntimeEnv = z.infer<typeof envSchema>;

export function loadResearchRuntimeEnv(source: NodeJS.ProcessEnv = process.env): ResearchRuntimeEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid Hermes research runtime env:\n${issues}`);
  }
  return parsed.data;
}

export function modelForTask(env: ResearchRuntimeEnv, task: OpenRouterTask): string {
  const model = env.HERMES_OPENROUTER_MODELS_JSON[task] ?? env.HERMES_DEFAULT_MODEL ?? env.HERMES_OPENROUTER_MODEL;
  if (!model) {
    throw new Error(
      `No OpenRouter model configured for ${task}; set HERMES_DEFAULT_MODEL or HERMES_OPENROUTER_MODELS_JSON`,
    );
  }
  return model;
}

export function modelForEscalation(env: ResearchRuntimeEnv, task: OpenRouterTask): string {
  return env.HERMES_ESCALATION_MODEL ?? modelForTask(env, task);
}
