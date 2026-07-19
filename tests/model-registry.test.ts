import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateRunCostUsd,
  resolveEffectiveModelProfile,
  resolveModelProfile,
  resolveModelProfileForData,
  shouldBlockForCostPolicy,
} from "../src/lib/ai/model-registry.ts";

test("runtime defaults use one direct provider candidate per profile", () => {
  assert.deepEqual(
    ["cheap_draft_text", "high_quality_strategy", "structured_json", "vision_classification", "image_draft", "image_final", "compliance_review"].map((key) => {
      const resolved = resolveModelProfile(key as never);
      return [key, resolved.primary.provider, resolved.primary.model];
    }),
    [
      ["cheap_draft_text", "openai", "gpt-4.1-mini"],
      ["high_quality_strategy", "openai", "gpt-5.5"],
      ["structured_json", "openai", "gpt-5.5"],
      ["vision_classification", "openai", "gpt-5.5"],
      ["image_draft", "google", "gemini-3.1-flash-image"],
      ["image_final", "openai", "gpt-image-2"],
      ["compliance_review", "openai", "gpt-4.1-mini"],
    ],
  );
});

test("a direct persisted version replaces the one default candidate", () => {
  const resolved = resolveEffectiveModelProfile("cheap_draft_text", [{
    id: "33333333-3333-4333-8333-333333333333",
    profileKey: "cheap_draft_text",
    provider: "google",
    model: "gemini-2.5-flash-lite",
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
    imageUsdPerUnit: 0,
    supportsStructuredOutput: true,
    maxContextTokens: 1_048_576,
    maxLatencyMs: 8_000,
  }]);
  assert.equal(resolved.primary.provider, "google");
  assert.equal(resolved.primary.model, "gemini-2.5-flash-lite");
  assert.equal(resolved.primary.modelProfileVersionId, "33333333-3333-4333-8333-333333333333");
});

test("sensitive data keeps the same approved direct candidate", () => {
  const resolved = resolveModelProfileForData("structured_json", { dataClasses: ["lead_pii"] });
  assert.equal(resolved.primary.provider, "openai");
  assert.equal(resolved.primary.model, "gpt-5.5");
});

test("cost estimation and kill switches remain enforced", () => {
  assert.equal(estimateRunCostUsd(resolveModelProfile("image_final").primary, {
    inputTokens: 2_000, outputTokens: 500, imageUnits: 2,
  }), 0.447);
  assert.equal(shouldBlockForCostPolicy("cheap_draft_text", { estimatedCostUsd: 0.02 }).blocked, false);
  assert.equal(shouldBlockForCostPolicy("disabled_profile", { estimatedCostUsd: 0.01 }).blocked, true);
});
