import assert from "node:assert/strict";
import test from "node:test";

import {
  adPacksForRenders,
  loadTrialStatus,
} from "../src/lib/trial/trial-status.ts";

test("trial status converts the wallet-backed one-pack RPC into two render credits", async () => {
  const status = await loadTrialStatus(
    async () => ({
      data: [{
        plan_key: "trial",
        ad_packs_used: 0,
        ad_packs_limit: 1,
        ad_packs_remaining: 1,
        trial_days_remaining: 5,
        trial_expired: false,
      }],
      error: null,
    }),
    "workspace-1",
  );

  assert.deepEqual(status, {
    isTrial: true,
    trialState: null,
    includedRenders: 2,
    usedRenders: 0,
    remainingRenders: 2,
    planName: null,
    trialEndsAt: null,
    trialDaysRemaining: 5,
    trialExpired: false,
    upgradeHref: "/settings#billing",
  });
  assert.equal(adPacksForRenders(status.remainingRenders), 1);
});

test("trial status fails closed for stale three-pack, ten-pack or non-wallet responses", async () => {
  const staleStatus = await loadTrialStatus(
    async () => ({
      data: [{
        plan_key: "trial",
        ad_packs_used: 0,
        ad_packs_limit: 10,
        ad_packs_remaining: 10,
      }],
      error: null,
    }),
    "workspace-1",
  );
  const retiredStatus = await loadTrialStatus(
    async () => ({
      data: [{
        plan_key: "trial",
        ad_packs_used: 1,
        ad_packs_limit: 3,
        ad_packs_remaining: 2,
      }],
      error: null,
    }),
    "workspace-1",
  );
  const missingStatus = await loadTrialStatus(
    async () => ({ data: null, error: null }),
    "workspace-1",
  );

  assert.equal(staleStatus, null);
  assert.equal(retiredStatus, null);
  assert.equal(missingStatus, null);
});
