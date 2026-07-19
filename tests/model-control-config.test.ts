import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelControlViewData,
  buildModelProfileVersionInsert,
  getCuratedModelOptionsForProfile,
  getDirectProviderReadiness,
  validateModelProfileSelection,
} from "../src/lib/ai/model-control-config.ts";

test("Model Control accepts only curated direct OpenAI or Gemini selections", () => {
  assert.equal(validateModelProfileSelection("structured_json", { provider: "openai", model: "gpt-5.5" }).ok, true);
  assert.equal(validateModelProfileSelection("structured_json", { provider: "google", model: "gemini-2.5-flash-lite" }).ok, true);
  const unsupported = validateModelProfileSelection("structured_json", { provider: "retired", model: "anything" });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.error, /Only direct OpenAI or Gemini/);
});

test("curated image options are the two pinned direct image models", () => {
  assert.deepEqual(
    getCuratedModelOptionsForProfile("image_final").map(({ provider, model }) => [provider, model]),
    [["openai", "gpt-image-2"], ["google", "gemini-3.1-flash-image"]],
  );
});

test("version inserts preserve direct provider metadata", () => {
  const selected = getCuratedModelOptionsForProfile("cheap_draft_text")[0];
  assert.deepEqual(buildModelProfileVersionInsert("profile", selected), {
    model_profile_id: "profile", provider: "openai", model: "gpt-4.1-mini",
    input_usd_per_million_tokens: 0.4, output_usd_per_million_tokens: 1.6,
    image_usd_per_unit: 0, supports_structured_output: true, max_context_tokens: 128_000,
  });
});

test("readiness reports both direct credentials without exposing values", () => {
  const readiness = getDirectProviderReadiness({ OPENAI_API_KEY: "secret" });
  assert.deepEqual(readiness.openai, { configured: true, missing: [] });
  assert.deepEqual(readiness.google, { configured: false, missing: ["GOOGLE_AI_API_KEY"] });
  assert.equal(JSON.stringify(readiness).includes("secret"), false);
});

test("Model Control shows pinned Fast and High Quality modes without fallback columns", () => {
  const data = buildModelControlViewData();
  assert.deepEqual(data.generationModes, [
    { key: "fast", label: "Fast", copy: "google / gemini-2.5-flash-lite", image: "google / gemini-3.1-flash-image", qa: "google / gemini-2.5-flash-lite" },
    { key: "high", label: "High quality", copy: "openai / gpt-5.5", image: "openai / gpt-image-2", qa: "openai / gpt-5.5" },
  ]);
  assert.deepEqual(data.sections.map((section) => section.label), ["Research", "Campaigns", "Creative", "Compliance"]);
});
