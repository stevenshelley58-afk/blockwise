// Shared LLM provider routing for the Hermes research runtime.
//
// All non-image models route by slug prefix to an OpenAI-compatible provider:
//   kimi-*/moonshot-* -> Moonshot (https://api.moonshot.ai/v1, MOONSHOT_API_KEY)
//   qwen-*            -> Alibaba DashScope compatible mode
//                        (https://dashscope.aliyuncs.com/compatible-mode/v1, DASHSCOPE_API_KEY)
// Anything else is a config error. There is no OpenAI fallback.
//
// Twin of hermes/tools/research-runtime/src/config.ts — keep both sides in sync.

export const DEFAULT_LLM_MODEL = "kimi-k2.6";

export const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
export const DASHSCOPE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// Built-in per-task defaults. HERMES_MODELS_JSON overrides always win.
export const DEFAULT_TASK_MODELS = {
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
};

const PROVIDER_CONFIG = {
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

export function providerForModel(model) {
  const slug = cleanString(model)?.toLowerCase() ?? "";
  if (slug.startsWith("kimi") || slug.startsWith("moonshot")) return "moonshot";
  if (slug.startsWith("qwen")) return "dashscope";
  throw new Error(
    `Unsupported Hermes LLM model "${cleanString(model) ?? String(model)}": ` +
      "model slugs must start with kimi-/moonshot- (Moonshot) or qwen- (DashScope). " +
      "There is no OpenAI fallback in the research runtime.",
  );
}

export function resolveLlmEndpoint(env, model) {
  const provider = providerForModel(model);
  const config = PROVIDER_CONFIG[provider];
  const apiKey = cleanString(env?.[config.keyEnv]);
  if (!apiKey) {
    throw new Error(`${config.keyEnv} is not configured (required for ${provider} model "${model}")`);
  }
  const baseUrl = (cleanString(env?.[config.baseUrlEnv]) ?? config.defaultBaseUrl).replace(/\/+$/u, "");
  return { provider, baseUrl, apiKey, chatUrl: `${baseUrl}/chat/completions` };
}

export function modelForResearchTask(env, task) {
  const configured = parseModelsJson(env?.HERMES_MODELS_JSON);
  return (
    cleanString(configured?.[task]) ??
    DEFAULT_TASK_MODELS[task] ??
    cleanString(env?.HERMES_DEFAULT_MODEL) ??
    DEFAULT_LLM_MODEL
  );
}

export function parseModelsJson(value) {
  if (!cleanString(value)) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function cleanString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
