import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAdStudioPublishLeadFormPatch,
  resolveAuthorizedAdStudioPublishPack,
} from "../src/lib/adstudio/publish-pack.ts";
import { buildMetaPublishPlan, type MetaConnectionSetup } from "../src/lib/providers/meta-execution.ts";
import { buildCloneTestPack } from "./adstudio-clone-fixture.ts";

const workspaceId = "workspace_publish_owner";
const setup: MetaConnectionSetup = {
  metaAdAccountId: "act_owner",
  pageId: "page_owner",
  instagramActorId: "ig_owner",
  pixelId: "pixel_owner",
  leadDestination: { type: "webhook", label: "Owner CRM", config: { endpoint: "https://crm.example/leads" } },
  privacyPolicyUrl: "https://northstar.example/privacy",
  currency: "AUD",
  timezone: "Australia/Perth",
};

test("foreign workspace and mismatched route campaign packs fail before publish preparation", async () => {
  const victimPack = buildCloneTestPack("workspace_victim");
  const foreignCalls: Array<[string, string]> = [];
  const foreign = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: victimPack.campaign.campaignId,
    leadFormPatch: null,
    librarySelections: [],
    loadCampaign: async (workspace, campaign) => {
      foreignCalls.push([workspace, campaign]);
      return victimPack;
    },
  });
  assert.deepEqual(foreignCalls, [[workspaceId, victimPack.campaign.campaignId]]);
  assert.deepEqual(foreign, { ok: false, status: 404, error: "Campaign not found." });

  const ownedPack = buildCloneTestPack(workspaceId);
  const mismatched = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: "campaign_from_route",
    leadFormPatch: null,
    librarySelections: [],
    loadCampaign: async () => ownedPack,
  });
  assert.deepEqual(mismatched, { ok: false, status: 404, error: "Campaign not found." });
});

test("lead-form input is exact and cannot replace identifiers, privacy, or creative pixels", async () => {
  const persisted = buildCloneTestPack(workspaceId);
  const originalCanvas = structuredClone(persisted.creatives[0]!.canvas);
  const originalPrivacy = persisted.copyPacks[0]!.meta.leadForm.privacyPolicyUrl;
  const parsed = parseAdStudioPublishLeadFormPatch({
    headline: "  Request the guide  ",
    questions: ["  When are you planning to sell?  "],
    thankYouScreen: { title: "  Thank you  ", body: "  We will be in touch.  " },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const result = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: persisted.campaign.campaignId,
    leadFormPatch: parsed.value,
    librarySelections: [],
    loadCampaign: async () => persisted,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pack.campaign.campaignId, persisted.campaign.campaignId);
  assert.equal(result.pack.campaign.workspaceId, workspaceId);
  assert.equal(result.pack.copyPacks[0]!.meta.leadForm.headline, "Request the guide");
  assert.deepEqual(result.pack.copyPacks[0]!.meta.leadForm.questions, ["When are you planning to sell?"]);
  assert.equal(result.pack.copyPacks[0]!.meta.leadForm.privacyPolicyUrl, originalPrivacy);
  assert.deepEqual(result.pack.creatives[0]!.canvas, originalCanvas);

  assert.deepEqual(
    parseAdStudioPublishLeadFormPatch({
      headline: "Attack",
      questions: [],
      thankYouScreen: { title: "Thanks", body: "Done" },
      campaignId: "victim",
    }),
    { ok: false, error: "Lead form fields are invalid." },
  );
});

test("library selections use authorized source IDs but canonicalize every child to the route campaign", async () => {
  const base = buildCloneTestPack(workspaceId);
  const source = structuredClone(buildCloneTestPack(workspaceId));
  source.campaign.campaignId = "campaign_library_source";
  source.variants = source.variants.map((variant) => ({
    ...variant,
    campaignId: source.campaign.campaignId,
    variantId: "variant_library_source",
  }));
  source.creatives = source.creatives.map((creative, index) => ({
    ...creative,
    creativeId: `creative_library_source_${index}`,
    campaignId: source.campaign.campaignId,
    variantId: "variant_library_source",
  }));
  source.copyPacks = source.copyPacks.map((copyPack) => ({
    ...copyPack,
    copyPackId: "copy_library_source",
    campaignId: source.campaign.campaignId,
    variantId: "variant_library_source",
  }));
  source.compliance.campaignId = source.campaign.campaignId;
  const packs = new Map([
    [base.campaign.campaignId, base],
    [source.campaign.campaignId, source],
  ]);

  const result = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: base.campaign.campaignId,
    leadFormPatch: null,
    librarySelections: [{ campaignId: source.campaign.campaignId, variantId: "variant_library_source" }],
    loadCampaign: async (_workspace, campaignId) => packs.get(campaignId) ?? null,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pack.variants[0]?.variantId, "variant_library_source");
  assert.equal(result.pack.creatives[0]?.creativeId, "creative_library_source_0");
  assert.equal(result.pack.copyPacks[0]?.copyPackId, "copy_library_source");
  assert.equal(result.pack.variants.every((variant) => variant.campaignId === base.campaign.campaignId), true);
  assert.equal(result.pack.creatives.every((creative) => creative.campaignId === base.campaign.campaignId), true);
  assert.equal(result.pack.copyPacks.every((copyPack) => copyPack.campaignId === base.campaign.campaignId), true);

  const missingSource = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: base.campaign.campaignId,
    leadFormPatch: null,
    librarySelections: [{ campaignId: "victim_campaign", variantId: "victim_variant" }],
    loadCampaign: async (_workspace, campaignId) => campaignId === base.campaign.campaignId ? base : null,
  });
  assert.equal(missingSource.ok, false);
  assert.equal(!missingSource.ok && missingSource.status, 422);

  const victimSource = buildCloneTestPack("workspace_victim");
  victimSource.campaign.campaignId = "victim_campaign";
  victimSource.variants.forEach((variant) => { variant.campaignId = victimSource.campaign.campaignId; });
  victimSource.creatives.forEach((creative) => { creative.campaignId = victimSource.campaign.campaignId; });
  victimSource.copyPacks.forEach((copyPack) => { copyPack.campaignId = victimSource.campaign.campaignId; });
  victimSource.compliance.campaignId = victimSource.campaign.campaignId;
  const foreignSource = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: base.campaign.campaignId,
    leadFormPatch: null,
    librarySelections: [{ campaignId: victimSource.campaign.campaignId, variantId: victimSource.variants[0]!.variantId }],
    loadCampaign: async (_workspace, campaignId) => campaignId === base.campaign.campaignId ? base : victimSource,
  });
  assert.equal(foreignSource.ok, false);
  assert.equal(!foreignSource.ok && foreignSource.status, 422);
});

test("a legitimate persisted pack reaches deterministic Meta plan construction", async () => {
  const persisted = buildCloneTestPack(workspaceId);
  const resolved = await resolveAuthorizedAdStudioPublishPack({
    workspaceId,
    campaignId: persisted.campaign.campaignId,
    leadFormPatch: null,
    librarySelections: [],
    loadCampaign: async () => persisted,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;

  const plan = buildMetaPublishPlan({
    workspaceId,
    campaignPack: resolved.pack,
    connectionId: "connection_owner",
    setup,
  });
  assert.equal(plan.workspaceId, workspaceId);
  assert.equal(plan.adStudioCampaignId, persisted.campaign.campaignId);
  assert.ok(plan.creatives.length > 0);
  assert.ok(plan.ads.length > 0);
});
