import assert from "node:assert/strict";
import test from "node:test";

import { loadPersistedModelProfileVersions } from "../src/lib/ai/model-profile-store.ts";
import {
  isRetryableProviderFailure,
  modelCandidateForProfile,
  resolveRuntimeProfileFromVersions,
} from "../src/lib/operator/prompts/model-profile-runtime.ts";

function client(result: { data: unknown; error: { message: string } | null }) {
  const query = { select() { return this; }, is() { return this; }, async order() { return result; } };
  return { from() { return query; } };
}

test("persisted profile loading fails closed on database and unsupported-provider configuration", async () => {
  await assert.rejects(() => loadPersistedModelProfileVersions(client({ data: null, error: { message: "down" } }) as never), /down/);
  await assert.rejects(() => loadPersistedModelProfileVersions(client({ error: null, data: [{
    id: "11111111-1111-4111-8111-111111111111", provider: "retired", model: "model",
    input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2, image_usd_per_unit: 0,
    supports_structured_output: true, max_context_tokens: 1000, model_profiles: { key: "structured_json" },
  }] }) as never), /Operator configuration error.*unsupported provider retired/);
});

test("runtime profile exposes exactly its selected candidate", () => {
  const profile = resolveRuntimeProfileFromVersions("image_final", []);
  assert.equal(profile.source, "default");
  assert.equal(modelCandidateForProfile(profile), profile.primary);
});

test("same-model retryability remains explicit", () => {
  assert.equal(isRetryableProviderFailure(new Error("generic")), false);
  assert.equal(isRetryableProviderFailure({ retryable: false }), false);
  assert.equal(isRetryableProviderFailure({ retryable: true }), true);
});
