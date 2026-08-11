import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishRoute = "src/app/api/adstudio/export-packages/[id]/publish/route.ts";
const approvalsRoute = "src/app/api/approvals/[id]/route.ts";

test("double-publish reuses an active plan and avoids duplicate queue dispatch", () => {
  const source = readFileSync(publishRoute, "utf8");

  assert.match(source, /loadMetaPublishPlanByIdempotencyKey/);
  assert.match(source, /existingQueuedJobActive/);
  assert.match(source, /existingPlan\.status === "publishing"/);
  assert.match(source, /existingPlan\.status === "paused_ready"/);
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

test("Ad Studio VPS recovery injects the encrypted runtime credential without mutating process.env", () => {
  const worker = readFileSync("worker/index.ts", "utf8");
  const campaign = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const copy = readFileSync("src/lib/adstudio/copy-generation.ts", "utf8");
  const cloneQa = readFileSync("src/lib/adstudio/clone-quality-gate.ts", "utf8");

  assert.match(worker, /loadRuntimeProviderToken\(supabase, "openai"\)/);
  assert.match(worker, /loadRuntimeProviderToken\(supabase, "google"\)/);
  assert.match(worker, /openAiApiKey \? \{ OPENAI_API_KEY: openAiApiKey \} : \{\}/);
  assert.match(worker, /googleAiApiKey \? \{ GOOGLE_AI_API_KEY: googleAiApiKey \} : \{\}/);
  assert.match(worker, /!openAiApiKey && !googleAiApiKey/);
  assert.match(worker, /runTemplateCampaignGeneration\(\{[\s\S]*providerEnv,/);
  assert.match(worker, /runTemplateCampaignGeneration\(\{[\s\S]*signal: context\.signal,/);
  assert.doesNotMatch(worker, /process\.env\.OPENAI_API_KEY\s*=/);
  assert.doesNotMatch(worker, /process\.env\.GOOGLE_AI_API_KEY\s*=/);
  assert.match(worker, /releaseAdStudioGenerationLock[\s\S]*\.eq\("job_id", creativeJobId\)/);
  assert.match(campaign, /resolveCloneProviders\(generationQuality, input\.providerEnv\)/);
  assert.match(campaign, /generateAdStudioTemplateCopy\(\{[\s\S]*providerEnv: input\.providerEnv,/);
  assert.match(campaign, /review\(\{[\s\S]*providerEnv: input\.providerEnv,/);
  assert.match(copy, /createTextProviderForCandidate\(candidate, \{ env: providerEnv \}\)/);
  assert.match(cloneQa, /provider: \(dependencies\.createProvider \?\? createTextProviderForCandidate\)\(candidate, \{ env: input\.providerEnv \}\)/);
  assert.match(campaign, /signal: input\.signal/);
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

test("activation rechecks immutable finished clones and queues before exposing an activating plan", () => {
  const route = readFileSync("src/app/api/integrations/meta/publish-plans/[id]/mutations/route.ts", "utf8");
  const readiness = readFileSync("src/app/api/integrations/meta/publish-plans/[id]/readiness/route.ts", "utf8");
  const execution = readFileSync("src/lib/providers/meta-execution.ts", "utf8");

  assert.match(route, /confirmSpend !== true/);
  assert.match(route, /evaluateCurrentMetaPublishPlanReadiness/);
  assert.match(route, /queueMetaMutationExecution/);
  assert.ok(route.indexOf("queueMetaMutationExecution") < route.lastIndexOf('status: "activating"'));
  assert.match(route, /activationMutationId/);
  assert.match(readiness, /evaluateCurrentMetaPublishPlanReadiness/);
  assert.match(readiness, /planToken: plan\.complianceSubjectHash/);
  assert.match(execution, /adstudio_creative_revisions/);
  assert.match(execution, /sameImmutableCreativeAsset/);
  assert.match(execution, /variantCreatives/);
  assert.doesNotMatch(execution, /adstudio_runtime_instances/);
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
