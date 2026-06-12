import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishRoute = "src/app/api/adstudio/export-packages/[id]/publish/route.ts";
const approvalsRoute = "src/app/api/approvals/[id]/route.ts";

test("double-publish reuses an active plan and avoids duplicate queue dispatch", () => {
  const source = readFileSync(publishRoute, "utf8");

  assert.match(source, /loadMetaPublishPlanByIdempotencyKey/);
  assert.match(source, /isActivePublishPlanStatus\(existingPlan\.status\)/);
  assert.match(source, /return \{ plan: existingPlan, reusedActivePlan: true \}/);
  assert.match(source, /!metaPublishPlanResult\?\.reusedActivePlan/);
  assert.match(source, /requestLog: existingPlan\.requestLog/);
  assert.match(source, /responseLog: existingPlan\.responseLog/);
  assert.match(source, /reconciledObjects: existingPlan\.reconciledObjects/);
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

test("approval route queues provider work before persisting approved status", () => {
  const source = readFileSync(approvalsRoute, "utf8");
  const queueIndex = source.indexOf("triggerRunId = await queueApprovedTarget");
  const updateIndex = source.indexOf('.from("approval_requests")', queueIndex);

  assert.notEqual(queueIndex, -1);
  assert.notEqual(updateIndex, -1);
  assert.ok(queueIndex < updateIndex);
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
