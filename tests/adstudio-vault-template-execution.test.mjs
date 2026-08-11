import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertVpsTemplateExecutionContext,
  loadVaultGoogleProviderEnvironment,
  lockedPacketImageRequest,
} from "../scripts/adstudio/vault-template-execution.mjs";

const vpsEnv = {
  BLOCKWISE_TEMPLATE_EXECUTION_CONTEXT: "vps",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
};

test("vault template execution refuses non-VPS and non-service-role contexts", () => {
  assert.throws(() => assertVpsTemplateExecutionContext({ ...vpsEnv, BLOCKWISE_TEMPLATE_EXECUTION_CONTEXT: "local" }), /explicit VPS execution context/);
  assert.throws(() => assertVpsTemplateExecutionContext({ ...vpsEnv, VERCEL: "1" }), /explicit VPS execution context/);
  const { SUPABASE_SECRET_KEY: _removed, ...withoutServiceRole } = vpsEnv;
  assert.throws(() => assertVpsTemplateExecutionContext(withoutServiceRole), /service-role credential/);
});

test("vault template execution fails closed when Google is not provisioned", async () => {
  await assert.rejects(() => loadVaultGoogleProviderEnvironment({
    env: vpsEnv,
    createServiceClient: () => ({ rpc() {} }),
    loadToken: async (_client: unknown, provider: string) => {
      assert.equal(provider, "google");
      return null;
    },
  }), /encrypted Google runtime credential is not provisioned/);
});

test("vault execution reuses the exact exported packet request and reference order", () => {
  const packet = {
    prompt: "Exact buildCloneImageRequest prompt",
    negativePrompt: "Exact negatives",
    aspectRatio: "4:5",
    seed: 17,
    references: [{ path: "source.png" }, { path: "replacement.png" }],
  };
  const references = ["data:image/png;base64,c291cmNl", "data:image/png;base64,cmVwbGFjZW1lbnQ="];
  assert.deepEqual(lockedPacketImageRequest(packet, references), {
    prompt: packet.prompt,
    negativePrompt: packet.negativePrompt,
    referenceAssets: references,
    aspectRatio: packet.aspectRatio,
    stylePreset: "real_estate_clone",
    seed: packet.seed,
    requiresReferenceAssets: true,
  });
});

test("the vault bridge never logs, serializes, or persists its credential", async () => {
  const source = readFileSync("scripts/adstudio/vault-template-execution.mjs", "utf8");
  const command = readFileSync("scripts/adstudio/create-template.mjs", "utf8");
  assert.doesNotMatch(source, /console\.|writeFile|JSON\.stringify/);
  assert.match(command, /createGoogleImageProvider\([\s\S]*env: options\.providerEnv/);
  assert.doesNotMatch(command, /console\.[^(]*\([^\n]*(?:providerEnv|GOOGLE_AI_API_KEY|assetUrl|data:image)/);
  assert.match(command, /verifyLockedClonePacket\(packet, \{ root \}\)/);
  assert.match(command, /existsSync\(outputPath\) \|\| existsSync\(rawPath\) \|\| existsSync\(manifestPath\)/);
  assert.match(command, /outputSha256: sha256\(normalized\)/);
  assert.match(command, /providerRequestId:/);
  assert.match(command, /requestHash: verified\.requestHash/);
  const secret = "google-secret-never-log";
  const providerEnv = await loadVaultGoogleProviderEnvironment({
    env: vpsEnv,
    createServiceClient: () => ({ rpc() {} }),
    loadToken: async () => secret,
  });
  assert.deepEqual(providerEnv, { GOOGLE_AI_API_KEY: secret });
  assert.equal(Object.keys(providerEnv).length, 1);
});

test("quality-tier migration fails before closing versions when image_final is missing", () => {
  const migration = readFileSync("supabase/migrations/20260811100000_adstudio_gemini_quality_escalation.sql", "utf8");
  const guard = migration.indexOf("image_final model profile is missing");
  const closeVersions = migration.indexOf("set active_to = now()");
  assert.ok(guard >= 0 && guard < closeVersions);
  assert.match(migration, /if not exists \(select 1 from public\.model_profiles where key = 'image_final'\)/);
});
