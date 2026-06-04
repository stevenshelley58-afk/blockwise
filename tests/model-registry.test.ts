import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateRunCostUsd,
  normalizeModelSlug,
  resolveEffectiveModelProfile,
  resolveModelProfile,
  resolveModelProfileForData,
  shouldBlockForCostPolicy,
} from "../src/lib/ai/model-registry.ts";

test("resolveModelProfile returns the active model and ordered fallback chain for a task", () => {
  const resolved = resolveModelProfile("structured_json");

  assert.equal(resolved.profile.key, "structured_json");
  assert.equal(resolved.primary.model, "gpt-4.1-mini");
  assert.deepEqual(
    resolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-4.1", "google/gemini-2.0-flash-001"],
  );
  assert.equal(resolved.profile.requiresStructuredOutput, true);
});

test("client-facing strategy profile uses the premium copywriting model", () => {
  const resolved = resolveModelProfile("high_quality_strategy");

  assert.equal(resolved.primary.provider, "openai");
  assert.equal(resolved.primary.model, "gpt-5.5");
  assert.deepEqual(
    resolved.fallbacks.map((candidate) => `${candidate.provider}/${candidate.model}`),
    ["openrouter/openai/gpt-5.5"],
  );
});

test("normalizeModelSlug stores OpenRouter model ids without the legacy openrouter prefix", () => {
  assert.equal(
    normalizeModelSlug("openrouter", "openrouter/google/gemini-2.0-flash-001"),
    "google/gemini-2.0-flash-001",
  );
  assert.equal(normalizeModelSlug("openai", "gpt-4.1-mini"), "gpt-4.1-mini");
});

test("resolveEffectiveModelProfile prefers a saved model version over static defaults", () => {
  const resolved = resolveEffectiveModelProfile("cheap_draft_text", [
    {
      profileKey: "cheap_draft_text",
      provider: "openrouter",
      model: "openrouter/google/gemini-2.0-flash-001",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 1_000_000,
      maxLatencyMs: 8_000,
    },
  ]);

  assert.equal(resolved.primary.provider, "openrouter");
  assert.equal(resolved.primary.model, "google/gemini-2.0-flash-001");
});

test("estimateRunCostUsd accounts for text input, text output, and image units", () => {
  const resolved = resolveModelProfile("image_final");
  const cost = estimateRunCostUsd(resolved.primary, {
    inputTokens: 2_000,
    outputTokens: 500,
    imageUnits: 2,
  });

  assert.equal(cost, 0.45);
});

test("resolveModelProfileForData removes public-only fallbacks for sensitive client data", () => {
  const publicResolved = resolveModelProfileForData("structured_json", {
    dataClasses: ["public_competitor_data"],
  });

  assert.deepEqual(
    publicResolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-4.1", "google/gemini-2.0-flash-001"],
  );

  const sensitiveResolved = resolveModelProfileForData("structured_json", {
    dataClasses: ["lead_pii"],
  });

  assert.deepEqual(
    sensitiveResolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-4.1", "google/gemini-2.0-flash-001"],
  );
});

test("resolveModelProfileForData blocks sensitive runs when the primary provider is not approved for client data", () => {
  assert.throws(
    () => resolveModelProfileForData("disabled_profile", { dataClasses: ["lead_pii"] }),
    /Model profile disabled_profile is disabled by operator kill switch/,
  );
});

test("shouldBlockForCostPolicy blocks disabled profiles and requests over per-run limits", () => {
  assert.equal(
    shouldBlockForCostPolicy("cheap_draft_text", { estimatedCostUsd: 0.02 }).blocked,
    false,
  );

  assert.deepEqual(shouldBlockForCostPolicy("image_final", { estimatedCostUsd: 3.5 }), {
    blocked: true,
    reason: "Estimated run cost $3.50 exceeds image_final max run cost $2.00.",
  });

  assert.deepEqual(shouldBlockForCostPolicy("disabled_profile", { estimatedCostUsd: 0.01 }), {
    blocked: true,
    reason: "Model profile disabled_profile is disabled by operator kill switch.",
  });
});
