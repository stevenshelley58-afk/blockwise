import assert from "node:assert/strict";
import test from "node:test";

import { buildCloneCampaignPack, createEmptyAdStudioCampaignPack, extractBrandKitFromWebsite } from "../src/lib/adstudio/index.ts";
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

test("clone campaign contains exactly one ad in the two finished formats", () => {
  const pack = buildCloneTestPack();
  assert.equal(pack.variants.length, 1);
  assert.deepEqual(pack.creatives.map((creative) => creative.format).sort(), ["4:5", "9:16"]);
  assert.equal(pack.creatives.every((creative) => creative.canvas.objects.length === 1), true);
  assert.equal(pack.creatives.every((creative) => creative.canvas.objects[0]?.objectId === "template_clone_image"), true);
});

test("clone campaign refuses to create an ad before both clone images exist", () => {
  const complete = buildCloneTestPack();
  assert.throws(() => buildCloneCampaignPack({
    workspaceId: complete.campaign.workspaceId,
    brandKit: complete.brandKit,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    firstAd: {
      source: "gallery",
      templateId: "meta-feed-020",
      description: "Missing story clone",
      imageDataUrl: "data:image/png;base64,cHJvcGVydHk=",
      templateCloneImagesByFormat: { "4:5": "data:image/png;base64,ZmVlZA==" },
      formats: ["9:16", "4:5"],
    },
  }), /Both finished clone formats are required/);
});
