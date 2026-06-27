import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_STUDIO_TEMPLATES,
  RESOLVABLE_AD_STUDIO_TEMPLATES,
  builtInAdStudioTemplates,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  resolveAdStudioTemplate,
  resolvableAdStudioTemplates,
  metaLeadAdPackSchema,
} from "../../src/lib/adstudio/index.ts";

// Doctrine: the gallery has NO fixed count and NO fixed role set. A type-only ad,
// a multi-image collage, and a headshot ad are all valid. These tests assert the
// invariants that hold for ANY installed set (including an empty set during a
// rebuild). Structural diversity + source-ad provenance are enforced by
// scripts/verify/adstudio-templates.mjs and hermes/skills/adstudio-template-builder.

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

test("AdStudio gallery loads without throwing and is internally consistent", () => {
  const all = builtInAdStudioTemplates();
  assert.equal(all.length, AD_STUDIO_TEMPLATES.length);
  assert.equal(resolvableAdStudioTemplates().length, RESOLVABLE_AD_STUDIO_TEMPLATES.length);
  assert.equal(new Set(all.map((template) => template.id)).size, all.length);
  assert.equal(new Set(all.map((template) => template.templateKey)).size, all.length);
  for (const template of RESOLVABLE_AD_STUDIO_TEMPLATES) {
    assert.equal(template.status, "approved");
  }
});

test("every installed template satisfies the envelope (no fixed-role assumption)", () => {
  for (const template of AD_STUDIO_TEMPLATES) {
    assert.equal("conceptGroupId" in template, false, `${template.id} must not contain pairing metadata`);
    assert.equal(template.id, template.templateKey);
    assert.equal(template.source, "builtin");
    assert.equal(template.status, "approved");
    assert.ok(template.gallery.sampleImageSrc, template.id);
    assert.ok(template.gallery.thumbnailSrc, template.id);
    assert.equal(template.canvas.fabricJson.version, "blockwise-fabric-v1");
    assert.equal(metaLeadAdPackSchema.safeParse(template.meta).success, true, `${template.id} meta pack should match Meta schema`);

    // object <-> fabric lockstep by objectId, NOT by a required role list
    const objectIds = new Set(template.canvas.objects.map((object) => object.objectId));
    const fabricIds = new Set(
      template.canvas.fabricJson.objects
        .map((object) => object.blockwise?.objectId)
        .filter((value): value is string => typeof value === "string"),
    );
    for (const objectId of objectIds) {
      assert.ok(fabricIds.has(objectId), `${template.id}: ${objectId} missing fabric mirror`);
    }

    assert.equal(resolveAdStudioTemplate(template.id)?.id, template.id);
  }
});

test("AdStudio selected-template generation fails closed for unknown templates", () => {
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
          templateKey: "missing-template",
          description: "Unknown templates should still be blocked.",
          imageDataUrl: "data:image/png;base64,original",
          formats: ["9:16", "4:5", "1:1"],
        },
      }),
    /Selected template was not found\./,
  );
});
