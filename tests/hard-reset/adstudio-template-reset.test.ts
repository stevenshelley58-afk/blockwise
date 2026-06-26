import assert from "node:assert/strict";
import test from "node:test";

import {
  ADSTUDIO_TEMPLATE_RESET_MESSAGE,
  AD_STUDIO_TEMPLATES,
  RESOLVABLE_AD_STUDIO_TEMPLATES,
  builtInAdStudioTemplates,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  resolveAdStudioTemplate,
  resolvableAdStudioTemplates,
  type AdStudioTemplate,
} from "../../src/lib/adstudio/index.ts";
import { templatePreviewDataUrl } from "../../src/lib/adstudio/template-preview.ts";

function brandKit() {
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_reset",
      websiteUrl: "https://reset.example",
      marketCountry: "AU",
      htmlByUrl: { "https://reset.example": "<html><head><title>Reset Realty</title></head><body></body></html>" },
    }),
    reviewStatus: "approved" as const,
  };
}

test("AdStudio template registry is intentionally empty", () => {
  assert.deepEqual(AD_STUDIO_TEMPLATES, []);
  assert.deepEqual(RESOLVABLE_AD_STUDIO_TEMPLATES, []);
  assert.deepEqual(builtInAdStudioTemplates(), []);
  assert.deepEqual(resolvableAdStudioTemplates(), []);
  assert.equal(resolveAdStudioTemplate("meta_002"), null);
});

test("AdStudio template preview fails closed while reset is active", () => {
  const template: AdStudioTemplate = {
    id: "reset_probe",
    templateKey: "reset_probe",
    name: "Reset Probe",
    goal: "seller_leads",
    offerId: "seller_prep_checklist",
    promptHint: "Reset probe.",
  };

  assert.throws(
    () => templatePreviewDataUrl(template, brandKit()),
    new RegExp(ADSTUDIO_TEMPLATE_RESET_MESSAGE),
  );
});

test("AdStudio selected-template generation fails closed while reset is active", () => {
  assert.throws(
    () =>
      generateAdStudioCampaignPack({
        workspaceId: "workspace_reset",
        brandKit: brandKit(),
        goal: "seller_leads",
        suburb: "Scarborough",
        city: "Perth",
        state: "WA",
        offerId: "seller_prep_checklist",
        platforms: ["meta"],
        variantCount: 1,
        firstAd: {
          mode: "template",
          source: "template_library",
          templateKey: "meta_002",
          description: "Reset should block template generation.",
          imageDataUrl: "data:image/png;base64,aW1hZ2U=",
          formats: ["9:16", "4:5", "1:1"],
        },
      }),
    new RegExp(ADSTUDIO_TEMPLATE_RESET_MESSAGE),
  );
});
