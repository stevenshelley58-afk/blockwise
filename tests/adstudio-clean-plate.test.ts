import assert from "node:assert/strict";
import test from "node:test";

import { cleanPlateFileNameSeed, cleanPlateTextBoxes, generateCleanPlate } from "../src/lib/adstudio/clean-plate.ts";
import {
  compositeCloneRegionsEdit,
  createCloneRegionsEditMask,
} from "../src/lib/adstudio/clone-generation.ts";
import { buildCleanPlateRequest } from "../src/lib/adstudio/reference-clone.ts";
import { applyEditorSceneQa } from "../src/lib/adstudio/clone-qa.ts";
import type { AdStudioCloneQa, AdStudioCloneRegion } from "../src/lib/adstudio/types.ts";

async function solidPng(width: number, height: number, rgb: { r: number; g: number; b: number }): Promise<string> {
  const { default: sharp } = await import("sharp");
  const png = await sharp({
    create: { width, height, channels: 3, background: rgb },
  }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function pixelAt(dataUrl: string, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const { default: sharp } = await import("sharp");
  const bytes = Buffer.from(dataUrl.split(",")[1]!, "base64");
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const index = (y * raw.info.width + x) * raw.info.channels;
  return { r: raw.data[index]!, g: raw.data[index + 1]!, b: raw.data[index + 2]! };
}

test("multi-region masks repaint every text box and preserve the rest", async () => {
  const image = await solidPng(200, 200, { r: 250, g: 250, b: 250 });
  const mask = await createCloneRegionsEditMask(image, [
    { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
    { x: 0.6, y: 0.7, width: 0.3, height: 0.2 },
  ]);
  assert.ok(mask);

  // Inside both boxes: repaintable (black). Between them: preserved (white).
  const inFirst = await pixelAt(mask, 40, 30);
  const inSecond = await pixelAt(mask, 150, 160);
  const outside = await pixelAt(mask, 100, 100);
  assert.ok(inFirst.r < 10 && inSecond.r < 10);
  assert.ok(outside.r > 245);
});

test("multi-region composite keeps model output only inside the text boxes", async () => {
  const original = await solidPng(100, 100, { r: 0, g: 0, b: 255 });
  const edited = await solidPng(100, 100, { r: 255, g: 0, b: 0 });
  const bounded = await compositeCloneRegionsEdit(original, edited, [
    { x: 0.0, y: 0.0, width: 0.2, height: 0.2 },
    { x: 0.7, y: 0.7, width: 0.2, height: 0.2 },
  ]);

  const insideFirst = await pixelAt(bounded, 5, 5);
  const insideSecond = await pixelAt(bounded, 80, 80);
  const centre = await pixelAt(bounded, 50, 50);
  assert.ok(insideFirst.r > 245 && insideSecond.r > 245, "edited pixels survive inside boxes");
  assert.ok(centre.b > 245 && centre.r < 10, "pixels between boxes come from the original");
});

test("clean-plate request demands text removal without layout changes", () => {
  const request = buildCleanPlateRequest({ currentImage: "data:image/png;base64,QQ==", aspectRatio: "4:5" });
  assert.match(request.prompt, /Remove every piece of rendered text/);
  assert.match(request.prompt, /reconstruct the underlying background/);
  assert.match(request.negativePrompt ?? "", /no text, letters, words, numbers/);
  assert.equal(request.referenceAssets?.[0], "data:image/png;base64,QQ==");
  assert.equal(request.requiresReferenceAssets, true);
});

test("only positive text regions become plate boxes", () => {
  const regions: AdStudioCloneRegion[] = [
    { key: "headline", kind: "text", box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 } },
    { key: "photo", kind: "image", box: { x: 0, y: 0, width: 1, height: 0.6 } },
    { key: "empty", kind: "text", box: { x: 0.2, y: 0.9, width: 0, height: 0.05 } },
  ];
  const boxes = cleanPlateTextBoxes(regions);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0]?.x, 0.1);
});

test("plate generation without text regions is a no-op instead of an AI call", async () => {
  const result = await generateCleanPlate({
    supabase: { storage: { from: () => ({ upload: async () => ({ error: null }) }) } },
    workspaceId: "w",
    userId: "u",
    correlationId: "c",
    format: "4:5",
    renderImage: "data:image/png;base64,QQ==",
    regions: [{ key: "photo", kind: "image", box: { x: 0, y: 0, width: 1, height: 1 } }],
    fileNameSeed: cleanPlateFileNameSeed("c", "4:5"),
  });
  assert.equal(result, null);
});

test("plate file name seeds are unique per format and storage-safe", () => {
  assert.equal(cleanPlateFileNameSeed("abc", "4:5"), "abc-plate-4x5");
  assert.notEqual(cleanPlateFileNameSeed("abc", "4:5"), cleanPlateFileNameSeed("abc", "9:16"));
});

function baseQa(): AdStudioCloneQa {
  return {
    passed: true,
    attempts: 1,
    checkedAt: "2026-07-01T00:00:00.000Z",
    copyChecks: [
      { key: "headline", expected: "OLD HEADLINE", rendered: "OLD HEADLINE", exact: true },
      { key: "contact", expected: "0400 000 000", rendered: "0400 000 000", exact: true },
    ],
    defects: [],
    regions: [
      { key: "headline", kind: "text", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 } },
      { key: "photo", kind: "image", box: { x: 0, y: 0.3, width: 1, height: 0.5 } },
    ],
  };
}

test("editor-scene QA folds every submitted text value deterministically", () => {
  const next = applyEditorSceneQa(baseQa(), {
    headline: "NEW HEADLINE",
    suburb_line: "Now selling in Scarborough",
  });
  assert.equal(next.passed, true);
  assert.equal(next.model, "editor-scene-renderer");
  const headline = next.copyChecks.find((check) => check.key === "headline");
  assert.equal(headline?.expected, "NEW HEADLINE");
  assert.equal(headline?.exact, true);
  assert.ok(next.copyChecks.some((check) => check.key === "suburb_line" && check.exact));
  assert.ok(next.copyChecks.some((check) => check.key === "contact"));
});

test("editor-scene QA replaces text regions and keeps unmanaged image regions", () => {
  const next = applyEditorSceneQa(baseQa(), { headline: "NEW" }, [
    { key: "headline", kind: "text", box: { x: 0.2, y: 0.15, width: 0.6, height: 0.12 } },
  ]);
  const headline = next.regions.find((region) => region.key === "headline");
  assert.equal(headline?.box.x, 0.2);
  assert.ok(next.regions.some((region) => region.key === "photo" && region.kind === "image"));
});

test("editor-scene QA clamps out-of-range submitted boxes", () => {
  const next = applyEditorSceneQa(baseQa(), {}, [
    { key: "headline", kind: "text", box: { x: -0.5, y: 2, width: 1.4, height: 0.1 } },
  ]);
  const headline = next.regions.find((region) => region.key === "headline");
  assert.deepEqual(headline?.box, { x: 0, y: 1, width: 1, height: 0.1 });
});
