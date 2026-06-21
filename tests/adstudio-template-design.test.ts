import assert from "node:assert/strict";
import test from "node:test";

import {
  builtInAdStudioTemplates,
  buildTemplateRenderFrame,
  designLayerSignature,
  generateAdStudioCampaignPack,
  renderDesign,
  resolveTemplateDesignForFormat,
  templateDesignSchema,
} from "../src/lib/adstudio/index.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";

function extractedTemplate() {
  const template = builtInAdStudioTemplates().find((item) => item.id === "meta_002");
  assert.ok(template, "meta_002 template should exist");
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

test("extracted Meta templates carry strict TemplateDesigns for proof-of-life formats", () => {
  const template = extractedTemplate();

  for (const format of ["9:16", "4:5", "1:1"] as const) {
    const design = resolveTemplateDesignForFormat(template, format);
    assert.ok(design, `${format} design should be present`);
    assert.equal(design.templateId, "meta_002");
    assert.equal(design.version, 1);
    assert.deepEqual(templateDesignSchema.parse(design), design);
    assert.ok(design.layers.some((layer) => layer.type === "image_slot" && layer.id === "primary_photo"));
    assert.ok(design.layers.some((layer) => layer.type === "text" && layer.slot === "headline" && layer.fill === "ai_copy"));
    assert.ok(design.layers.some((layer) => layer.type === "cta_button" && layer.label === "cta"));
  }
});

test("gallery and generated output keep the same template layer structure", () => {
  const template = extractedTemplate();
  const design = resolveTemplateDesignForFormat(template, "4:5");
  assert.ok(design);
  const kit = brandKit();

  const gallery = renderDesign(design, {
    text: {
      eyebrow: template.name,
      headline: template.sampleCopy?.headline ?? "Buying or selling in Bicton?",
      subhead: template.sampleCopy?.primaryText ?? "Clear local property advice.",
      body: template.sampleCopy?.primaryText ?? "Clear local property advice.",
      cta: template.sampleCopy?.cta ?? "Start planning",
      phone: "08 5550 1212",
    },
  }, kit);
  const generated = renderDesign(design, {
    text: {
      eyebrow: template.name,
      headline: "Plan your next move in Bicton",
      subhead: "Use local context before buying, selling, or preparing a campaign.",
      body: "Use local context before buying, selling, or preparing a campaign.",
      cta: "Talk to an agent",
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
  const template = extractedTemplate();
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
    { x: 0.02, y: 0.02, width: 0.96, height: 0.39 },
  );
  assert.ok(frame.copySafeZones.some((zone) => zone.id === "headline"));
  assert.ok(frame.copySafeZones.some((zone) => zone.id === "cta"));
});

test("selected extracted template generation returns template_design creatives", () => {
  const template = extractedTemplate();
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_design",
    brandKit: brandKit(),
    goal: "seller_leads",
    suburb: "Bicton",
    city: "Perth",
    state: "WA",
    offerId: "prelisting_timeline",
    platforms: ["meta"],
    variantCount: 1,
    resolvedTemplate: template,
    firstAd: {
      mode: "template",
      source: "template_library",
      templateId: "meta_002",
      templateKey: "meta_002",
      description: "Create an agent-led buying or selling ad for Bicton owners.",
      imageDataUrl: "data:image/png;base64,AAAA",
      formats: ["9:16", "4:5", "1:1"],
    },
  });

  assert.equal(pack.creatives.length, 3);
  assert.ok(pack.campaign.templateSnapshot?.designs);
  for (const creative of pack.creatives) {
    assert.equal(creative.canvas.composition?.id, "template_design:meta_002:v1");
    assert.ok(creative.canvas.objects.some((object) => object.sourceLayerId === "primary_photo"));
    assert.ok(creative.previewSvg.includes("<svg"));
  }
});
