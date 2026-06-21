import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPhotoPrepCacheKey,
  buildTemplateRenderFrame,
  deterministicPreparedPhotoAsset,
  selectPhotoPrepMethod,
  selectedImageSlot,
  type PhotoPrepContext,
} from "../src/lib/adstudio/photo-prep.ts";
import { resolveAdStudioTemplate } from "../src/lib/adstudio/templates.ts";

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

test("selectPhotoPrepMethod chooses a free crop when the source already fits the slot", () => {
  // 9:16 slot (1080x1920). A portrait source of the same aspect needs no model.
  const method = selectPhotoPrepMethod({
    frame: baseContext.frame,
    imageSlotId: baseContext.imageSlotId,
    sourceImage: { naturalWidth: 1080, naturalHeight: 1920 },
  });
  assert.equal(method, "deterministic_smart_crop");
});

test("selectPhotoPrepMethod reframes a moderate mismatch and extends a large one", () => {
  // A 4:5-ish source into a 9:16 slot is a moderate mismatch => reframe.
  assert.equal(
    selectPhotoPrepMethod({
      frame: baseContext.frame,
      imageSlotId: baseContext.imageSlotId,
      sourceImage: { naturalWidth: 1080, naturalHeight: 1350 },
    }),
    "model_reframe",
  );
  // A wide landscape source into a 9:16 slot would crop away too much => extend.
  assert.equal(
    selectPhotoPrepMethod({
      frame: baseContext.frame,
      imageSlotId: baseContext.imageSlotId,
      sourceImage: { naturalWidth: 1920, naturalHeight: 1080 },
    }),
    "model_extend",
  );
});

test("selectPhotoPrepMethod falls back to model_reframe when source dimensions are unknown", () => {
  assert.equal(
    selectPhotoPrepMethod({ frame: baseContext.frame, imageSlotId: baseContext.imageSlotId }),
    "model_reframe",
  );
});

test("selectedImageSlot fails loudly when template geometry is missing", () => {
  assert.throws(
    () => selectedImageSlot({ frame: baseContext.frame, imageSlotId: "missing" }),
    /Template image slot not found: missing/,
  );
});

test("template render frame falls back to a full-bleed image slot for existing skeleton templates", () => {
  const template = resolveAdStudioTemplate("market_update");

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
