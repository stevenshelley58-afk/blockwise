import assert from "node:assert/strict";
import test from "node:test";

import { buildCloneCampaignPack, createEmptyAdStudioCampaignPack, extractBrandKitFromWebsite } from "../src/lib/adstudio/index.ts";
import {
  generationCreditMutationKey,
  generationRequestFingerprint,
  resolveCloneCampaignIdFromParts,
} from "../src/lib/adstudio/clone-campaign.ts";
import { buildCloneTestPack } from "./adstudio-clone-fixture.ts";

test("empty AdStudio state contains no synthetic ad", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_empty",
    websiteUrl: "https://agent.example",
    marketCountry: "AU",
    htmlByUrl: { "https://agent.example": "<title>Agent</title>" },
  });
  const pack = createEmptyAdStudioCampaignPack({ workspaceId: "workspace_empty", brandKit });
  assert.equal(pack.variants.length, 0);
  assert.equal(pack.creatives.length, 0);
  assert.equal(pack.copyPacks.length, 0);
});

test("campaign identity covers customer inputs and the released template revision", () => {
  const request = {
    firstAd: {
      templateId: "meta-agent-intro-feed-051",
      imageDataUrls: { property: "asset-a" },
      onImageCopy: { headline: "Coastal living" },
    },
  };
  const reorderedRequest = {
    firstAd: {
      onImageCopy: { headline: "Coastal living" },
      imageDataUrls: { property: "asset-a" },
      templateId: "meta-agent-intro-feed-051",
    },
  };
  const fingerprint = generationRequestFingerprint(request);
  assert.equal(generationRequestFingerprint(reorderedRequest), fingerprint, "jsonb key order must not change identity");
  assert.equal(
    generationRequestFingerprint({ ...request, clientMutationId: "retry-2" }),
    generationRequestFingerprint({ ...request, clientMutationId: "retry-1" }),
    "transport retry tokens must not create a different ad",
  );
  assert.equal(
    generationCreditMutationKey(`workspace-1:${generationRequestFingerprint({ ...request, clientMutationId: "retry-2" })}`),
    generationCreditMutationKey(`workspace-1:${generationRequestFingerprint({ ...request, clientMutationId: "retry-1" })}`),
    "transport retry tokens must reuse the same credit reservation",
  );
  assert.notEqual(
    generationCreditMutationKey(`workspace-1:${generationRequestFingerprint({ ...request, firstAd: { ...request.firstAd, description: "Changed copy" } })}`),
    generationCreditMutationKey(`workspace-1:${fingerprint}`),
    "different ad content must use a different credit reservation",
  );
  assert.notEqual(
    generationRequestFingerprint({ ...request, firstAd: { ...request.firstAd, imageDataUrls: { property: "asset-b" } } }),
    fingerprint,
  );
  assert.notEqual(
    generationRequestFingerprint({ ...request, firstAd: { ...request.firstAd, onImageCopy: { headline: "Just listed" } } }),
    fingerprint,
  );

  const common = {
    workspaceId: "workspace_clone_identity",
    templateId: request.firstAd.templateId,
    requestFingerprint: fingerprint,
  };
  const first = resolveCloneCampaignIdFromParts({ ...common, templateRevision: "quality-lock-a" });
  assert.equal(
    resolveCloneCampaignIdFromParts({ ...common, templateRevision: "quality-lock-a" }),
    first,
    "an exact retry must resume the same campaign",
  );
  assert.notEqual(
    resolveCloneCampaignIdFromParts({ ...common, templateRevision: "quality-lock-b" }),
    first,
    "a new quality-locked template revision must create a new campaign",
  );
});

test("clone campaign contains exactly one ad in the two finished formats", () => {
  const pack = buildCloneTestPack();
  assert.equal(pack.variants.length, 1);
  assert.deepEqual(pack.creatives.map((creative) => creative.format).sort(), ["4:5", "9:16"]);
  assert.equal(pack.creatives.every((creative) => creative.canvas.objects.length === 1), true);
  assert.equal(pack.creatives.every((creative) => creative.canvas.objects[0]?.objectId === "template_clone_image"), true);
});

test("clone campaign refuses to create an ad before the feed (4:5) clone exists", () => {
  const complete = buildCloneTestPack();
  assert.throws(() => buildCloneCampaignPack({
    campaignId: "00000000-0000-4000-8000-000000000052",
    workspaceId: complete.campaign.workspaceId,
    brandKit: complete.brandKit,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    firstAd: {
      source: "gallery",
      templateId: "meta-agent-intro-feed-037",
      description: "Missing feed clone",
      imageDataUrl: "data:image/png;base64,cHJvcGVydHk=",
      templateCloneImagesByFormat: { "9:16": "data:image/png;base64,c3Rvcnk=" },
      formats: ["9:16", "4:5"],
    },
  }), /The finished feed \(4:5\) clone is required/);
});

test("clone campaign builds with feed-only when story is not yet rendered", () => {
  const complete = buildCloneTestPack();
  const pack = buildCloneCampaignPack({
    campaignId: "00000000-0000-4000-8000-000000000053",
    workspaceId: complete.campaign.workspaceId,
    brandKit: complete.brandKit,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    firstAd: {
      source: "gallery",
      templateId: "meta-agent-intro-feed-037",
      description: "Feed only",
      imageDataUrl: "data:image/png;base64,cHJvcGVydHk=",
      templateCloneImagesByFormat: { "4:5": "data:image/png;base64,ZmVlZA==" },
      formats: ["9:16", "4:5"],
    },
  });
  // Only the feed creative should be present; story patches in later.
  assert.deepEqual(pack.creatives.map((c) => c.format), ["4:5"]);
  assert.deepEqual(pack.campaign.creativeFormats, ["4:5"]);
});
