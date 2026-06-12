import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("recommended security environment keys cover Turnstile and Cloudflare AI Gateway", () => {
  assert.deepEqual(RECOMMENDED_SECURITY_ENV_KEYS, [
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "CLOUDFLARE_AI_GATEWAY_URL",
    "CLOUDFLARE_AI_GATEWAY_TOKEN",
  ]);
});

test("getMissingRecommendedSecurityEnvKeys reports non-blocking production hardening gaps", () => {
  assert.deepEqual(
    getMissingRecommendedSecurityEnvKeys({
      NODE_ENV: "test",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAABtest",
      CLOUDFLARE_AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway",
      CLOUDFLARE_AI_GATEWAY_TOKEN: "token",
    } as NodeJS.ProcessEnv),
    [],
  );
});

test(".env.example documents app-read env vars and omits retired ones", () => {
  const example = readFileSync(".env.example", "utf8");

  for (const key of [
    "CLOUDFLARE_AI_GATEWAY_URL",
    "CLOUDFLARE_AI_GATEWAY_TOKEN",
    "OPERATOR_EMAILS",
    "BLOCKWISE_DEV_PASSWORD",
    "GOOGLE_ADS_ENABLED",
    "META_MONITOR_BUDGET_AUD",
    "NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA",
  ]) {
    assert.match(example, new RegExp(`^${key}=`, "m"));
  }

  assert.doesNotMatch(example, /^SUPABASE_(?:DB_URL|JWT_SECRET)=/m);
  assert.doesNotMatch(example, new RegExp(`^${"SENTRY"}_${"AUTH_TOKEN"}=`, "m"));
  assert.doesNotMatch(example, /^NEXT_PUBLIC_POSTHOG_/m);
  assert.doesNotMatch(example, /^(?:AGENT_ALLOWED|SECURITY_AUDIT)_/m);
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

test("Vercel release gate blocks deploys on env, test, typecheck, or build failures", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { buildCommand?: string };

  assert.equal(vercel.buildCommand, "npm run verify-env && npm run check && npm run build");
});

test("Vercel route bundles are loadable by the CommonJS serverless launcher", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { type?: string };

  assert.notEqual(
    pkg.type,
    "module",
    'root package.json must not force emitted Next route ".js" bundles to be treated as ESM on Vercel',
  );
});
