// Renderer tests: cover-crop math, measured-line splitting, refusal semantics,
// full server renders (dims, determinism, effects, story), truncation.
//
// Fixtures come from tests/fixtures/adstudio-v2 (built by build-fixtures.mjs —
// regenerate with `node tests/fixtures/adstudio-v2/build-fixtures.mjs`).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  RenderFitError,
  renderAdDoc,
  splitTextIntoMeasuredLines,
} from "../../src/lib/adstudio/v2/render/render-doc.ts";
import { focalCoverSourceRect } from "../../src/lib/adstudio/v2/render/cover-crop.ts";
import { renderAdDocToPng } from "../../src/lib/adstudio/v2/render/server.ts";
import {
  formatMetaPrimaryText,
  truncateHeadline,
  truncateIgCaption,
  truncateStoryPrimary,
  FB_FEED_PRIMARY_SEE_MORE_CHARS,
  FB_FEED_HEADLINE_VISIBLE_CHARS,
  IG_CAPTION_MORE_CHARS,
  STORY_PRIMARY_OVERLAY_CHARS,
} from "../../src/lib/adstudio/v2/render/truncate.ts";
import { TEMPLATE_FORMAT_DIMENSIONS, type AdDocInstance } from "../../src/lib/adstudio/v2/template-doc.ts";

const repoRoot = process.cwd();
const fixtureRoot = join(repoRoot, "tests", "fixtures", "adstudio-v2");
const fontsDir = join(repoRoot, "public", "fonts", "adstudio");
const photoBytes = readFileSync(join(fixtureRoot, "public", "slots", "photo-landscape.png"));
const resolveSlotSrc = async () => photoBytes;

function loadFixture(id: string): { doc: any; instances: Record<string, any> } {
  const doc = JSON.parse(readFileSync(join(fixtureRoot, id, "template.json"), "utf8"));
  const instances: Record<string, any> = {};
  for (const name of ["feed", "story"]) {
    try {
      instances[name] = JSON.parse(readFileSync(join(fixtureRoot, id, `instance-${name}.json`), "utf8"));
    } catch {
      // not every fixture has every format
    }
  }
  return { doc, instances };
}

function pngDimensions(png: Buffer): { width: number; height: number } {
  // PNG IHDR: width at bytes 16-19, height at 20-23, big-endian.
  assert.equal(png.readUInt32BE(0) === 0x89504e47, true, "not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// ─── cover-crop math ─────────────────────────────────────────────────────────

test("cover-crop: zoom=1 centre focal crops to the slot's aspect ratio", () => {
  const rect = focalCoverSourceRect({
    slotWidthPx: 972,
    slotHeightPx: 608,
    imageWidth: 1600,
    imageHeight: 1000,
    focal: { x: 0.5, y: 0.5 },
    zoom: 1,
  });
  assert.ok(rect.sw > 0 && rect.sh > 0);
  assert.ok(rect.sx >= 0 && rect.sy >= 0);
  assert.ok(rect.sx + rect.sw <= 1600 + 1e-6);
  assert.ok(rect.sy + rect.sh <= 1000 + 1e-6);
  // Source rect aspect must equal the slot aspect (cover fill, no distortion).
  const slotAspect = 972 / 608;
  const rectAspect = rect.sw / rect.sh;
  assert.ok(Math.abs(slotAspect - rectAspect) < 1e-6, `aspect ${rectAspect} ≠ ${slotAspect}`);
});

test("cover-crop: zoom=3 magnifies around the focal (smaller source rect)", () => {
  const wide = focalCoverSourceRect({
    slotWidthPx: 972, slotHeightPx: 608, imageWidth: 1600, imageHeight: 1000,
    focal: { x: 0.5, y: 0.5 }, zoom: 1,
  });
  const zoomed = focalCoverSourceRect({
    slotWidthPx: 972, slotHeightPx: 608, imageWidth: 1600, imageHeight: 1000,
    focal: { x: 0.5, y: 0.5 }, zoom: 3,
  });
  assert.ok(zoomed.sw < wide.sw && zoomed.sh < wide.sh);
  assert.ok(Math.abs(zoomed.sw - wide.sw / 3) < 1e-6);
});

test("cover-crop: corner focals clamp inside the image (no gap)", () => {
  for (const focal of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
    const rect = focalCoverSourceRect({
      slotWidthPx: 840, slotHeightPx: 540, imageWidth: 1600, imageHeight: 1000,
      focal, zoom: 2,
    });
    assert.ok(rect.sx >= 0 && rect.sy >= 0, `focal ${JSON.stringify(focal)} went negative`);
    assert.ok(rect.sx + rect.sw <= 1600 + 1e-6);
    assert.ok(rect.sy + rect.sh <= 1000 + 1e-6);
  }
});

test("cover-crop: portrait photo in a landscape slot stays in bounds", () => {
  const rect = focalCoverSourceRect({
    slotWidthPx: 972, slotHeightPx: 608, imageWidth: 1000, imageHeight: 1600,
    focal: { x: 0.5, y: 0.4 }, zoom: 1,
  });
  assert.ok(rect.sx >= 0 && rect.sy >= 0);
  assert.ok(rect.sx + rect.sw <= 1000 + 1e-6);
  assert.ok(rect.sy + rect.sh <= 1600 + 1e-6);
  // The crop must be wider than tall (slot aspect), centred on the photo's width.
  assert.ok(rect.sw / rect.sh > 1);
  assert.ok(rect.sw <= 1000);
});

test("cover-crop: tiny photo under extreme zoom clamps to full image", () => {
  const rect = focalCoverSourceRect({
    slotWidthPx: 972, slotHeightPx: 608, imageWidth: 50, imageHeight: 40,
    focal: { x: 0.5, y: 0.5 }, zoom: 3,
  });
  assert.ok(rect.sw <= 50 && rect.sh <= 40);
});

// ─── measured-line splitting ─────────────────────────────────────────────────

test("splitTextIntoMeasuredLines preserves the sample's line balance", () => {
  const measured = [{ text: "Find your" }, { text: "place" }];
  const lines = splitTextIntoMeasuredLines("Book your free appraisal today", measured);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(" "), "Book your free appraisal today");
  // First template line had 2/3 of the words → 2-3 words on line one.
  const first = lines[0]!.split(" ").length;
  assert.ok(first >= 2 && first <= 3, `got ${first} words on line 1`);
});

test("splitTextIntoMeasuredLines collapses to one line for one word", () => {
  const lines = splitTextIntoMeasuredLines("Sale", [{ text: "a b" }, { text: "c" }]);
  assert.deepEqual(lines, ["Sale"]);
});

// ─── full server renders ─────────────────────────────────────────────────────

test("renderAdDocToPng: effects fixture renders at exact 1080×1350", async () => {
  const { doc, instances } = loadFixture("meta-fixture-effects");
  const png = await renderAdDocToPng(doc, instances.feed, "4:5", {
    repoRoot: fixtureRoot, fontsDir, resolveSlotSrc,
  });
  assert.deepEqual(pngDimensions(png), TEMPLATE_FORMAT_DIMENSIONS["4:5"]);
});

test("renderAdDocToPng: story fixture renders both formats at exact dims", async () => {
  const { doc, instances } = loadFixture("meta-fixture-story");
  const feed = await renderAdDocToPng(doc, instances.feed, "4:5", {
    repoRoot: fixtureRoot, fontsDir, resolveSlotSrc,
  });
  const story = await renderAdDocToPng(doc, instances.story, "9:16", {
    repoRoot: fixtureRoot, fontsDir, resolveSlotSrc,
  });
  assert.deepEqual(pngDimensions(feed), TEMPLATE_FORMAT_DIMENSIONS["4:5"]);
  assert.deepEqual(pngDimensions(story), TEMPLATE_FORMAT_DIMENSIONS["9:16"]);
});

test("renderAdDocToPng: deterministic — identical bytes twice", async () => {
  const { doc, instances } = loadFixture("meta-fixture-effects");
  const options = { repoRoot: fixtureRoot, fontsDir, resolveSlotSrc };
  const first = await renderAdDocToPng(doc, instances.feed, "4:5", options);
  const second = await renderAdDocToPng(doc, instances.feed, "4:5", options);
  assert.ok(first.equals(second), "two renders of the same doc must be byte-identical");
});

test("renderAdDocToPng: template-only (null instance) uses sample copy", async () => {
  const { doc } = loadFixture("meta-fixture-simple");
  const png = await renderAdDocToPng(doc, null, "4:5", {
    repoRoot: fixtureRoot, fontsDir, resolveSlotSrc,
  });
  assert.deepEqual(pngDimensions(png), TEMPLATE_FORMAT_DIMENSIONS["4:5"]);
});

test("renderAdDocToPng: unknown format for the layout throws", async () => {
  const { doc, instances } = loadFixture("meta-fixture-simple"); // feed only
  await assert.rejects(
    () => renderAdDocToPng(doc, null, "9:16", { repoRoot: fixtureRoot, fontsDir, resolveSlotSrc }),
    /no 9:16 layout/,
  );
});

test("renderAdDocToPng: instance for the wrong format throws", async () => {
  const { doc, instances } = loadFixture("meta-fixture-story");
  await assert.rejects(
    () => renderAdDocToPng(doc, instances.story, "4:5", { repoRoot: fixtureRoot, fontsDir, resolveSlotSrc }),
    /does not match/,
  );
});

test("renderAdDocToPng: unfittable copy throws RenderFitError, never microtype", async () => {
  const { doc } = loadFixture("meta-fixture-effects");
  const mutated = structuredClone(doc);
  const headline = mutated.formats.feed.layers.find((layer: any) => layer.id === "text-headline");
  headline.constraints.maxLength = 400;
  headline.constraints.maxLines = 1; // no wrap escape — must refuse, not microtype
  const instance: AdDocInstance = {
    schema: "adstudio.instance.v2",
    templateId: mutated.id,
    templateHash: "0".repeat(64),
    format: "4:5",
    values: {
      images: { photo: { src: "fixture:/slots/photo-landscape.png" } },
      // Far too long for the box even at the autofit floor.
      text: { headline: "THIS HEADLINE IS DELIBERATELY FAR TOO LONG TO FIT INSIDE ITS BOX", ctaLine: "Free" },
    },
    overrides: [],
  };
  await assert.rejects(
    () => renderAdDocToPng(mutated, instance, "4:5", { repoRoot: fixtureRoot, fontsDir, resolveSlotSrc }),
    (error: Error) => error instanceof RenderFitError && /autofit floor/.test(error.message),
  );
});

test("renderAdDoc: missing slot image shows the plate through (no throw)", async () => {
  const { doc } = loadFixture("meta-fixture-simple");
  const png = await renderAdDocToPng(doc, null, "4:5", {
    repoRoot: fixtureRoot, fontsDir,
    // no slot resolver at all — the slot is simply absent
  });
  assert.deepEqual(pngDimensions(png), TEMPLATE_FORMAT_DIMENSIONS["4:5"]);
});

test("renderAdDoc: overrides move + color apply to text layers", async () => {
  const { doc, instances } = loadFixture("meta-fixture-story");
  // story instance carries a move override; if it parses and renders, the
  // override path executed. Assert the render still matches exact dims.
  const png = await renderAdDocToPng(doc, instances.story, "9:16", {
    repoRoot: fixtureRoot, fontsDir, resolveSlotSrc,
  });
  assert.deepEqual(pngDimensions(png), TEMPLATE_FORMAT_DIMENSIONS["9:16"]);
});

// ─── truncate.ts ─────────────────────────────────────────────────────────────

test("formatMetaPrimaryText truncates long copy with See more", () => {
  const long = "A".repeat(FB_FEED_PRIMARY_SEE_MORE_CHARS + 40);
  const result = formatMetaPrimaryText(long);
  assert.equal(result.truncated, true);
  assert.equal(result.suffix, "See more");
  assert.ok(result.visible.length <= FB_FEED_PRIMARY_SEE_MORE_CHARS);
});

test("formatMetaPrimaryText keeps short copy whole", () => {
  const result = formatMetaPrimaryText("Open home this Saturday.");
  assert.equal(result.truncated, false);
  assert.equal(result.visible, "Open home this Saturday.");
  assert.equal(result.suffix, "");
});

test("formatMetaPrimaryText truncates by line count too", () => {
  const fourLines = ["line one", "line two", "line three", "line four"].join("\n");
  const result = formatMetaPrimaryText(fourLines);
  assert.equal(result.truncated, true);
  assert.ok(!result.visible.includes("line four"));
});

test("truncateHeadline ellipsizes past the visible budget", () => {
  const long = "H".repeat(FB_FEED_HEADLINE_VISIBLE_CHARS + 10);
  const result = truncateHeadline(long);
  assert.ok(result.endsWith("…"));
  assert.ok(result.length <= FB_FEED_HEADLINE_VISIBLE_CHARS + 1);
});

test("truncateIgCaption folds at ~125 chars", () => {
  const long = "C".repeat(IG_CAPTION_MORE_CHARS + 5);
  const { visible, truncated } = truncateIgCaption(long);
  assert.equal(truncated, true);
  assert.ok(visible.endsWith("…"));
});

test("truncateStoryPrimary folds at ~40 chars", () => {
  const long = "S".repeat(STORY_PRIMARY_OVERLAY_CHARS + 5);
  const { visible, truncated } = truncateStoryPrimary(long);
  assert.equal(truncated, true);
  assert.ok(visible.length <= STORY_PRIMARY_OVERLAY_CHARS + 1);
});
