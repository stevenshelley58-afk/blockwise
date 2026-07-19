import { z } from "zod";

export const researchModelTasks = [
  "page_resolution",
  "ad_classification",
  "coverage_audit",
  "defect_investigation",
] as const;

export type ResearchModelTask = typeof researchModelTasks[number];

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => typeof value === "boolean" || ["1", "true", "yes"].includes(value.trim().toLowerCase()));

const taskModelsSchema = z.string().optional().transform((value, context): Partial<Record<ResearchModelTask, string>> => {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a JSON object" });
      return z.NEVER;
    }
    const models: Partial<Record<ResearchModelTask, string>> = {};
    for (const task of researchModelTasks) {
      const model = (parsed as Record<string, unknown>)[task];
      if (typeof model === "string" && model.trim()) models[task] = model.trim();
    }
    return models;
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `invalid JSON: ${(error as Error).message}` });
    return z.NEVER;
  }
});

const envSchema = z.object({
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
  HERMES_SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  HERMES_SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  HERMES_RESEARCH_AD_CREATIVES_BUCKET: z.string().min(1).default("research-ad-creatives"),
  HERMES_RESEARCH_SCREENSHOTS_BUCKET: z.string().min(1).default("research-screenshots"),
  HERMES_RESEARCH_RAW_EVIDENCE_BUCKET: z.string().min(1).default("research-raw-evidence"),
  OPENAI_API_KEY: z.string().min(1),
  HERMES_DEFAULT_MODEL: z.string().min(1).default("gpt-5.5"),
  HERMES_MODELS_JSON: taskModelsSchema.default("{}"),
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

export function modelForTask(env: ResearchRuntimeEnv, task: ResearchModelTask): string {
  return env.HERMES_MODELS_JSON[task] ?? env.HERMES_DEFAULT_MODEL;
}
