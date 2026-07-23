import { z } from "zod";

// Shared LLM provider routing for the Hermes research runtime.
// Twin of hermes/tools/research-runtime/bin/llm-provider.mjs — keep both sides in sync.
//
// All non-image models route by slug prefix to an OpenAI-compatible provider:
//   kimi-*/moonshot-* -> Moonshot (https://api.moonshot.ai/v1, MOONSHOT_API_KEY)
//   qwen-*            -> Alibaba DashScope compatible mode
//                        (https://dashscope.aliyuncs.com/compatible-mode/v1, DASHSCOPE_API_KEY)
// Anything else is a config error. There is no OpenAI fallback.

export const researchModelTasks = [
  "page_resolution",
  "ad_classification",
  "vision_classification",
  "coverage_audit",
  "defect_investigation",
] as const;

export type ResearchModelTask = typeof researchModelTasks[number];

export const DEFAULT_LLM_MODEL = "kimi-k2.6";

export const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
export const DASHSCOPE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// Built-in per-task defaults. HERMES_MODELS_JSON overrides always win.
export const DEFAULT_TASK_MODELS: Record<ResearchModelTask, string> = {
  page_resolution: "qwen3.5-plus",
  ad_classification: "kimi-k2.5",
  vision_classification: "kimi-k2.5",
  coverage_audit: "qwen3.5-plus",
  defect_investigation: "kimi-k2.6",
};

// Built-in content policy-slot defaults. HERMES_CONTENT_MODELS_JSON /
// HERMES_MODELS_JSON overrides always win.
export const DEFAULT_CONTENT_POLICY_MODELS = {
  best_copywriting: "kimi-k2.6",
  best_reasoning: "kimi-k2.6",
  best_json: "qwen3.5-plus",
  critic_review: "qwen3.5-plus",
  code_generation: "kimi-k2.7-code",
  best_image_prompting: "kimi-k2.5",
} as const;

export type LlmProvider = "moonshot" | "dashscope";

export type LlmEndpoint = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  chatUrl: string;
};

const PROVIDER_CONFIG: Record<LlmProvider, { keyEnv: "MOONSHOT_API_KEY" | "DASHSCOPE_API_KEY"; baseUrlEnv: "HERMES_MOONSHOT_BASE_URL" | "HERMES_DASHSCOPE_BASE_URL"; defaultBaseUrl: string }> = {
  moonshot: {
    keyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "HERMES_MOONSHOT_BASE_URL",
    defaultBaseUrl: MOONSHOT_BASE_URL,
  },
  dashscope: {
    keyEnv: "DASHSCOPE_API_KEY",
    baseUrlEnv: "HERMES_DASHSCOPE_BASE_URL",
    defaultBaseUrl: DASHSCOPE_BASE_URL,
  },
};

export function providerForModel(model: string): LlmProvider {
  const slug = model.trim().toLowerCase();
  if (slug.startsWith("kimi") || slug.startsWith("moonshot")) return "moonshot";
  if (slug.startsWith("qwen")) return "dashscope";
  throw new Error(
    `Unsupported Hermes LLM model "${model}": ` +
      "model slugs must start with kimi-/moonshot- (Moonshot) or qwen- (DashScope). " +
      "There is no OpenAI fallback in the research runtime.",
  );
}

export function resolveLlmEndpoint(
  env: Pick<ResearchRuntimeEnv, "MOONSHOT_API_KEY" | "DASHSCOPE_API_KEY" | "HERMES_MOONSHOT_BASE_URL" | "HERMES_DASHSCOPE_BASE_URL">,
  model: string,
): LlmEndpoint {
  const provider = providerForModel(model);
  const config = PROVIDER_CONFIG[provider];
  const apiKey = env[config.keyEnv];
  if (!apiKey) {
    throw new Error(`${config.keyEnv} is not configured (required for ${provider} model "${model}")`);
  }
  const baseUrl = (env[config.baseUrlEnv] || config.defaultBaseUrl).replace(/\/+$/u, "");
  return { provider, baseUrl, apiKey, chatUrl: `${baseUrl}/chat/completions` };
}

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => typeof value === "boolean" || ["1", "true", "yes"].includes(value.trim().toLowerCase()));

const jsonObjectString = z.string().optional().transform((value, context): Record<string, unknown> => {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a JSON object" });
      return z.NEVER;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `invalid JSON: ${(error as Error).message}` });
    return z.NEVER;
  }
});

// Keeps every string value (research tasks, content policy slots, skill ids)
// so overrides and key validation see exactly what the .mjs runtime sees.
const modelMapSchema = jsonObjectString.transform((parsed): Record<string, string> => {
  const models: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.trim()) models[key] = value.trim();
  }
  return models;
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
  MOONSHOT_API_KEY: z.string().min(1).optional(),
  DASHSCOPE_API_KEY: z.string().min(1).optional(),
  HERMES_MOONSHOT_BASE_URL: z.string().url().default(MOONSHOT_BASE_URL),
  HERMES_DASHSCOPE_BASE_URL: z.string().url().default(DASHSCOPE_BASE_URL),
  HERMES_DEFAULT_MODEL: z.string().min(1).optional(),
  HERMES_MODELS_JSON: modelMapSchema.default("{}"),
  HERMES_CONTENT_MODELS_JSON: modelMapSchema.default("{}"),
}).superRefine((env, context) => {
  const configured = configuredModels(env);
  let needsMoonshot = false;
  let needsDashscope = false;
  for (const model of configured) {
    try {
      const provider = providerForModel(model);
      if (provider === "moonshot") needsMoonshot = true;
      if (provider === "dashscope") needsDashscope = true;
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HERMES_DEFAULT_MODEL"],
        message: `unsupported model "${model}": slugs must start with kimi-/moonshot- or qwen- (no OpenAI fallback)`,
      });
    }
  }
  if (needsMoonshot && !env.MOONSHOT_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MOONSHOT_API_KEY"],
      message: "required because at least one configured model routes to Moonshot (kimi-*/moonshot-*)",
    });
  }
  if (needsDashscope && !env.DASHSCOPE_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DASHSCOPE_API_KEY"],
      message: "required because at least one configured model routes to DashScope (qwen-*)",
    });
  }
});

export type ResearchRuntimeEnv = z.infer<typeof envSchema>;

type ParsedEnv = z.output<typeof envSchema>;

// Every model slug that can be selected from this env, after applying the
// built-in task/policy defaults. Used to require provider keys exactly when a
// configured (or defaulted) model routes to that provider.
function configuredModels(env: ParsedEnv): string[] {
  const models = new Set<string>();
  for (const task of researchModelTasks) {
    models.add(modelForTask(env, task));
  }
  const contentOverrides = env.HERMES_CONTENT_MODELS_JSON;
  // Runtime quirk (kept in sync with bin/content-engine.mjs): a non-empty
  // HERMES_CONTENT_MODELS_JSON replaces HERMES_MODELS_JSON entirely for
  // content skills; when it has no keys, HERMES_MODELS_JSON applies.
  const contentConfigured = Object.keys(contentOverrides).length > 0 ? contentOverrides : env.HERMES_MODELS_JSON;
  for (const [policy, fallback] of Object.entries(DEFAULT_CONTENT_POLICY_MODELS)) {
    const override = contentConfigured[policy] ?? contentConfigured.content_generation;
    models.add(typeof override === "string" && override.trim() ? override.trim() : fallback);
  }
  for (const value of Object.values(contentConfigured)) {
    if (typeof value === "string" && value.trim()) models.add(value.trim());
  }
  for (const value of [...Object.values(env.HERMES_MODELS_JSON), ...Object.values(contentOverrides)]) {
    if (typeof value === "string" && value.trim()) models.add(value.trim());
  }
  models.add(env.HERMES_DEFAULT_MODEL ?? DEFAULT_LLM_MODEL);
  return [...models];
}

export function loadResearchRuntimeEnv(source: NodeJS.ProcessEnv = process.env): ResearchRuntimeEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid Hermes research runtime env:\n${issues}`);
  }
  return parsed.data;
}

export function modelForTask(env: Pick<ParsedEnv, "HERMES_MODELS_JSON" | "HERMES_DEFAULT_MODEL">, task: ResearchModelTask): string {
  return env.HERMES_MODELS_JSON[task] ?? DEFAULT_TASK_MODELS[task] ?? env.HERMES_DEFAULT_MODEL ?? DEFAULT_LLM_MODEL;
}
