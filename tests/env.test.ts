import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_ENV_KEYS,
  RECOMMENDED_SECURITY_ENV_KEYS,
  getMissingRecommendedSecurityEnvKeys,
} from "../src/lib/config/env.ts";

test("required environment keys include OpenRouter for live model routing", () => {
  assert.equal(REQUIRED_ENV_KEYS.includes("OPENROUTER_API_KEY"), true);
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
