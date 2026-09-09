import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const env = readFileSync(".env.example", "utf8");
const runbook = readFileSync("docs/runbooks/progressive-onboarding-rollout.md", "utf8");

// The BLOCKWISE_PROGRESSIVE_* env flags were documentation-only: no code ever
// read them, so advertising them as gates was misleading (an operator setting
// them to false believed the funnel was gated when it was fully live). The
// rollout completed and the flags were removed from .env.example.
test("dead progressive rollout flags stay deleted from .env.example", () => {
  assert.doesNotMatch(env, /BLOCKWISE_PROGRESSIVE_/);
});

test("runbook orders every progressive migration before exposure", () => {
  const migrations = [
    "202607270002_progressive_activation_credit_ledger.sql",
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
