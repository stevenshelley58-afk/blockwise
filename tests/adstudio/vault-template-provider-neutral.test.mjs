import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertPacketTransportMatchesCandidate,
  loadVaultImageProviderEnvironment,
  resolvePricedImageFinalCandidate,
} from "../../scripts/adstudio/vault-template-execution.mjs";

const env = {
  BLOCKWISE_TEMPLATE_EXECUTION_CONTEXT: "vps",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
};

const profile = {
  primary: { provider: "google", model: "gemini-3.1-flash-image", imageUsdPerUnit: 0.067 },
  fallbacks: [
    { provider: "google", model: "gemini-3-pro-image", imageUsdPerUnit: 0.134 },
    { provider: "openai", model: "gpt-image-2", imageUsdPerUnit: 0.211 },
  ],
};

test("provider-neutral vault lane keeps Google packet compatibility and admits GPT only via generic transport", async () => {
  const google = resolvePricedImageFinalCandidate(profile, 0);
  const openai = resolvePricedImageFinalCandidate(profile, 2);
  assert.doesNotThrow(() => assertPacketTransportMatchesCandidate("google_image_api", google.candidate));
  assert.doesNotThrow(() => assertPacketTransportMatchesCandidate("production_image_api", google.candidate));
  assert.doesNotThrow(() => assertPacketTransportMatchesCandidate("production_image_api", openai.candidate));
  assert.throws(() => assertPacketTransportMatchesCandidate("google_image_api", openai.candidate), /does not permit openai/);
  assert.deepEqual(await loadVaultImageProviderEnvironment("openai", {
    env,
    createServiceClient: () => ({ rpc() {} }),
    loadToken: async (_client, provider) => provider === "openai" ? "openai-test-token" : null,
  }), { OPENAI_API_KEY: "openai-test-token" });
  await assert.rejects(() => loadVaultImageProviderEnvironment("openai", {
    env,
    createServiceClient: () => ({ rpc() {} }),
    loadToken: async () => null,
  }), /encrypted openai runtime credential is not provisioned/);
});

test("provider-neutral vault code never serializes provider credentials", () => {
  const source = readFileSync("scripts/adstudio/vault-template-execution.mjs", "utf8");
  const command = readFileSync("scripts/adstudio/customer-template-fixture.mjs", "utf8");
  assert.doesNotMatch(source, /console\.|writeFile|JSON\.stringify/);
  assert.match(command, /createImageProviderForCandidate\(selected\.candidate/);
  assert.doesNotMatch(command, /console\.[^(]*\([^\n]*(?:providerEnv|OPENAI_API_KEY|GOOGLE_AI_API_KEY|assetUrl|data:image)/);
  assert.match(command, /selectedCandidate:/);
});
