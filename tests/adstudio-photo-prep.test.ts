import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPhotoPrepCacheKey,
  buildPreparePhotoForTemplateFramePrompt,
  buildTemplateRenderFrame,
  deterministicPreparedPhotoAsset,
  selectedImageSlot,
  type PhotoPrepContext,
} from "../src/lib/adstudio/photo-prep.ts";
import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";

const baseContext: PhotoPrepContext = {
  workspaceId: "workspace_1",
  imageHash: "sha256_abc",
  sourceImageRef: "/api/adstudio/media?path=workspace_1%2Flisting.jpg",
  template: {
    key: "just_listed",
    version: 3,
    name: "Just Listed",
    archetype: "listing_hero",
  },
  frame: {
    format: "9:16",
    canvas: { widthPx: 1080, heightPx: 1920 },
    imageSlots: [
      {
        id: "primary_photo",
        role: "primary",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        promptHint: "Keep the front elevation strong.",
      },
    ],
    copySafeZones: [{ id: "headline", x: 0.06, y: 0.58, width: 0.62, height: 0.25 }],
    lockedLayout: true,
  },
  imageSlotId: "primary_photo",
  campaign: {
    goal: "seller_leads",
    offerId: "home_value_update",
    market: { suburb: "Scarborough", city: "Perth", state: "WA" },
    propertyType: "House",
  },
  brand: {
    palette: ["#14314f", "#e7b24b"],
    imageTreatment: "Bright natural real-estate light.",
  },
  brief: "Use the uploaded exterior photo.",
  promptVersion: 4,
  modelProfileVersion: 7,
};

test("photo prep cache key includes template frame and operator versions", () => {
  assert.equal(
    buildPhotoPrepCacheKey(baseContext),
    "adstudio-photo-prep-v1:workspace_1:sha256_abc:just_listed:3:primary_photo:9%3A16:4:7",
  );
});

test("photo prep prompt locks template boundaries and returns a photo asset only", () => {
  const prompt = buildPreparePhotoForTemplateFramePrompt(baseContext);

  assert.match(prompt, /Prepare this real-estate photo for a locked ad template frame/);
  assert.match(prompt, /Do not create a finished advertisement/);
  assert.match(prompt, /Do not add text/);
  assert.match(prompt, /Do not add logos/);
  assert.match(prompt, /Do not add badges/);
  assert.match(prompt, /Do not add borders/);
  assert.match(prompt, /Do not change the template layout/);
  assert.match(prompt, /Return only the edited photo asset/);
  assert.match(prompt, /Image slot: primary_photo/);
  assert.match(prompt, /Copy safe zones: headline/);
  assert.doesNotMatch(prompt, /make an ad/i);
});

test("selectedImageSlot fails loudly when template geometry is missing", () => {
  assert.throws(
    () => selectedImageSlot({ frame: baseContext.frame, imageSlotId: "missing" }),
    /Template image slot not found: missing/,
  );
});

test("template render frame falls back to a full-bleed image slot for existing skeleton templates", () => {
  const template = AD_STUDIO_TEMPLATES.find((item) => item.id === "market_update");
  assert.ok(template);

  const frame = buildTemplateRenderFrame({ template, format: "4:5" });

  assert.equal(frame.format, "4:5");
  assert.deepEqual(frame.canvas, { widthPx: 1080, heightPx: 1350 });
  assert.equal(frame.lockedLayout, true);
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
  assert.ok(frame.copySafeZones.some((zone) => zone.id === "market_panel"));
  assert.match(frame.imageSlots[0]?.promptHint ?? "", /focal point/i);
});

test("deterministicPreparedPhotoAsset preserves template and frame provenance", () => {
  const asset = deterministicPreparedPhotoAsset({
    context: baseContext,
    assetUrl: "/api/adstudio/media?path=workspace_1%2Fprepared.jpg",
  });

  assert.deepEqual(asset, {
    assetUrl: "/api/adstudio/media?path=workspace_1%2Fprepared.jpg",
    widthPx: 1080,
    heightPx: 1920,
    method: "deterministic_smart_crop",
    templateKey: "just_listed",
    templateVersion: 3,
    frameId: "primary_photo",
    format: "9:16",
    promptVersion: 4,
    modelProfileVersion: 7,
    qaStatus: "pending",
  });
});
