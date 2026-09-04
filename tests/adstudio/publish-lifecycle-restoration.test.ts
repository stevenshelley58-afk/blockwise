import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishRoute = readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8");
const activateRoute = readFileSync("src/app/api/adstudio/ads/[id]/activate/route.ts", "utf8");

test("publish creates a paused receipt and never invokes activation", () => {
  assert.doesNotMatch(publishRoute, /activatePausedMetaPublish/);
  assert.match(publishRoute, /status: "paused"/);
  assert.match(publishRoute, /Created on Meta in PAUSED state/);
  assert.match(publishRoute, /applyMetaPublishExecutionResult\([\s\S]*result\)/);
  assert.match(publishRoute, /loadMetaPublishPlan/);
  assert.match(publishRoute, /claimMetaPublishExecution/);
  assert.match(publishRoute, /releaseMetaPublishExecutionLease/);
  assert.match(publishRoute, /export async function GET/);
});

test("activate requires the exact plan returned by publish", () => {
  assert.match(activateRoute, /if \(!planId\)[\s\S]*plan_id_required/);
  assert.match(activateRoute, /loadMetaPublishPlan\(serviceSupabase, \{[\s\S]*planId,[\s\S]*\}\)/);
  assert.doesNotMatch(activateRoute, /loadLatestPublishPlanForAd/);
  assert.match(activateRoute, /plan\.adStudioCampaignId !== id/);
  assert.match(activateRoute, /controlsFingerprint/);
  assert.match(activateRoute, /clientMutationKey/);
  assert.match(activateRoute, /mutationId: clientMutationKey/);
  assert.match(activateRoute, /claimMetaPublishExecution/);
  assert.match(activateRoute, /releaseMetaPublishExecutionLease/);
  assert.match(activateRoute, /activation_unconfirmed/);
  assert.match(activateRoute, /outcome_status: outcomeStatus/);
  assert.match(activateRoute, /unconfirmed_pause_ids_json: unconfirmedPauseIds/);
  assert.match(activateRoute, /status: "activating"/);
});
