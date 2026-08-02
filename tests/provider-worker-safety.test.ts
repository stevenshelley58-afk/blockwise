import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishRoute = "src/app/api/adstudio/export-packages/[id]/publish/route.ts";
const approvalsRoute = "src/app/api/approvals/[id]/route.ts";

test("double-publish reuses an active plan and avoids duplicate queue dispatch", () => {
  const source = readFileSync(publishRoute, "utf8");

  assert.match(source, /loadMetaPublishPlanByIdempotencyKey/);
  assert.match(source, /existingApprovedJobActive/);
  assert.match(source, /existingPlan\.status === "publishing"/);
  assert.match(source, /existingPlan\.status === "paused_live"/);
  assert.match(source, /return \{ plan: existingPlan, approval, reusedActivePlan: true \}/);
  assert.match(source, /!metaPublishPlanResult\?\.reusedActivePlan/);
  assert.match(source, /requestLog: existingPlan\.requestLog/);
  assert.match(source, /responseLog: existingPlan\.responseLog/);
  assert.match(source, /reconciledObjects: existingPlan\.reconciledObjects/);
});

test("existing campaigns require a declared audience and cannot use free auto-activation", () => {
  const route = readFileSync(publishRoute, "utf8");
  const panel = readFileSync("src/components/adstudio/panels/publish-panel.tsx", "utf8");

  assert.match(route, /existingMetaCampaignId && !hasExplicitMetaPublishAudience\(body\.controls\)/);
  assert.match(route, /\.from\("workspaces"\)[\s\S]*\.eq\("id", access\.access\.workspaceId\)/);
  assert.match(route, /metaExistingCampaignReuseIssue\(\{[\s\S]*billingOfferVersion:[\s\S]*stripeSubscriptionStatus:/);
  assert.match(panel, /const campaignStepReady = audienceReady && \(campaignMode === "new" \|\| Boolean\(selectedCampaign\)\)/);
  assert.match(panel, /geo: targetSuburbs\.length > 0/);
  assert.doesNotMatch(panel, /Existing campaign targeting/);
  assert.match(panel, /Add a 25 km area around each selected suburb/);
});

test("provider workers and approval queueing are guarded by provider writes kill switch", () => {
  const metaPublishWorker = readFileSync("src/lib/providers/meta-publish-worker.ts", "utf8");
  const metaMutationWorker = readFileSync("src/lib/providers/meta-mutation-worker.ts", "utf8");
  const leadDeliveryWorker = readFileSync("src/lib/providers/lead-delivery-worker.ts", "utf8");
  const approvals = readFileSync(approvalsRoute, "utf8");

  for (const source of [metaPublishWorker, metaMutationWorker, leadDeliveryWorker, approvals]) {
    assert.match(source, /BLOCKWISE_ENABLE_PROVIDER_WRITES/);
    assert.match(source, /providerWritesEnabled/);
  }

  assert.match(approvals, /persistProviderWritesDisabledState/);
  assert.match(approvals, /status: "failed"/);
  assert.match(approvals, /approval was not queued/);
});

test("approval and executable target state are durable before queue dispatch", () => {
  const source = readFileSync(approvalsRoute, "utf8");
  const queueIndex = source.indexOf("queueJobId = await queueApprovedTarget");
  const approvalUpdateIndex = source.indexOf('.from("approval_requests")');
  const planPersistIndex = source.indexOf("await persistMetaPublishPlan");
  const planQueueIndex = source.indexOf("await queueMetaPublishPlanExecution");

  assert.notEqual(queueIndex, -1);
  assert.notEqual(approvalUpdateIndex, -1);
  assert.ok(approvalUpdateIndex < queueIndex);
  assert.ok(planPersistIndex < planQueueIndex);
  assert.match(source, /approval_execution_queue_failed/);
  assert.match(source, /status: 502/);
});

test("lead delivery worker normalizes legacy email destinations to webhook language", () => {
  const source = readFileSync("src/lib/providers/lead-delivery-worker.ts", "utf8");

  assert.match(source, /type StoredLeadDeliveryDestinationType = LeadDeliveryDestinationType \| "email"/);
  assert.match(source, /function normalizeDeliveryDestination/);
  assert.match(source, /deliveryType: destination\.type/);
  assert.match(source, /destination: destination\.label/);
  assert.match(source, /No webhook or CRM endpoint configured/);
  assert.doesNotMatch(source, /deliveryType: attempt\.destination_type/);
  assert.doesNotMatch(source, /No delivery endpoint configured/);
});
