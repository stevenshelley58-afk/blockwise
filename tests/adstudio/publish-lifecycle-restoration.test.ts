import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishRoute = readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8");
const activateRoute = readFileSync("src/app/api/adstudio/ads/[id]/activate/route.ts", "utf8");
const resultsPage = readFileSync("src/app/(customer)/results/page.tsx", "utf8");
const resultsDashboard = readFileSync("src/components/monitor/MetaMonitorDashboard.tsx", "utf8");
const mutationWorker = readFileSync("src/lib/providers/meta-mutation-worker.ts", "utf8");

test("publish creates a paused receipt and never invokes activation", () => {
  assert.doesNotMatch(publishRoute, /activatePausedMetaPublish/);
  assert.match(publishRoute, /status: "paused"/);
  assert.match(publishRoute, /Created on Meta in PAUSED state/);
  assert.match(publishRoute, /applyMetaPublishExecutionResult\([\s\S]*result\)/);
  assert.match(publishRoute, /loadMetaPublishPlan/);
  assert.match(publishRoute, /claimMetaPublishExecution/);
  assert.match(publishRoute, /releaseMetaPublishExecutionLease/);
  assert.match(publishRoute, /renewMetaPublishExecutionLease/);
  assert.match(publishRoute, /createMetaExecutionLeaseHeartbeat/);
  assert.match(publishRoute, /fetchImpl: leaseHeartbeat\.fetch/);
  assert.match(publishRoute, /summarizePersistedPublishSource/);
  assert.match(publishRoute, /export async function GET/);
});

test("activate requires the exact plan returned by publish", () => {
  assert.match(activateRoute, /if \(!planId\)[\s\S]*plan_id_required/);
  assert.match(activateRoute, /loadMetaPublishPlan\(serviceSupabase, \{[\s\S]*planId,[\s\S]*\}\)/);
  assert.doesNotMatch(activateRoute, /loadLatestPublishPlanForAd/);
  assert.match(activateRoute, /plan\.adStudioCampaignId !== id/);
  assert.match(activateRoute, /controlsFingerprint/);
  assert.match(activateRoute, /clientMutationKey/);
  assert.match(activateRoute, /ensureMetaActivationMutation/);
  assert.match(activateRoute, /claimMetaPublishExecution/);
  assert.match(activateRoute, /releaseMetaPublishExecutionLease/);
  assert.match(activateRoute, /renewMetaPublishExecutionLease/);
  assert.match(activateRoute, /createMetaExecutionLeaseHeartbeat/);
  assert.match(activateRoute, /fetchImpl: leaseHeartbeat\.fetch,[\s\S]*compensationFetchImpl: fetch/);
  assert.match(activateRoute, /onCheckpoint/);
  assert.match(activateRoute, /activation_unconfirmed/);
  assert.match(mutationWorker, /finalize_meta_publish_plan_mutation/);
  assert.match(mutationWorker, /outcome_status: "unconfirmed"/);
  assert.match(activateRoute, /status: "activating"/);
});

test("results resolves and focuses the campaign owned by the exact publish plan", () => {
  assert.match(resultsPage, /resolvedParams\.planId/);
  assert.match(resultsPage, /from\("meta_publish_plans"\)[\s\S]*eq\("workspace_id", access\.workspaceId\)[\s\S]*eq\("id", requestedPlanId\)/);
  assert.match(resultsPage, /focusCampaignId=\{focusCampaignId\}/);
  assert.match(resultsDashboard, /campaignRowDomId\(focusCampaignId\)/);
  assert.match(resultsDashboard, /Showing the campaign created by this publish plan/);
});
