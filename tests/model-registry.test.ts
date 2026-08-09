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

test("resolveModelProfile defaults structured copy to the best text model with a cheaper fallback chain", () => {
  const resolved = resolveModelProfile("structured_json");

  assert.equal(resolved.profile.key, "structured_json");
  // best-by-default now (cost-tune later via the operator console)
  assert.equal(resolved.primary.model, "gpt-5.5");
  assert.deepEqual(
    resolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-4.1"],
  );
  assert.equal(resolved.profile.requiresStructuredOutput, true);
});

test("vision_classification defaults to Gemini vision with an OpenAI fallback", () => {
  const resolved = resolveModelProfile("vision_classification");

  assert.equal(resolved.primary.provider, "google");
  assert.equal(resolved.primary.model, "gemini-3.6-flash");
  assert.equal(resolved.primary.imageUsdPerUnit, 0);
  // OpenAI stays as the fallback so a Google outage never strands the pass.
  assert.deepEqual(
    resolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-5.5"],
  );
});

test("client-facing strategy profile uses the premium copywriting model", () => {
  const resolved = resolveModelProfile("high_quality_strategy");

  assert.equal(resolved.primary.provider, "openai");
  assert.equal(resolved.primary.model, "gpt-5.5");
  assert.deepEqual(resolved.fallbacks, []);
});

test("normalizeModelSlug strips the azure deployment prefix and leaves other providers untouched", () => {
  assert.equal(normalizeModelSlug("azure", "azure/gpt-4.1-mini-vision"), "gpt-4.1-mini-vision");
  assert.equal(normalizeModelSlug("openai", "gpt-4.1-mini"), "gpt-4.1-mini");
});

test("fast image generation defaults to the benchmarked Gemini edit model", () => {
  const resolved = resolveModelProfile("image_draft");

  assert.equal(resolved.primary.provider, "google");
  assert.equal(resolved.primary.model, "gemini-3.1-flash-image");
  assert.deepEqual(resolved.fallbacks.map((candidate) => candidate.model), ["gpt-image-2"]);
});

test("final image generation uses Gemini first and OpenAI only as fallback", () => {
  const resolved = resolveModelProfile("image_final");
  assert.equal(resolved.primary.provider, "google");
  assert.equal(resolved.primary.model, "gemini-3.1-flash-image");
  assert.equal(resolved.fallbacks[0].provider, "openai");
  assert.equal(resolved.fallbacks[0].model, "gpt-image-2");
});

test("resolveEffectiveModelProfile accepts Azure OpenAI deployment overrides", () => {
  const resolved = resolveEffectiveModelProfile("vision_classification", [
    {
      id: "22222222-2222-4222-8222-222222222222",
      profileKey: "vision_classification",
      provider: "azure",
      model: "azure/gpt-4.1-mini-vision",
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      imageUsdPerUnit: 0.01,
      supportsStructuredOutput: true,
      maxContextTokens: 128_000,
      maxLatencyMs: 20_000,
    },
  ]);

  assert.equal(resolved.primary.provider, "azure");
  assert.equal(resolved.primary.model, "gpt-4.1-mini-vision");
});

test("resolveEffectiveModelProfile prefers a saved model version over static defaults", () => {
  const resolved = resolveEffectiveModelProfile("cheap_draft_text", [
    {
      id: "33333333-3333-4333-8333-333333333333",
      profileKey: "cheap_draft_text",
      provider: "google",
      model: "gemini-2.0-flash-001",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 1_000_000,
      maxLatencyMs: 8_000,
    },
  ]);

  assert.equal(resolved.primary.provider, "google");
  assert.equal(resolved.primary.model, "gemini-2.0-flash-001");
});

test("estimateRunCostUsd accounts for text input, text output, and image units", () => {
  const resolved = resolveModelProfile("image_final");
  const cost = estimateRunCostUsd(resolved.primary, {
    inputTokens: 2_000,
    outputTokens: 500,
    imageUnits: 2,
  });

  assert.equal(cost, 0.1365);
});

test("resolveModelProfileForData removes public-only fallbacks for sensitive client data", () => {
  const publicResolved = resolveModelProfileForData("structured_json", {
    dataClasses: ["public_competitor_data"],
  });

  assert.deepEqual(
    publicResolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-4.1"],
  );

  const sensitiveResolved = resolveModelProfileForData("structured_json", {
    dataClasses: ["lead_pii"],
  });

  assert.deepEqual(
    sensitiveResolved.fallbacks.map((candidate) => candidate.model),
    ["gpt-4.1"],
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
