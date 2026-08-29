import assert from "node:assert/strict";
import test from "node:test";

import { loadPersistedModelProfileVersions } from "../src/lib/ai/model-profile-store.ts";
import {
  isProviderFallbackEligible,
  modelCandidateAttempts,
  resolveRuntimeProfileFromVersions,
} from "../src/lib/operator/prompts/model-profile-runtime.ts";

function modelVersionClient(result: { data: unknown; error: { message: string } | null }) {
  const query = {
    select() { return this; },
    is() { return this; },
    async order() { return result; },
  };
  return { from() { return query; } };
}

test("model profile database errors fail closed instead of masquerading as persisted pricing", async () => {
  await assert.rejects(
    () => loadPersistedModelProfileVersions(
      modelVersionClient({ data: null, error: { message: "database unavailable" } }) as never,
    ),
    /Unable to load active model profile versions: database unavailable/,
  );
});

test("unknown persisted providers are rejected instead of coerced to OpenAI", async () => {
  await assert.rejects(
    () => loadPersistedModelProfileVersions(
      modelVersionClient({
        error: null,
        data: [{
          id: "11111111-1111-4111-8111-111111111111",
          provider: "mystery-provider",
          model: "mystery/model",
          input_usd_per_million_tokens: 1,
          output_usd_per_million_tokens: 2,
          image_usd_per_unit: 0,
          supports_structured_output: true,
          max_context_tokens: 1000,
          model_profiles: { key: "structured_json" },
        }],
      }) as never,
    ),
    /unsupported provider: mystery-provider/,
  );
});

test("runtime profiles distinguish declared defaults from persisted version and pricing ids", () => {
  const fallback = resolveRuntimeProfileFromVersions("image_draft", []);
  assert.equal(fallback.source, "default");
  assert.match(fallback.warning ?? "", /No active persisted version/);

  const persisted = resolveRuntimeProfileFromVersions("image_draft", [{
    id: "22222222-2222-4222-8222-222222222222",
    profileKey: "image_draft",
    provider: "google",
    model: "gemini-2.5-flash-image",
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
    imageUsdPerUnit: 0.039,
    supportsStructuredOutput: false,
    maxContextTokens: 65_536,
    maxLatencyMs: 30_000,
  }]);

  assert.equal(persisted.source, "persisted");
  assert.equal(persisted.primary.modelProfileVersionId, "22222222-2222-4222-8222-222222222222");
  assert.equal(persisted.primary.pricingSnapshotId, "22222222-2222-4222-8222-222222222222");
  assert.equal(persisted.primary.imageUsdPerUnit, 0.039);
});

test("runtime model attempts are bounded by the caller's paid-candidate policy", () => {
  const profile = resolveRuntimeProfileFromVersions("image_final", []);

  assert.equal(profile.fallbacks.length, 2, "the clone registry declares Flash, Pro, then GPT Image");
  assert.deepEqual(
    modelCandidateAttempts(profile).map((candidate) => candidate.model),
    [profile.primary.model, profile.fallbacks[0].model],
  );
  assert.deepEqual(
    modelCandidateAttempts(profile, 3).map((candidate) => candidate.model),
    [profile.primary.model, profile.fallbacks[0].model, profile.fallbacks[1].model],
  );
});

test("provider fallback requires an explicit fallback or retry discriminator", () => {
  assert.equal(isProviderFallbackEligible(new Error("generic failure")), false);
  assert.equal(isProviderFallbackEligible({ retryable: false }), false);
  assert.equal(isProviderFallbackEligible({ retryable: true }), true);
  assert.equal(isProviderFallbackEligible({ retryable: false, fallbackEligible: true }), true);
});
