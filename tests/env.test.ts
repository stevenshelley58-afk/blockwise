import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_ENV_KEYS,
  RECOMMENDED_SECURITY_ENV_KEYS,
  getInvalidEnvKeys,
  getMissingRecommendedSecurityEnvKeys,
  parseEnvFile,
} from "../src/lib/config/env.ts";

test("required environment keys include OpenRouter for live model routing", () => {
  assert.equal(REQUIRED_ENV_KEYS.includes("OPENROUTER_API_KEY"), true);
  assert.equal(REQUIRED_ENV_KEYS.includes("GOOGLE_ADS_DEVELOPER_TOKEN"), true);
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
