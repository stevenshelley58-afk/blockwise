import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_ENV_KEYS,
  REQUIRED_ENV_KEYS,
  RECOMMENDED_SECURITY_ENV_KEYS,
  getInvalidEnvKeys,
  getMissingRecommendedSecurityEnvKeys,
  getProviderReadiness,
  parseEnvFile,
} from "../src/lib/config/env.ts";

test("required environment keys include OpenRouter for live model routing", () => {
  assert.equal(REQUIRED_ENV_KEYS.includes("OPENROUTER_API_KEY"), true);
  assert.equal(REQUIRED_ENV_KEYS.includes("META_APP_SECRET"), true);
});

test("Google Ads keys are tracked as provider-scoped, not core required, so a Meta-only deploy can report ready", () => {
  assert.equal(REQUIRED_ENV_KEYS.includes("GOOGLE_CLIENT_ID" as never), false);
  assert.equal(REQUIRED_ENV_KEYS.includes("GOOGLE_ADS_DEVELOPER_TOKEN" as never), false);

  assert.deepEqual(PROVIDER_ENV_KEYS.google, [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ]);

  const readiness = getProviderReadiness("google", {} as NodeJS.ProcessEnv);
  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.missing, [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ]);
});

test("recommended security environment keys cover Cloudflare AI Gateway, egress, and audit drains", () => {
  assert.deepEqual(RECOMMENDED_SECURITY_ENV_KEYS, [
    "CLOUDFLARE_AI_GATEWAY_URL",
    "CLOUDFLARE_AI_GATEWAY_TOKEN",
    "AGENT_ALLOWED_OUTBOUND_DOMAINS",
    "SECURITY_AUDIT_LOG_DRAIN_URL",
  ]);
});

test("getMissingRecommendedSecurityEnvKeys reports non-blocking production hardening gaps", () => {
  assert.deepEqual(
    getMissingRecommendedSecurityEnvKeys({
      NODE_ENV: "test",
      CLOUDFLARE_AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway",
      CLOUDFLARE_AI_GATEWAY_TOKEN: "token",
    } as NodeJS.ProcessEnv),
    ["AGENT_ALLOWED_OUTBOUND_DOMAINS", "SECURITY_AUDIT_LOG_DRAIN_URL"],
  );
});

test("getInvalidEnvKeys treats placeholder production secrets as invalid", () => {
  const base = Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, `${key.toLowerCase()}_value`])) as NodeJS.ProcessEnv;

  assert.deepEqual(
    getInvalidEnvKeys({
      ...base,
      OPENAI_API_KEY: "replace_me",
      OPENROUTER_API_KEY: "",
      META_APP_SECRET: "proj_replace_me",
    }),
    ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "META_APP_SECRET"],
  );
});

test("parseEnvFile loads local dotenv values without exposing secrets", () => {
  assert.deepEqual(
    parseEnvFile(`
NEXT_PUBLIC_APP_URL=http://localhost:3000
OPENAI_API_KEY="sk-test"
EMPTY=
# ignored
`),
    {
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      OPENAI_API_KEY: "sk-test",
      EMPTY: "",
    },
  );
});
