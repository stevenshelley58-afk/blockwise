import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelControlViewData,
  buildModelProfileVersionInsert,
  getCuratedModelOptionsForProfile,
  getOpenRouterReadiness,
  validateModelProfileSelection,
} from "../src/lib/ai/model-control-config.ts";

test("validateModelProfileSelection rejects unknown profile keys", () => {
  const result = validateModelProfileSelection("unknown_profile", {
    provider: "openrouter",
    model: "google/gemini-2.0-flash-001",
  });

  assert.deepEqual(result, {
    ok: false,
    status: 404,
    error: "Unknown model profile: unknown_profile",
  });
});

test("validateModelProfileSelection rejects uncurated model ids", () => {
  const result = validateModelProfileSelection("cheap_draft_text", {
    provider: "openrouter",
    model: "not-approved/model",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /not approved for Cheap draft text/);
});

test("curated structured-output profiles expose OpenRouter slugs and capabilities", () => {
  const options = getCuratedModelOptionsForProfile("structured_json");
  const gemini = options.find((option) => option.model === "google/gemini-2.0-flash-001");

  assert.ok(gemini);
  assert.equal(gemini.provider, "openrouter");
  assert.equal(gemini.supportsStructuredOutput, true);
  assert.equal(gemini.supportsVisionInput, true);
  assert.equal(gemini.supportsImageOutput, false);
});

test("curated high-quality strategy options lead with the premium copy model", () => {
  const options = getCuratedModelOptionsForProfile("high_quality_strategy");

  assert.equal(options[0].provider, "openrouter");
  assert.equal(options[0].model, "openai/gpt-5.5");
  assert.equal(options[0].supportsStructuredOutput, true);
});

test("curated final image options include GPT Image 2 and Nano Banana", () => {
  const options = getCuratedModelOptionsForProfile("image_final");

  assert.equal(options[0].model, "openai/gpt-5.4-image-2");
  assert.equal(options[0].supportsImageOutput, true);
  assert.equal(options[1].model, "google/gemini-3.1-flash-image-preview");
  assert.equal(options[1].supportsImageOutput, true);
});

test("curated fast image options lead with the benchmarked Gemini edit model", () => {
  const options = getCuratedModelOptionsForProfile("image_draft");

  assert.equal(options[0].provider, "fal");
  assert.equal(options[0].model, "fal-ai/gemini-3.1-flash-image-preview/edit");
  assert.equal(options[0].supportsVisionInput, true);
  assert.equal(options[0].supportsImageOutput, true);
});

test("buildModelProfileVersionInsert maps a selected option to Supabase columns", () => {
  const option = getCuratedModelOptionsForProfile("cheap_draft_text").find(
    (candidate) => candidate.model === "google/gemini-2.0-flash-001",
  );

  assert.ok(option);

  const insert = buildModelProfileVersionInsert("profile_id_123", option);

  assert.deepEqual(insert, {
    model_profile_id: "profile_id_123",
    provider: "openrouter",
    model: "google/gemini-2.0-flash-001",
    input_usd_per_million_tokens: 0.1,
    output_usd_per_million_tokens: 0.4,
    image_usd_per_unit: 0,
    supports_structured_output: true,
    max_context_tokens: 1_000_000,
  });
});

test("getOpenRouterReadiness reports missing API key without leaking configured values", () => {
  assert.deepEqual(getOpenRouterReadiness({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }), {
    configured: false,
    missing: ["OPENROUTER_API_KEY"],
    appUrl: "http://localhost:3000",
  });

  const configured = getOpenRouterReadiness({
    OPENROUTER_API_KEY: "sk-or-v1-secret",
    NEXT_PUBLIC_APP_URL: "https://blockwise.example",
  });

  assert.deepEqual(configured, {
    configured: true,
    missing: [],
    appUrl: "https://blockwise.example",
  });
  assert.equal(JSON.stringify(configured).includes("sk-or-v1-secret"), false);
});

test("buildModelControlViewData keeps every app-area section visible", () => {
  const data = buildModelControlViewData();

  assert.deepEqual(
    data.sections.map((section) => section.label),
    ["Research", "Campaigns", "Creative", "Compliance", "Agent Workforce", "Reporting"],
  );
  assert.ok(data.sections.every((section) => section.profiles.length > 0));

  const creative = data.sections.find((section) => section.label === "Creative");
  assert.deepEqual(creative?.profiles.map((profile) => profile.key), ["image_draft", "image_final"]);
});
