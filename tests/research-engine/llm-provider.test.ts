import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHSCOPE_BASE_URL,
  DEFAULT_CONTENT_POLICY_MODELS,
  DEFAULT_LLM_MODEL,
  DEFAULT_TASK_MODELS,
  MOONSHOT_BASE_URL,
  modelForResearchTask,
  providerForModel,
  resolveLlmEndpoint,
} from "../../hermes/tools/research-runtime/bin/llm-provider.mjs";

test("resolver defaults use a Kimi vision-capable model", () => {
  assert.equal(DEFAULT_LLM_MODEL, "kimi-k2.6");
  assert.equal(DEFAULT_TASK_MODELS.ad_classification, "kimi-k2.5");
  assert.equal(DEFAULT_TASK_MODELS.vision_classification, "kimi-k2.5");
});

test("providerForModel routes by slug prefix", () => {
  assert.equal(providerForModel("kimi-k2.6"), "moonshot");
  assert.equal(providerForModel("kimi-k2.5"), "moonshot");
  assert.equal(providerForModel("moonshot-v1-128k"), "moonshot");
  assert.equal(providerForModel("qwen3-max"), "dashscope");
  assert.equal(providerForModel("qwen-plus"), "dashscope");
});

test("providerForModel throws on unknown slugs (no OpenAI fallback)", () => {
  assert.throws(() => providerForModel("gpt-5.5"), /Unsupported Hermes LLM model/);
  assert.throws(() => providerForModel("gpt-4o"), /Unsupported Hermes LLM model/);
  assert.throws(() => providerForModel("claude-opus"), /Unsupported Hermes LLM model/);
  assert.throws(() => providerForModel(""), /Unsupported Hermes LLM model/);
});

test("resolveLlmEndpoint resolves Moonshot base URL + key", () => {
  const endpoint = resolveLlmEndpoint({ MOONSHOT_API_KEY: "mk-123" }, "kimi-k2.6");
  assert.equal(endpoint.provider, "moonshot");
  assert.equal(endpoint.apiKey, "mk-123");
  assert.equal(endpoint.baseUrl, MOONSHOT_BASE_URL);
  assert.equal(endpoint.chatUrl, `${MOONSHOT_BASE_URL}/chat/completions`);
});

test("resolveLlmEndpoint resolves DashScope base URL + key for qwen models", () => {
  const endpoint = resolveLlmEndpoint({ DASHSCOPE_API_KEY: "ds-999" }, "qwen3-max");
  assert.equal(endpoint.provider, "dashscope");
  assert.equal(endpoint.apiKey, "ds-999");
  assert.equal(endpoint.baseUrl, DASHSCOPE_BASE_URL);
  assert.equal(endpoint.chatUrl, `${DASHSCOPE_BASE_URL}/chat/completions`);
});

test("resolveLlmEndpoint throws when the routed provider key is missing", () => {
  assert.throws(() => resolveLlmEndpoint({}, "kimi-k2.6"), /MOONSHOT_API_KEY/);
  assert.throws(() => resolveLlmEndpoint({ DASHSCOPE_API_KEY: "x" }, "kimi-k2.6"), /MOONSHOT_API_KEY/);
  assert.throws(() => resolveLlmEndpoint({}, "qwen3-max"), /DASHSCOPE_API_KEY/);
});

test("resolveLlmEndpoint throws before key checks for unsupported models", () => {
  assert.throws(
    () => resolveLlmEndpoint({ OPENAI_API_KEY: "sk-xxx" }, "gpt-5.5"),
    /Unsupported Hermes LLM model/,
  );
});

test("per-provider base-URL env overrides the default base URL", () => {
  const moonshot = resolveLlmEndpoint(
    { MOONSHOT_API_KEY: "mk-1", HERMES_MOONSHOT_BASE_URL: "https://proxy.example.test/v1/" },
    "kimi-k2.6",
  );
  assert.equal(moonshot.baseUrl, "https://proxy.example.test/v1");
  assert.equal(moonshot.chatUrl, "https://proxy.example.test/v1/chat/completions");

  const dashscope = resolveLlmEndpoint(
    { DASHSCOPE_API_KEY: "ds-1", HERMES_DASHSCOPE_BASE_URL: "https://qwen-proxy.example.test/v1" },
    "qwen3-max",
  );
  assert.equal(dashscope.baseUrl, "https://qwen-proxy.example.test/v1");
  assert.equal(dashscope.chatUrl, "https://qwen-proxy.example.test/v1/chat/completions");
});

test("modelForResearchTask honours HERMES_MODELS_JSON, then task table, then default", () => {
  // explicit task override wins
  assert.equal(
    modelForResearchTask(
      { HERMES_MODELS_JSON: JSON.stringify({ ad_classification: "qwen3-max" }) },
      "ad_classification",
    ),
    "qwen3-max",
  );
  // a key not in the task table falls through to HERMES_DEFAULT_MODEL
  assert.equal(
    modelForResearchTask({ HERMES_DEFAULT_MODEL: "qwen-plus" }, "best_json"),
    "qwen-plus",
  );
  // a known task key uses the built-in task table ahead of HERMES_DEFAULT_MODEL
  assert.equal(
    modelForResearchTask({ HERMES_DEFAULT_MODEL: "qwen-plus" }, "defect_investigation"),
    DEFAULT_TASK_MODELS.defect_investigation,
  );
  // unknown task falls back to HERMES_DEFAULT_MODEL
  assert.equal(modelForResearchTask({ HERMES_DEFAULT_MODEL: "qwen-plus" }, "nonexistent_task"), "qwen-plus");
  // unknown task + no default -> DEFAULT_LLM_MODEL
  assert.equal(modelForResearchTask({}, "nonexistent_task"), DEFAULT_LLM_MODEL);
});

test("HERMES_MODELS_JSON override precedence beats content-policy defaults", () => {
  assert.equal(
    modelForResearchTask(
      {
        HERMES_MODELS_JSON: JSON.stringify({ critic_review: "moonshot-v1-32k" }),
        HERMES_DEFAULT_MODEL: "kimi-k2.6",
      },
      "critic_review",
    ),
    "moonshot-v1-32k",
  );
});
