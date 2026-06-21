import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateRenderFrame,
  designLayerSignature,
  generateAdStudioCampaignPack,
  renderDesign,
  resolveTemplateDesignForFormat,
  templateDesignSchema,
} from "../src/lib/adstudio/index.ts";
import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";

function freeAppraisalTemplate() {
  const template = AD_STUDIO_TEMPLATES.find((item) => item.id === "free_appraisal");
  assert.ok(template, "free_appraisal template should exist");
  return template;
}

function brandKit(): AdStudioBrandKit {
  const kit = buildTrialFallbackBrandKit({ workspaceId: "workspace_design", workspaceName: "Blockwise Realty", region: "WA" });
  return {
    ...kit,
    contact: {
      ...kit.contact,
      phone: "08 5550 1212",
      socialLinks: ["@blockwiserealty"],
    },
  };
}

function creativeStructure(creative: ReturnType<typeof renderDesign>) {
  return creative.canvas.objects.map((object) => ({
    objectId: object.objectId,
    type: object.type,
    role: object.role,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    fontFamily: object.fontFamily,
    size: object.size,
    lineHeight: object.lineHeight,
    weight: object.weight,
    align: object.align,
    fill: object.fill,
    radius: object.radius,
    opacity: object.opacity,
    sourceLayerId: object.sourceLayerId,
    templateSlot: object.templateSlot,
  }));
}

test("Free Appraisal carries a strict TemplateDesign for the proof-of-life formats", () => {
  const template = freeAppraisalTemplate();

  for (const format of ["9:16", "4:5", "1:1"] as const) {
    const design = resolveTemplateDesignForFormat(template, format);
    assert.ok(design, `${format} design should be present`);
    assert.equal(design.templateId, "free_appraisal");
    assert.equal(design.version, 1);
    assert.deepEqual(templateDesignSchema.parse(design), design);
    assert.ok(design.layers.some((layer) => layer.type === "image_slot" && layer.id === "primary_photo"));
    assert.ok(design.layers.some((layer) => layer.type === "text" && layer.slot === "headline" && layer.fill === "ai_copy"));
    assert.ok(design.layers.some((layer) => layer.type === "cta_button" && layer.label === "cta"));
  }
});

test("gallery and generated output keep the same template layer structure", () => {
  const template = freeAppraisalTemplate();
  const design = resolveTemplateDesignForFormat(template, "4:5");
  assert.ok(design);
  const kit = brandKit();

  const gallery = renderDesign(design, {
    text: {
      eyebrow: "Free appraisal",
      headline: "What could your home be worth?",
      subhead: "A practical local price update.",
      cta: "Book appraisal",
      phone: "08 5550 1212",
    },
  }, kit);
  const generated = renderDesign(design, {
    text: {
      eyebrow: "Free appraisal",
      headline: "Free appraisal for Scarborough owners",
      subhead: "Get a practical price update before your next move.",
      cta: "Book free appraisal",
      phone: "08 5550 1212",
    },
    images: {
      primary_photo: "data:image/png;base64,AAAA",
    },
  }, kit);

  assert.deepEqual(designLayerSignature(design), designLayerSignature(design));
  assert.deepEqual(creativeStructure(gallery), creativeStructure(generated));
  assert.notEqual(
    gallery.canvas.objects.find((object) => object.objectId === "headline")?.content,
    generated.canvas.objects.find((object) => object.objectId === "headline")?.content,
  );
});

test("photo prep frame uses TemplateDesign image slots and safe zones", () => {
  const template = freeAppraisalTemplate();
  const frame = buildTemplateRenderFrame({ template, format: "4:5" });

  assert.equal(frame.format, "4:5");
  assert.deepEqual(frame.canvas, { widthPx: 1080, heightPx: 1350 });
  assert.equal(frame.imageSlots[0]?.id, "primary_photo");
  assert.deepEqual(
    {
      x: frame.imageSlots[0]?.x,
      y: frame.imageSlots[0]?.y,
      width: frame.imageSlots[0]?.width,
      height: frame.imageSlots[0]?.height,
    },
    { x: 0, y: 0, width: 1, height: 1 },
  );
  assert.ok(frame.copySafeZones.some((zone) => zone.id === "headline"));
  assert.ok(frame.copySafeZones.some((zone) => zone.id === "cta"));
});

test("selected Free Appraisal generation returns template_design creatives", () => {
  const template = freeAppraisalTemplate();
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_design",
    brandKit: brandKit(),
    goal: "appraisal_bookings",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "home_value_update",
    platforms: ["meta"],
    variantCount: 1,
    resolvedTemplate: template,
    firstAd: {
      mode: "template",
      source: "template_library",
      templateId: "free_appraisal",
      templateKey: "free_appraisal",
      description: "Create a free appraisal ad for Scarborough homeowners.",
      imageDataUrl: "data:image/png;base64,AAAA",
      formats: ["9:16", "4:5", "1:1"],
    },
  });

  assert.equal(pack.creatives.length, 3);
  assert.ok(pack.campaign.templateSnapshot?.designs);
  for (const creative of pack.creatives) {
    assert.equal(creative.canvas.composition?.id, "template_design:free_appraisal:v1");
    assert.ok(creative.canvas.objects.some((object) => object.sourceLayerId === "primary_photo"));
    assert.ok(creative.previewSvg.includes("<svg"));
  }
});
