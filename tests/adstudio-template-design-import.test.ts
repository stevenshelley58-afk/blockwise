import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mapAdStudioLibraryTemplate,
  renderDesign,
  resolveTemplateDesignForFormat,
  templateDesignFromCreativeSkeleton,
  templateDesignSchema,
  templateDesignSetFromCreativeSkeleton,
  type AdStudioLibraryTemplate,
} from "../src/lib/adstudio/index.ts";
import { creativeSkeletonSchema, type CreativeSkeleton } from "../src/lib/ad-template-library/skeleton.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const fixture = JSON.parse(readFileSync("tests/fixtures/adstudio-template-engine-foundation.json", "utf8")) as {
  creativeSkeletons: unknown[];
};

const skeleton = creativeSkeletonSchema.parse(fixture.creativeSkeletons[2]);

function row(input: Partial<AdStudioLibraryTemplate> = {}): AdStudioLibraryTemplate {
  return {
    template_key: input.template_key ?? "imported-appraisal",
    status: "approved",
    category: input.category ?? "appraisal",
    adstudio_template_id: input.adstudio_template_id ?? "free_appraisal",
    offer_id: input.offer_id ?? "home_value_update",
    goal: input.goal ?? "appraisal_bookings",
    headline: input.headline ?? "What could your home be worth?",
    primary_text: input.primary_text ?? "Book a local appraisal with a practical market read.",
    description: input.description ?? "Free local appraisal",
    cta: input.cta ?? "Book appraisal",
    evidence_score: input.evidence_score ?? 72,
    creative_skeleton: input.creative_skeleton,
    template_designs: input.template_designs,
    template_version: input.template_version,
  };
}

test("CreativeSkeleton converts into a strict TemplateDesign for each proof format", () => {
  const designs = templateDesignSetFromCreativeSkeleton({
    templateId: "imported-appraisal",
    skeleton,
    formats: ["9:16", "4:5", "1:1"],
  });

  for (const format of ["9:16", "4:5", "1:1"] as const) {
    const design = designs[format];
    assert.ok(design, `${format} design should exist`);
    assert.deepEqual(templateDesignSchema.parse(design), design);
    assert.equal(design.templateId, "imported-appraisal");
    assert.equal(design.format, format);
    assert.ok(design.layers.some((layer) => layer.type === "image_slot" && layer.id === "primary_photo"));
    assert.ok(design.layers.some((layer) => layer.type === "text" && layer.slot === "headline" && layer.fill === "ai_copy"));
    assert.ok(design.layers.some((layer) => layer.type === "cta_button" && layer.label === "cta"));
  }
});

test("skeleton-derived designs render as editable TemplateDesign scenes", () => {
  const design = templateDesignFromCreativeSkeleton({
    templateId: "imported-appraisal",
    skeleton,
    format: "4:5",
  });
  const brandKit = buildTrialFallbackBrandKit({ workspaceId: "workspace_import", workspaceName: "Import Realty", region: "WA" });
  const creative = renderDesign(design, {
    text: {
      headline: "Free appraisal for Maylands owners",
      subhead: "Get a practical local price update.",
      cta: "Request update",
    },
    images: {
      primary_photo: "data:image/png;base64,AAAA",
    },
  }, brandKit);

  assert.equal(creative.canvas.composition?.id, "template_design:imported-appraisal:v1");
  assert.ok(creative.canvas.objects.every((object) => object.sourceLayerId));
  assert.ok(creative.canvas.objects.some((object) => object.templateSlot === "headline" && object.locked === false));
  assert.ok(creative.previewSvg.includes("<svg"));
});

test("approved skeleton-backed library rows derive TemplateDesign sets", () => {
  const template = mapAdStudioLibraryTemplate(row({ creative_skeleton: skeleton }));

  assert.ok(template);
  assert.equal(template.id, "imported-appraisal");
  assert.equal(template.creativeSkeleton?.archetype, "appraisal");
  const design = resolveTemplateDesignForFormat(template, "4:5");
  assert.ok(design);
  assert.equal(design.templateId, "imported-appraisal");
  assert.ok(design.layers.some((layer) => layer.type === "image_slot"));
});

test("explicit template_designs JSON wins over skeleton-derived designs", () => {
  const explicit = templateDesignFromCreativeSkeleton({
    templateId: "explicit-template",
    skeleton: skeleton as CreativeSkeleton,
    format: "4:5",
    version: 7,
  });
  const template = mapAdStudioLibraryTemplate(row({
    template_key: "explicit-template",
    creative_skeleton: skeleton,
    template_designs: { "4:5": explicit },
    template_version: 7,
  }));

  assert.ok(template);
  const design = resolveTemplateDesignForFormat(template, "4:5");
  assert.ok(design);
  assert.equal(design.version, 7);
  assert.equal(design.templateId, "explicit-template");
});
