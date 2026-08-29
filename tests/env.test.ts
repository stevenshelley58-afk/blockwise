import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FIRST_TESTER_ENV_KEYS,
  PROVIDER_ENV_KEYS,
  REQUIRED_ENV_KEYS,
  RECOMMENDED_SECURITY_ENV_KEYS,
  getDeploymentReadiness,
  getInvalidEnvKeys,
  getInvalidFirstTesterEnvKeys,
  getMissingRecommendedSecurityEnvKeys,
  getProviderReadiness,
  parseEnvFile,
} from "../src/lib/config/env.ts";

test("external AI and Meta credentials are optional provider readiness gates", () => {
  assert.equal(REQUIRED_ENV_KEYS.includes("OPENAI_API_KEY" as never), false);
  assert.equal(REQUIRED_ENV_KEYS.includes("META_APP_SECRET" as never), false);
  assert.deepEqual(PROVIDER_ENV_KEYS.ai, ["OPENAI_API_KEY"]);
  assert.deepEqual(PROVIDER_ENV_KEYS.meta, ["META_APP_ID", "META_APP_SECRET"]);
});

test("Google Ads keys are tracked as provider-scoped, not core required, so a Meta-only deploy can report ready", () => {
  assert.equal(REQUIRED_ENV_KEYS.includes("GOOGLE_CLIENT_ID" as never), false);
  assert.equal(REQUIRED_ENV_KEYS.includes("GOOGLE_ADS_DEVELOPER_TOKEN" as never), false);

  assert.deepEqual(PROVIDER_ENV_KEYS.google, [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ]);

  assert.equal(getProviderReadiness("ai", {} as NodeJS.ProcessEnv).ok, false);
  assert.equal(getProviderReadiness("meta", {} as NodeJS.ProcessEnv).ok, false);

  const readiness = getProviderReadiness("google", {} as NodeJS.ProcessEnv);
  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.missing, [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ]);
});

test("recommended security environment keys cover Turnstile and Cloudflare gateway", () => {
  assert.deepEqual(RECOMMENDED_SECURITY_ENV_KEYS, [
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "CLOUDFLARE_AI_GATEWAY_URL",
    "CLOUDFLARE_AI_GATEWAY_TOKEN",
  ]);
});

test("deployment readiness accepts secret-first or legacy Supabase server credentials", () => {
  const base = Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, `${key.toLowerCase()}_value`])) as NodeJS.ProcessEnv;
  delete base.SUPABASE_SERVICE_ROLE_KEY;

  const secretOnly = getDeploymentReadiness({ ...base, SUPABASE_SECRET_KEY: "sb_secret_test" });
  const missing = getDeploymentReadiness(base);

  assert.equal(secretOnly.invalid.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(secretOnly.missing.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(missing.invalid.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(missing.missing.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
});

test("first-tester environment keys cover launch-critical runtime services", () => {
  assert.deepEqual(FIRST_TESTER_ENV_KEYS, [
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "NEXT_PUBLIC_SENTRY_DSN",
    "CRON_SECRET",
    "RESEND_API_KEY",
    "DEMO_NOTIFY_FROM",
    "DEMO_NOTIFY_TO",
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

test("getInvalidFirstTesterEnvKeys includes boot and first-tester requirements without Cloudflare gateway hard-fail", () => {
  const validBoot = Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, `${key.toLowerCase()}_value`])) as NodeJS.ProcessEnv;
  const readiness = getDeploymentReadiness({
    ...validBoot,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAABtest",
    NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example/1",
    CRON_SECRET: "cron-secret",
    RESEND_API_KEY: "re_test",
    DEMO_NOTIFY_FROM: "Blockwise <notifications@blockwise.sale>",
    DEMO_NOTIFY_TO: "hello@blockwise.sale",
  });

  assert.equal(readiness.firstTester.ok, true);
  assert.equal(readiness.firstTester.invalid.includes("CLOUDFLARE_AI_GATEWAY_URL"), false);
  assert.deepEqual(
    getInvalidFirstTesterEnvKeys({
      ...validBoot,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      NEXT_PUBLIC_SENTRY_DSN: "replace_me",
      CRON_SECRET: "cron-secret",
      RESEND_API_KEY: "",
      DEMO_NOTIFY_FROM: "Blockwise <notifications@blockwise.sale>",
      DEMO_NOTIFY_TO: "hello@blockwise.sale",
    }),
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_SENTRY_DSN", "RESEND_API_KEY"],
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
    "SUPABASE_SECRET_KEY",
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
      TOKEN_ENCRYPTION_KEY: "replace_me",
    }),
    ["TOKEN_ENCRYPTION_KEY"],
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

test("Vercel build command only builds; env, test, and typecheck gates run in CI", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { buildCommand?: string };

  assert.equal(vercel.buildCommand, "npm run build");
});

test("Vercel route bundles are loadable by the CommonJS serverless launcher", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { type?: string };

  assert.notEqual(
    pkg.type,
    "module",
    'root package.json must not force emitted Next route ".js" bundles to be treated as ESM on Vercel',
  );
});
