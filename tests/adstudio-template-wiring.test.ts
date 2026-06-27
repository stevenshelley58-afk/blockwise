import assert from "node:assert/strict";
import test from "node:test";

import {
  AD_STUDIO_TEMPLATES,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
} from "../src/lib/adstudio/index.ts";
import { getCreativeDesignJson, saveCreativeDesignJson } from "../src/lib/adstudio/creative-design-json.ts";

function brandKit() {
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_wiring",
      websiteUrl: "https://wire.example",
      marketCountry: "AU",
      htmlByUrl: { "https://wire.example": "<html><head><title>Wire Realty</title></head><body></body></html>" },
    }),
    reviewStatus: "approved" as const,
  };
}

const A = "data:image/png;base64,AAAAprimary";
const B = "data:image/png;base64,BBBBsecondary";

test("every template slot wires end-to-end: multi-image + copy reach objects AND fabric, and edits round-trip", () => {
  const template = AD_STUDIO_TEMPLATES[0];
  assert.ok(template, "a proof template must be installed");
  const imageSlots = template.canvas.objects.filter((o) => o.type === "image");
  assert.ok(imageSlots.length >= 2, "proof template should have multiple image slots");

  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_wiring",
    brandKit: brandKit(),
    goal: template.goal,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: template.offerId,
    platforms: ["meta"],
    variantCount: 1,
    firstAd: {
      mode: "template",
      source: "template_library",
      templateKey: template.templateKey,
      description: "Two fresh listings.",
      imageDataUrl: A,
      imageDataUrls: { primary_image: A, secondary_image: B },
      formats: ["9:16", "4:5", "1:1"],
    },
  });

  const creative = pack.creatives[0];
  assert.ok(creative);

  // canvas.objects: each image slot got its OWN image; text slots got copy
  const obj = (role: string) => creative.canvas.objects.find((o) => o.role === role);
  assert.equal(obj("primary_image")?.content, A);
  assert.equal(obj("secondary_image")?.content, B);
  assert.ok((obj("headline")?.content ?? "").length > 0, "headline copy wired");
  assert.ok((obj("cta_text")?.content ?? "").length > 0, "cta copy wired");

  // fabric mirror: same wiring by role (editor reads this)
  const design = getCreativeDesignJson(creative);
  assert.ok(design);
  const fab = (role: string) => design.objects.find((o) => o.blockwise?.role === role);
  assert.equal(fab("primary_image")?.src, A);
  assert.equal(fab("secondary_image")?.src, B);
  assert.ok((fab("headline")?.text ?? "").length > 0);

  // edit round-trip: editing the fabric headline syncs back to objects + preview
  const edited = { ...design, objects: design.objects.map((o) => (o.blockwise?.role === "headline" ? { ...o, text: "EDITED HEADLINE" } : o)) };
  const saved = saveCreativeDesignJson(creative, edited);
  assert.equal(saved.canvas.objects.find((o) => o.role === "headline")?.content, "EDITED HEADLINE");
  assert.match(saved.previewSvg, /EDITED HEADLINE/);
});
