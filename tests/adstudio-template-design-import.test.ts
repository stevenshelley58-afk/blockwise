import assert from "node:assert/strict";
import test from "node:test";

import {
  mapAdStudioLibraryTemplate,
  renderDesign,
  resolveTemplateDesignForFormat,
  templateDesignSchema,
  type AdStudioLibraryTemplate,
  type TemplateDesign,
} from "../src/lib/adstudio/index.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

function row(input: Partial<AdStudioLibraryTemplate> = {}): AdStudioLibraryTemplate {
  return {
    template_key: input.template_key ?? "imported-appraisal",
    status: "approved",
    category: input.category ?? "appraisal",
    adstudio_template_id: input.adstudio_template_id ?? "meta_002",
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

function explicitDesign(templateId: string, version = 7): TemplateDesign {
  return templateDesignSchema.parse({
    templateId,
    version,
    format: "4:5",
    canvas: { w: 1080, h: 1350 },
    palette: ["#102A43", "#F8FAFC", "#E7B24B"],
    fonts: ["Inter", "Inter"],
    layers: [
      {
        id: "background",
        type: "shape",
        rect: { x: 0, y: 0, w: 1, h: 1 },
        fill: "#102A43",
        role: "background",
        locked: true,
      },
      {
        id: "primary_photo",
        type: "image_slot",
        rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.38 },
        role: "primary",
        fit: "cover",
        anchor: "center",
        mask: "none",
        required: true,
      },
      {
        id: "headline",
        type: "text",
        rect: { x: 0.08, y: 0.54, w: 0.76, h: 0.14 },
        slot: "headline",
        align: "left",
        font: "Inter",
        size: 66,
        lineHeight: 1.06,
        weight: 900,
        color: "#FFFFFF",
        fill: "ai_copy",
      },
      {
        id: "subhead",
        type: "text",
        rect: { x: 0.08, y: 0.7, w: 0.76, h: 0.08 },
        slot: "subhead",
        align: "left",
        font: "Inter",
        size: 34,
        lineHeight: 1.18,
        weight: 650,
        color: "#FFFFFF",
        fill: "ai_copy",
      },
      {
        id: "cta",
        type: "cta_button",
        rect: { x: 0.08, y: 0.84, w: 0.32, h: 0.07 },
        fill: "#E7B24B",
        radius: 999,
        label: "cta",
        textColor: "#102A43",
        font: "Inter",
        size: 28,
      },
    ],
  });
}

test("approved skeleton-backed library rows do not derive renderable TemplateDesigns", () => {
  const template = mapAdStudioLibraryTemplate(row({
    creative_skeleton: {
      version: 1,
      archetype: "appraisal",
      shot: { type: "exterior", lighting: "daylight", mood: "premium" },
      composition: {
        focal_point: "front elevation",
        horizon: "low",
        image_frames: [{ id: "primary_photo", role: "primary", x: 0, y: 0, width: 1, height: 1 }],
        copy_safe_zones: [{ id: "copy", x: 0.08, y: 0.54, width: 0.76, height: 0.28 }],
      },
      color: { palette: ["#102A43"], overlay: "scrim", contrast: "medium" },
      text_system: { headline_zone: "bottom", badge: "free appraisal", cta_style: "pill" },
      copy: { hook_style: "question", headline_pattern: "{{suburb}} appraisal", cta: "Book appraisal" },
      variables: [],
      confidence: 90,
    },
  }));

  assert.ok(template);
  assert.equal(template.creativeSkeleton?.archetype, "appraisal");
  assert.equal(resolveTemplateDesignForFormat(template, "4:5"), null);
});

test("explicit template_designs JSON is the only renderable imported template path", () => {
  const design = explicitDesign("explicit-template");
  const template = mapAdStudioLibraryTemplate(row({
    template_key: "explicit-template",
    template_designs: { "4:5": design },
    template_version: 7,
  }));

  assert.ok(template);
  const resolved = resolveTemplateDesignForFormat(template, "4:5");
  assert.ok(resolved);
  assert.equal(resolved.version, 7);
  assert.equal(resolved.templateId, "explicit-template");

  const creative = renderDesign(resolved, {
    text: {
      headline: "Free appraisal for Maylands owners",
      subhead: "Get a practical local price update.",
      cta: "Request update",
    },
    images: {
      primary_photo: "data:image/png;base64,AAAA",
    },
  }, buildTrialFallbackBrandKit({ workspaceId: "workspace_import", workspaceName: "Import Realty", region: "WA" }));

  assert.equal((creative.canvas as Record<string, unknown>).composition, undefined);
  assert.ok(creative.canvas.objects.every((object) => object.sourceLayerId));
  assert.ok(creative.canvas.objects.some((object) => object.templateSlot === "headline" && object.locked === false));
  assert.ok(creative.previewSvg.includes("<svg"));
});
