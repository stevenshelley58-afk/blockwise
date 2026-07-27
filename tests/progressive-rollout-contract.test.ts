import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const env = readFileSync(".env.example", "utf8");
const runbook = readFileSync("docs/runbooks/progressive-onboarding-rollout.md", "utf8");

const flags = [
  "BLOCKWISE_PROGRESSIVE_FOUNDATIONS_ENABLED",
  "BLOCKWISE_PROGRESSIVE_ACTIVATION_ENABLED",
  "BLOCKWISE_PROGRESSIVE_BILLING_ENABLED",
  "BLOCKWISE_PROGRESSIVE_PUBLIC_LAUNCH_ENABLED",
  "BLOCKWISE_PROGRESSIVE_MARKETS",
  "BLOCKWISE_PROGRESSIVE_EXPOSURE_PERCENT",
] as const;

test("progressive rollout flags are documented with fail-closed defaults", () => {
  for (const flag of flags) {
    assert.match(env, new RegExp(`^${flag}=`, "m"));
    assert.match(runbook, new RegExp(`\\\`${flag}\\\``));
  }
  assert.match(env, /^BLOCKWISE_PROGRESSIVE_FOUNDATIONS_ENABLED=false$/m);
  assert.match(env, /^BLOCKWISE_PROGRESSIVE_ACTIVATION_ENABLED=false$/m);
  assert.match(env, /^BLOCKWISE_PROGRESSIVE_BILLING_ENABLED=false$/m);
  assert.match(env, /^BLOCKWISE_PROGRESSIVE_PUBLIC_LAUNCH_ENABLED=false$/m);
  assert.match(env, /^BLOCKWISE_PROGRESSIVE_MARKETS=$/m);
  assert.match(env, /^BLOCKWISE_PROGRESSIVE_EXPOSURE_PERCENT=0$/m);
});

test("runbook orders every progressive migration before exposure", () => {
  const migrations = [
    "202607270001_progressive_activation_credit_ledger.sql",
    "20260727022000_progressive_billing_foundation.sql",
    "20260727023000_meta_free_live_claim_registry.sql",
    "20260727024000_onboarding_booking_foundation.sql",
    "20260727025000_paid_team_seat_enforcement.sql",
    "20260727026000_billing_event_security_hardening.sql",
    "20260727028000_progressive_funnel_analytics.sql",
    "20260727029000_verified_trial_workspace_bootstrap.sql",
  ];

  let previous = -1;
  for (const migration of migrations) {
    const position = runbook.indexOf(migration);
    assert.ok(position > previous, `${migration} must be present in order`);
    previous = position;
  }
});

test("runbook covers regional providers, preview gates, staged exposure, and rollback", () => {
  for (const required of [
    "Stripe test clocks",
    "CALCOM_ONBOARDING_URL_US",
    "CALCOM_ONBOARDING_URL_AU",
    "BLOCKWISE_ENABLE_PROVIDER_WRITES",
    "1440x900",
    "390x844",
    "320px",
    "Staged exposure",
    "Rollback",
  ]) {
    assert.match(runbook, new RegExp(required));
  }
});
