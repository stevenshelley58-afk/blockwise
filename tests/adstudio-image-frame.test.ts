import assert from "node:assert/strict";
import test from "node:test";

import {
  creativeImageFrameSchema,
  creativeSkeletonSchema,
  type CreativeImageFrame,
} from "../src/lib/ad-template-library/skeleton.ts";
import { buildTemplateImageObjects, pickPrimaryImageFrame, resolveImageFrameRect } from "../src/lib/adstudio/image-frame.ts";
import type { CompositionImageFrame } from "../src/lib/ad-template-library/skeleton.ts";
import { compositionToCreative } from "../src/lib/adstudio/creative/composition-to-creative.ts";
import { buildPalette, fontStacks } from "../src/lib/adstudio/creative/preview-engine.ts";

const baseSkeleton = {
  version: 1 as const,
  archetype: "listing_hero" as const,
  shot: { type: "exterior", lighting: "golden hour", mood: "warm" },
  composition: {
    focal_point: "front door",
    horizon: "low" as const,
    copy_safe_zones: [{ id: "z1", x: 0, y: 0, width: 0.5, height: 0.3 }],
  },
  color: { palette: ["#123456"], overlay: "soft scrim", contrast: "medium" as const },
  text_system: { headline_zone: "top", badge: "new listing", cta_style: "pill" },
  copy: { hook_style: "question", headline_pattern: "X in Y", cta: "Learn more" },
  variables: [],
  confidence: 80,
};

test("creativeSkeletonSchema stays backward compatible (image_frames optional)", () => {
  const parsed = creativeSkeletonSchema.safeParse(baseSkeleton);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.image_frames, undefined);
});

test("creativeSkeletonSchema accepts image_frames with per-size overrides", () => {
  const parsed = creativeSkeletonSchema.safeParse({
    ...baseSkeleton,
    image_frames: [
      {
        id: "hero",
        x: 0,
        y: 0,
        width: 0.5,
        height: 1,
        clip: "rect",
        per_size: { "9:16": { x: 0, y: 0, width: 1, height: 0.6 } },
      },
    ],
  });
  assert.equal(parsed.success, true);
});

test("creativeImageFrameSchema rejects frames that overflow the canvas", () => {
  const overflow = creativeImageFrameSchema.safeParse({ id: "f", x: 0.6, y: 0, width: 0.6, height: 0.5 });
  assert.equal(overflow.success, false);
});

test("resolveImageFrameRect converts the base rect to canvas pixels", () => {
  const frame: CreativeImageFrame = { id: "hero", x: 0.25, y: 0.5, width: 0.5, height: 0.5 };
  assert.deepEqual(
    resolveImageFrameRect({ frame, format: "1:1", canvasWidth: 1080, canvasHeight: 1080 }),
    { x: 270, y: 540, width: 540, height: 540 },
  );
});

test("resolveImageFrameRect prefers a per-size override for the format", () => {
  const frame: CreativeImageFrame = {
    id: "hero",
    x: 0,
    y: 0,
    width: 0.5,
    height: 1,
    per_size: { "9:16": { x: 0, y: 0, width: 1, height: 0.6 } },
  };
  // 9:16 uses the override (full width, 60% height)...
  assert.deepEqual(
    resolveImageFrameRect({ frame, format: "9:16", canvasWidth: 1000, canvasHeight: 2000 }),
    { x: 0, y: 0, width: 1000, height: 1200 },
  );
  // ...other formats fall back to the base rect.
  assert.deepEqual(
    resolveImageFrameRect({ frame, format: "1:1", canvasWidth: 1000, canvasHeight: 1000 }),
    { x: 0, y: 0, width: 500, height: 1000 },
  );
});

test("pickPrimaryImageFrame returns the first frame or null", () => {
  assert.equal(pickPrimaryImageFrame(undefined), null);
  assert.equal(pickPrimaryImageFrame([]), null);
  const frame: CreativeImageFrame = { id: "a", x: 0, y: 0, width: 1, height: 1 };
  assert.equal(pickPrimaryImageFrame([frame]), frame);
});

test("buildTemplateImageObjects places primary, secondary and headshot slots from frames", () => {
  const frames: CompositionImageFrame[] = [
    // Declared out of role order to prove deterministic ordering.
    { id: "h", role: "agent_headshot", x: 0.7, y: 0.7, width: 0.2, height: 0.2 },
    { id: "p", role: "primary", x: 0, y: 0, width: 1, height: 0.6 },
    { id: "s", role: "secondary", x: 0, y: 0.6, width: 0.5, height: 0.4 },
  ];
  const objects = buildTemplateImageObjects({
    frames,
    format: "1:1",
    canvasWidth: 1000,
    canvasHeight: 1000,
    primarySrc: "data:image/png;base64,USER",
    listingImages: ["L0", "L1"],
    headshots: ["HEAD0"],
  });

  assert.equal(objects.length, 3);
  const primary = objects.find((object) => object.role === "primary_image");
  const secondary = objects.find((object) => object.role === "secondary_image");
  const headshot = objects.find((object) => object.role === "agent_headshot_image");

  // Primary uses the user's photo, so the first listing image is free for the gallery.
  assert.equal(primary?.content, "data:image/png;base64,USER");
  assert.equal(secondary?.content, "L0");
  assert.equal(headshot?.content, "HEAD0");
  assert.equal(headshot?.clip, "circle");
  assert.equal(primary?.clip, "rect");
  assert.deepEqual(
    { x: headshot?.x, y: headshot?.y, width: headshot?.width, height: headshot?.height },
    { x: 700, y: 700, width: 200, height: 200 },
  );
});

test("buildTemplateImageObjects falls back to listing images for the primary slot", () => {
  const objects = buildTemplateImageObjects({
    frames: [
      { id: "p", role: "primary", x: 0, y: 0, width: 1, height: 0.6 },
      { id: "s", role: "secondary", x: 0, y: 0.6, width: 1, height: 0.4 },
    ],
    format: "1:1",
    canvasWidth: 1000,
    canvasHeight: 1000,
    listingImages: ["L0", "L1"],
  });
  assert.equal(objects.find((object) => object.role === "primary_image")?.content, "L0");
  assert.equal(objects.find((object) => object.role === "secondary_image")?.content, "L1");
});

test("buildTemplateImageObjects returns [] when no frame matches the format (full-bleed fallback)", () => {
  const objects = buildTemplateImageObjects({
    frames: [{ id: "p", role: "primary", x: 0, y: 0, width: 1, height: 1, formats: ["9:16"] }],
    format: "1:1",
    canvasWidth: 1000,
    canvasHeight: 1000,
    primarySrc: "x",
  });
  assert.deepEqual(objects, []);
});

test("compositionToCreative places the photo into a supplied image frame", () => {
  const creative = compositionToCreative({
    compositionId: "split",
    format: "4:5",
    palette: buildPalette("#123e75", "#e7b24b"),
    stacks: fontStacks("Georgia", "Inter"),
    copy: { brand: "B", eyebrow: "E", headline: "H", subhead: "S", cta: "C" },
    photoSrc: "data:image/png;base64,photo",
    ids: { creativeId: "c", campaignId: "camp", variantId: "v" },
    safeZones: { metaStory: false, googleDemandGen: true },
    paletteSeed: { primary: "#123e75", accent: "#e7b24b" },
    imageFrame: { x: 120, y: 240, width: 360, height: 480, clip: "circle" },
  });

  const photo = creative.canvas.objects.find((object) => object.role === "primary_image");
  assert.ok(photo);
  assert.deepEqual(
    { x: photo.x, y: photo.y, width: photo.width, height: photo.height },
    { x: 120, y: 240, width: 360, height: 480 },
  );
  assert.equal(photo.clip, "circle");
});

test("compositionToCreative keeps the composition's default photo placement when no frame is given", () => {
  const withFrame = compositionToCreative({
    compositionId: "split",
    format: "4:5",
    palette: buildPalette("#123e75", "#e7b24b"),
    stacks: fontStacks("Georgia", "Inter"),
    copy: { brand: "B", eyebrow: "E", headline: "H", subhead: "S", cta: "C" },
    photoSrc: "data:image/png;base64,photo",
    ids: { creativeId: "c", campaignId: "camp", variantId: "v" },
    safeZones: { metaStory: false, googleDemandGen: true },
    paletteSeed: { primary: "#123e75", accent: "#e7b24b" },
  });

  const photo = withFrame.canvas.objects.find((object) => object.role === "primary_image");
  assert.ok(photo);
  // split places the photo column on the left half — x:0, full height.
  assert.equal(photo.x, 0);
  assert.equal(photo.y, 0);
  assert.ok(photo.width > 0 && (photo.height ?? 0) > 0);
});
