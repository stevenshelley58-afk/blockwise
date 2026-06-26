import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAdStudioTemplate,
  resolveTemplateMediaSlots,
  type AdStudioTemplate,
  type TemplateDesign,
} from "../src/lib/adstudio/index.ts";

const brandAssets = {
  headshots: [],
  officeImages: [],
  listingImages: [],
  socialProofImages: [],
};

test("template media slots resolve a single design image slot", () => {
  const template = resolveAdStudioTemplate("gold_home_buyer_tips");

  const slots = resolveTemplateMediaSlots({ template, brandKit: { assets: brandAssets } });

  assert.equal(slots.length, 1);
  assert.deepEqual(
    {
      id: slots[0]?.id,
      role: slots[0]?.role,
      label: slots[0]?.label,
      required: slots[0]?.required,
      previewFormat: slots[0]?.previewFormat,
      rect: slots[0]?.rect,
    },
    {
      id: "primary_photo",
      role: "primary",
      label: "Hero image",
      required: true,
      previewFormat: "4:5",
      rect: { x: 0.24, y: 0.12, w: 0.58, h: 0.38 },
    },
  );
});

test("template media slots resolve all collage image slots in visual order", () => {
  const template = resolveAdStudioTemplate("gold_interior_design_collage");

  const slots = resolveTemplateMediaSlots({ template, brandKit: { assets: brandAssets } });

  assert.deepEqual(
    slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      label: slot.label,
      required: slot.required,
      previewFormat: slot.previewFormat,
    })),
    [
      { id: "primary_photo", role: "primary", label: "Hero image", required: true, previewFormat: "4:5" },
      { id: "secondary_top", role: "secondary", label: "Upper inset image", required: true, previewFormat: "4:5" },
      { id: "secondary_mid", role: "secondary", label: "Middle inset image", required: true, previewFormat: "4:5" },
      { id: "secondary_low", role: "secondary", label: "Lower inset image", required: true, previewFormat: "4:5" },
    ],
  );
});

test("template media slots fall back to creative skeleton image frames", () => {
  const template = skeletonTemplate();

  const slots = resolveTemplateMediaSlots({ template, brandKit: { assets: brandAssets } });

  assert.deepEqual(
    slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      label: slot.label,
      required: slot.required,
      rect: slot.rect,
      previewFormat: slot.previewFormat,
      source: slot.source,
    })),
    [
      {
        id: "primary_photo",
        role: "primary",
        label: "Hero image",
        required: true,
        rect: { x: 0.05, y: 0.08, w: 0.6, h: 0.5 },
        previewFormat: "4:5",
        source: "skeleton",
      },
      {
        id: "h",
        role: "agent_headshot",
        label: "Agent headshot",
        required: true,
        rect: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 },
        previewFormat: "4:5",
        source: "skeleton",
      },
    ],
  );
});

test("headshot slots auto-fill from brand kit when available", () => {
  const template = headshotDesignTemplate();

  const withHeadshot = resolveTemplateMediaSlots({
    template,
    brandKit: { assets: { ...brandAssets, headshots: ["/headshots/agent.jpg"] } },
  });
  const withoutHeadshot = resolveTemplateMediaSlots({ template, brandKit: { assets: brandAssets } });

  const autoFilled = withHeadshot.find((slot) => slot.role === "agent_headshot");
  const required = withoutHeadshot.find((slot) => slot.role === "agent_headshot");
  assert.equal(autoFilled?.defaultUrl, "/headshots/agent.jpg");
  assert.equal(autoFilled?.required, false);
  assert.equal(required?.defaultUrl, undefined);
  assert.equal(required?.required, true);
});

function headshotDesignTemplate(): AdStudioTemplate {
  const design: TemplateDesign = {
    templateId: "headshot_design",
    version: 1,
    format: "4:5",
    canvas: { w: 1080, h: 1350 },
    palette: ["#fff", "#111"],
    fonts: ["Inter"],
    layers: [
      {
        id: "primary_photo",
        type: "image_slot",
        role: "primary",
        rect: { x: 0, y: 0, w: 1, h: 0.65 },
        fit: "cover",
        mask: "none",
      },
      {
        id: "agent_portrait",
        type: "image_slot",
        role: "agent_headshot",
        rect: { x: 0.68, y: 0.68, w: 0.22, h: 0.22 },
        fit: "cover",
        mask: "circle",
      },
    ],
  };

  return {
    id: "headshot_design",
    name: "Headshot design",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Headshot design",
    designs: { "4:5": design },
  };
}

function skeletonTemplate(): AdStudioTemplate {
  return {
    id: "skeleton_template",
    name: "Skeleton template",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Skeleton template",
    creativeSkeleton: {
      version: 1,
      archetype: "listing_hero",
      shot: { type: "home", lighting: "bright", mood: "calm" },
      composition: {
        focal_point: "home",
        horizon: "middle",
        image_frames: [
          { id: "primary_photo", role: "primary", x: 0.05, y: 0.08, width: 0.6, height: 0.5, formats: ["4:5"] },
          { id: "h", role: "agent_headshot", x: 0.7, y: 0.7, width: 0.2, height: 0.2 },
        ],
        copy_safe_zones: [{ id: "headline", x: 0.08, y: 0.62, width: 0.5, height: 0.15 }],
      },
      color: { palette: ["#fff", "#111"], overlay: "none", contrast: "high" },
      text_system: { headline_zone: "lower", badge: "small", cta_style: "button" },
      copy: { hook_style: "direct", headline_pattern: "Local home", cta: "Learn more" },
      variables: [],
      confidence: 90,
    },
  };
}
