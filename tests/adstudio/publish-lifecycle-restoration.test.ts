import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishRoute = readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8");
const activateRoute = readFileSync("src/app/api/adstudio/ads/[id]/activate/route.ts", "utf8");
const activation = readFileSync("src/lib/providers/adstudio-activation.ts", "utf8");
const resultsPage = readFileSync("src/app/(customer)/results/page.tsx", "utf8");
const resultsDashboard = readFileSync("src/components/monitor/MetaMonitorDashboard.tsx", "utf8");
const mutationWorker = readFileSync("src/lib/providers/meta-mutation-worker.ts", "utf8");

test("legacy creation remains paused while single approval is queued durably", () => {
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
  assert.match(activateRoute, /planId.*controlsFingerprint/);
  assert.match(activation, /loadMetaPublishPlan\(serviceSupabase, \{[\s\S]*planId,[\s\S]*\}\)/);
  assert.doesNotMatch(activation, /loadLatestPublishPlanForAd/);
  assert.match(activation, /plan\.adStudioCampaignId !== id/);
  assert.match(activation, /controlsFingerprint/);
  assert.match(activation, /clientMutationKey/);
  assert.match(activation, /ensureMetaActivationMutation/);
  assert.match(activation, /claimMetaPublishExecution/);
  assert.match(activation, /releaseMetaPublishExecutionLease/);
  assert.match(activation, /renewMetaPublishExecutionLease/);
  assert.match(activation, /createMetaExecutionLeaseHeartbeat/);
  assert.match(activation, /fetchImpl: leaseHeartbeat\.fetch,[\s\S]*compensationFetchImpl: input.compensationFetchImpl/);
  assert.match(activation, /onCheckpoint/);
  assert.match(activation, /activation_unconfirmed/);
  assert.match(mutationWorker, /finalize_meta_publish_plan_mutation/);
  assert.match(mutationWorker, /outcome_status: "unconfirmed"/);
  assert.match(activation, /status: "activating"/);
});

test("stale applying activations are quarantined only after the execution lease expires", () => {
  const leaseClaim = activation.indexOf("const lease = await claimMetaPublishExecution");
  const staleRecovery = activation.indexOf("const staleApplying =");
  assert.ok(leaseClaim >= 0 && staleRecovery > leaseClaim, "the route must test lease ownership before classifying an applying mutation as stale");
  assert.match(activation, /if \(!lease\.claimed \|\| !lease\.leaseToken\)[\s\S]*status: "activating"/);
  assert.match(activation, /finalize_meta_publish_plan_mutation/);
  assert.match(activation, /p_status: "failed"/);
  assert.match(activation, /p_outcome_status: "unconfirmed"/);
  assert.match(activation, /p_unconfirmed_pause_ids: unconfirmedPauseIds/);
  assert.match(activation, /lost its execution lease/);
  assert.match(activation, /quarantineResult\.data !== true[\s\S]*canonicalResult/);
  assert.match(activation, /canonical\.status === "applied"[\s\S]*markPlanObjectsActive\(plan\)/);
});

test("results resolves and focuses the campaign owned by the exact publish plan", () => {
  assert.match(resultsPage, /resolvedParams\.planId/);
  assert.match(resultsPage, /from\("meta_publish_plans"\)[\s\S]*eq\("workspace_id", access\.workspaceId\)[\s\S]*eq\("id", requestedPlanId\)/);
  assert.match(resultsPage, /focusCampaignId=\{focusCampaignId\}/);
  assert.match(resultsDashboard, /campaignRowDomId\(focusCampaignId\)/);
  assert.match(resultsDashboard, /Showing the ad created from your publish plan/);
  assert.match(resultsDashboard, /Manage campaigns and budgets/);
  // The campaigns card opens with the page, on the plan's own campaign when
  // there is one, so the publish hand-off lands on an expanded row.
  assert.match(resultsDashboard, /<details className=\{panelClass\} open>[\s\S]*Manage campaigns and budgets/);
  assert.match(resultsDashboard, /rows\.find\(\(row\) => row\.campaignId === focusCampaignId\) \?\? rows\[0\]/);
});

test("single approval is authenticated, durable and queued before activation", () => {
  assert.match(publishRoute, /delete controls.activationApproval/);
  assert.match(publishRoute, /body.approveAndPublish === true/);
  assert.match(publishRoute, /requestedBy: access.access.userId/);
  const durable = publishRoute.indexOf('persistMetaPublishPlan(serviceSupabase, { ...plan, status: "approved" }');
  assert.ok(durable > 0);
  assert.ok(publishRoute.indexOf("queueMetaPublishPlanExecution(approved)", durable) > durable);
  const worker = readFileSync("src/lib/providers/meta-publish-worker.ts", "utf8");
  assert.match(worker, /plan.controls.activationApproval/);
  assert.match(worker, /finishApprovedAdStudioPublish\(completedPlan, input\)/);
  assert.match(worker, /deterministicUuid\(plan.planId/);
});
