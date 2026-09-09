import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCloneTestPack } from "./adstudio-clone-fixture.ts";
import {
  activationPayloadSuppliesProviderTargets,
  buildMetaAssetFeedSpec,
  buildMetaPublishPlan,
  deriveExactMetaActivationPayload,
  pausedReadbackEvidenceBlocker,
  refreshCurrentMetaPausedReadbackEvidence,
  type MetaPublishPlan,
} from "../src/lib/providers/meta-execution.ts";
import { buildMetaPlanMutation, executeMetaPlanMutation } from "../src/lib/providers/meta-mutations.ts";
import { bindPlanActivationTargets } from "../src/lib/providers/meta-mutation-worker.ts";

function buildPlan(workspaceId = "workspace_a") {
  const plan = buildMetaPublishPlan({
    workspaceId,
    campaignPack: buildCloneTestPack(workspaceId),
    connectionId: "connection_123",
    approvalRequestId: "approval_123",
    setup: {
      metaAdAccountId: "act_123",
      pageId: "page_123",
      leadDestination: { type: "manual", label: "Manual" },
      privacyPolicyUrl: "https://example.com/privacy",
      currency: "AUD",
      timezone: "Australia/Perth",
    },
  });
  const feed = { type: "image" as const, source: "inline" as const, contentSha256: "a".repeat(64) };
  const story = { type: "image" as const, source: "inline" as const, contentSha256: "b".repeat(64) };
  return {
    ...plan,
    assetFeedEnabled: true,
    creatives: plan.creatives.map((creative) => ({
      ...creative,
      asset: feed,
      formatAssets: { feed, story },
      revisionBindings: [
        { placement: "feed" as const, creativeId: `${creative.localId}_feed`, revisionId: `${creative.localId}_feed_revision`, format: "4:5" as const, asset: feed },
        { placement: "story" as const, creativeId: `${creative.localId}_story`, revisionId: `${creative.localId}_story_revision`, format: "9:16" as const, asset: story },
      ],
    })),
  };
}

function withVerifiedPausedEvidence(plan: MetaPublishPlan): MetaPublishPlan {
  const adSetIds = Object.fromEntries(plan.adSets.map((item, index) => [item.localId, `adset_${index + 1}`]));
  const adIds = Object.fromEntries(plan.ads.map((item, index) => [item.localId, `ad_${index + 1}`]));
  const creativeIds = Object.fromEntries(plan.creatives.map((item, index) => [item.localId, `creative_${index + 1}`]));
  const leadFormIds = Object.fromEntries(plan.leadForms.map((item, index) => [item.localId, `form_${index + 1}`]));
  const creatives = Object.fromEntries(plan.creatives.map((creative) => {
    const feed = creative.revisionBindings.find((binding) => binding.placement === "feed")!;
    const story = creative.revisionBindings.find((binding) => binding.placement === "story")!;
    return [creative.localId, {
      providerCreativeId: creativeIds[creative.localId],
      leadFormProviderId: leadFormIds[creative.leadFormLocalId],
      feed: { placement: "feed" as const, creativeId: feed.creativeId, revisionId: feed.revisionId, contentSha256: feed.asset.contentSha256!, providerImageHash: `feedhash${creative.localId}` },
      story: { placement: "story" as const, creativeId: story.creativeId, revisionId: story.revisionId, contentSha256: story.asset.contentSha256!, providerImageHash: `storyhash${creative.localId}` },
    }];
  }));
  const reconciledObjects = {
    ...plan.reconciledObjects,
    campaignId: "campaign_1",
    adSetIds,
    adIds,
    creativeIds,
    leadFormIds,
  };
  return {
    ...plan,
    reconciledObjects: {
      ...reconciledObjects,
      pausedReadbackEvidence: {
        verifiedAt: "2026-08-11T00:00:00.000Z",
        complianceSubjectHash: plan.complianceSubjectHash,
        campaign: { id: "campaign_1", configuredStatus: "PAUSED", effectiveStatus: "PAUSED" },
        adSets: Object.fromEntries(plan.adSets.map((item) => [item.localId, { id: adSetIds[item.localId], configuredStatus: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED" }])),
        ads: Object.fromEntries(plan.ads.map((item) => [item.localId, { id: adIds[item.localId], configuredStatus: "PAUSED", effectiveStatus: "ADSET_PAUSED" }])),
        creatives,
      },
    },
  };
}

test("activation rejects caller targets and derives the complete exact reconciled set", () => {
  const plan = withVerifiedPausedEvidence(buildPlan());
  const payload = deriveExactMetaActivationPayload(plan);
  assert.equal(payload.campaignId, "campaign_1");
  assert.deepEqual(payload.adSetIds, Object.values(plan.reconciledObjects.adSetIds));
  assert.deepEqual(payload.adIds, Object.values(plan.reconciledObjects.adIds));
  assert.equal(activationPayloadSuppliesProviderTargets({ campaignId: "campaign_1" }), true);
  assert.equal(activationPayloadSuppliesProviderTargets({ adSetIds: payload.adSetIds, adIds: payload.adIds }), true);
  assert.equal(activationPayloadSuppliesProviderTargets({}), false);
});

test("activation fails closed for foreign, missing, or extra reconciled objects", () => {
  const plan = withVerifiedPausedEvidence(buildPlan("workspace_a"));
  const otherWorkspacePlan = withVerifiedPausedEvidence(buildPlan("workspace_b"));
  assert.notEqual(plan.workspaceId, otherWorkspacePlan.workspaceId);
  assert.throws(() => deriveExactMetaActivationPayload({
    ...plan,
    reconciledObjects: { ...plan.reconciledObjects, adIds: { ...plan.reconciledObjects.adIds, foreign_ad: "other_workspace_ad" } },
  }), /incomplete or extra reconciled ad/i);
  assert.throws(() => deriveExactMetaActivationPayload({
    ...plan,
    reconciledObjects: { ...plan.reconciledObjects, adSetIds: {} },
  }), /incomplete or extra reconciled ad set/i);
  const route = readFileSync("src/app/api/integrations/meta/publish-plans/[id]/mutations/route.ts", "utf8");
  assert.match(route, /workspaceId: access\.workspaceId/);
  assert.match(route, /activationPayloadSuppliesProviderTargets/);
  assert.match(route, /deriveExactMetaActivationPayload/);
});

test("paused evidence accepts only configured pause plus Meta's inherited paused states", () => {
  const plan = withVerifiedPausedEvidence(buildPlan());
  assert.equal(pausedReadbackEvidenceBlocker(plan), null);
  const unsafe = structuredClone(plan);
  unsafe.reconciledObjects.pausedReadbackEvidence!.ads[plan.ads[0]!.localId]!.effectiveStatus = "ACTIVE";
  assert.match(pausedReadbackEvidenceBlocker(unsafe) ?? "", /ad evidence/i);
});

function mockedGraph(plan: MetaPublishPlan, mutate?: (payload: Record<string, unknown>, id: string) => void): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    const id = url.pathname.split("/").at(-1)!;
    const evidence = plan.reconciledObjects.pausedReadbackEvidence!;
    let payload: Record<string, unknown>;
    const creative = Object.entries(plan.reconciledObjects.creativeIds).find(([, providerId]) => providerId === id);
    if (creative) {
      const localId = creative[0];
      const observed = evidence.creatives[localId]!;
      payload = {
        id,
        asset_feed_spec: buildMetaAssetFeedSpec(observed.feed.providerImageHash, observed.story.providerImageHash),
        object_story_spec: { link_data: { call_to_action: { value: { lead_gen_form_id: observed.leadFormProviderId } } } },
      };
    } else {
      const isCampaign = id === plan.reconciledObjects.campaignId;
      const isAdSet = Object.values(plan.reconciledObjects.adSetIds).includes(id);
      payload = {
        id,
        configured_status: "PAUSED",
        effective_status: isCampaign ? "PAUSED" : isAdSet ? "CAMPAIGN_PAUSED" : "ADSET_PAUSED",
      };
    }
    mutate?.(payload, id);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("fresh Graph v26 paused readback proves exact statuses, asset feed rules, hashes, and form mapping", async () => {
  const plan = withVerifiedPausedEvidence(buildPlan());
  const refreshed = await refreshCurrentMetaPausedReadbackEvidence(plan, {
    accessToken: "token",
    fetchImpl: mockedGraph(plan),
  });
  assert.equal(refreshed.reconciledObjects.pausedReadbackEvidence?.complianceSubjectHash, plan.complianceSubjectHash);
  assert.equal(refreshed.reconciledObjects.pausedReadbackEvidence?.creatives[plan.creatives[0]!.localId]?.feed.providerImageHash.startsWith("feedhash"), true);
});

for (const scenario of [
  {
    label: "ACTIVE effective status",
    mutate: (payload: Record<string, unknown>, id: string) => {
      if (id === "campaign_1") payload.effective_status = "ACTIVE";
    },
  },
  {
    label: "swapped Feed image hash",
    mutate: (payload: Record<string, unknown>) => {
      const spec = payload.asset_feed_spec as { images: Array<{ hash: string }> } | undefined;
      if (spec) spec.images[0]!.hash = "wronghash";
    },
  },
  {
    label: "missing Story placement rule",
    mutate: (payload: Record<string, unknown>) => {
      const spec = payload.asset_feed_spec as { asset_customization_rules: unknown[] } | undefined;
      if (spec) spec.asset_customization_rules.pop();
    },
  },
  {
    label: "wrong Instant Form",
    mutate: (payload: Record<string, unknown>) => {
      const story = payload.object_story_spec as { link_data: { call_to_action: { value: { lead_gen_form_id: string } } } } | undefined;
      if (story) story.link_data.call_to_action.value.lead_gen_form_id = "foreign_form";
    },
  },
]) {
  test(`fresh Graph v26 paused readback fails closed for ${scenario.label}`, async () => {
    const plan = withVerifiedPausedEvidence(buildPlan());
    await assert.rejects(
      refreshCurrentMetaPausedReadbackEvidence(plan, { accessToken: "token", fetchImpl: mockedGraph(plan, scenario.mutate) }),
      /Meta (did not read back|creative)/,
    );
  });
}

test("activation execution discards tampered persisted targets after current plan verification", async () => {
  const plan = withVerifiedPausedEvidence(buildPlan());
  const tampered = buildMetaPlanMutation({
    workspaceId: plan.workspaceId,
    planId: plan.planId,
    action: "activate",
    payload: { campaignId: "foreign_campaign", adSetIds: ["foreign_adset"], adIds: ["foreign_ad"] },
  });
  const bound = bindPlanActivationTargets(tampered, plan);
  assert.deepEqual(bound.payload, deriveExactMetaActivationPayload(plan));
  const calls: string[] = [];
  const activeIds = new Set<string>();
  const result = await executeMetaPlanMutation({
    mutation: bound,
    approvalStatus: "approved",
    accessToken: "token",
    fetchImpl: async (input, init) => {
      const id = new URL(String(input)).pathname.split("/").at(-1)!;
      calls.push(id);
      if (init?.method === "GET") {
        const active = activeIds.has(id);
        return new Response(JSON.stringify({ configured_status: active ? "ACTIVE" : "PAUSED", effective_status: active ? "ACTIVE" : "PAUSED" }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { status?: string };
      if (body.status === "ACTIVE") activeIds.add(id);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });
  assert.equal(result.status, "applied");
  assert.equal(calls.includes("foreign_campaign") || calls.includes("foreign_adset") || calls.includes("foreign_ad"), false);
  assert.equal(calls.includes(plan.reconciledObjects.campaignId!), true);
  assert.equal(calls.includes(Object.values(plan.reconciledObjects.adSetIds)[0]!), true);
  assert.equal(calls.includes(Object.values(plan.reconciledObjects.adIds)[0]!), true);
});
