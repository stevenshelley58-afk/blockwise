import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { deriveStoryComposition } from "../../scripts/adstudio/v2/lib/story.mjs";
import { evaluateStoryQa } from "../../scripts/adstudio/v2/lib/story-qa.mjs";
import { assertStoryQa } from "../../scripts/adstudio/v2/pack-release.mjs";

const IVORY = "#f4f0e8";

function text(id, inputKey, y, width = 0.72, height = 0.05, color = "#2b2118") {
  return {
    id, inputKey, type: "text", box: { x: 0.1, y, width, height },
    typo: { color },
  };
}

function goodDoc() {
  const layers = [
    { id: "story-slot", type: "image_slot", inputKey: "photo", box: { x: 0.1, y: 0.27, width: 0.8, height: 0.34 } },
    text("story-text-headline", "headline", 0.15, 0.8, 0.1),
    text("story-text-supporting", "supporting", 0.64),
    text("story-text-handle", "handle", 0.75, 0.4),
    text("story-text-arrow", "arrow", 0.75, 0.16),
    { id: "story-backing-supporting", type: "overlay_patch", box: { x: 0.078, y: 0.622, width: 0.764, height: 0.086 } },
    { id: "story-backing-cta", type: "overlay_patch", box: { x: 0.08, y: 0.732, width: 0.78, height: 0.086 } },
  ];
  return {
    formats: {
      story: {
        format: "9:16", width: 1080, height: 1920, layers,
        storyPolicy: {
          schema: "adstudio.story-policy.v1", safeTopPx: 250, safeBottomPx: 340,
          maxDeadSpacePx: 300, backingColour: IVORY,
          backingLayerIds: ["story-backing-supporting", "story-backing-cta"],
          ctaGroup: { layerIds: ["story-text-handle", "story-text-arrow"], maxGapPx: 52 },
        },
      },
    },
  };
}

async function ivoryPreview() {
  return sharp({ create: { width: 1080, height: 1920, channels: 4, background: IVORY } }).png().toBuffer();
}

async function darkPreview() {
  return sharp({ create: { width: 1080, height: 1920, channels: 4, background: "#211a14" } }).png().toBuffer();
}

async function nonUniformPreview() {
  const dark = await sharp({ create: { width: 36, height: 36, channels: 4, background: "#211a14" } }).png().toBuffer();
  return sharp(await ivoryPreview())
    .composite([{ input: dark, left: 497, top: 1210 }])
    .png()
    .toBuffer();
}

describe("deterministic Story composition", () => {
  it("moves semantic roles into bounded lanes and groups the CTA", () => {
    const result = deriveStoryComposition([
      { id: "feed-slot", type: "image_slot", inputKey: "photo", box: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 } },
      text("feed-headline", "headline", 0.1),
      text("feed-supporting", "supporting", 0.66),
      text("feed-handle", "handle", 0.85),
      text("feed-arrow", "arrow", 0.83, 0.16),
    ]);
    const support = result.layers.find((layer) => layer.inputKey === "supporting");
    const handle = result.layers.find((layer) => layer.inputKey === "handle");
    const arrow = result.layers.find((layer) => layer.inputKey === "arrow");
    assert.ok(support.box.y > 0.62);
    assert.equal(handle.box.y, arrow.box.y);
    assert.equal(result.policy.ctaGroup.layerIds.length, 2);
    assert.equal(result.backings.length, 2);
  });

  it("keeps measured text lines attached when a Story role moves lanes", () => {
    const source = {
      id: "feed-supporting", type: "text", inputKey: "supporting",
      box: { x: 0.1, y: 0.2, width: 0.7, height: 0.08 },
      typo: { measuredLines: [{ text: "line", box: { x: 0.1, y: 0.2, width: 0.7, height: 0.08 }, sizeRatio: 0.5 }] },
    };
    const result = deriveStoryComposition([source]);
    const moved = result.layers.find((layer) => layer.id === source.id);
    assert.equal(moved.box.y, 0.635);
    assert.equal(moved.typo.measuredLines[0].box.y, moved.box.y);
  });

  it("rejects a supporting line that has no legible backing over a dark photo", async () => {
    const doc = goodDoc();
    doc.formats.story.layers = doc.formats.story.layers.filter((layer) => layer.id !== "story-backing-supporting");
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /supporting copy requires a full-coverage backing patch/);
  });

  it("passes rendered Story QA when supporting and CTA backings are present", async () => {
    const result = await evaluateStoryQa(goodDoc(), await ivoryPreview());
    assert.equal(result.passed, true, result.blockers.join("; "));
  });

  it("rejects a rendered dark backing even when the policy names an ivory patch", async () => {
    const result = await evaluateStoryQa(goodDoc(), await darkPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /not rendered uniformly in canonical ivory/);
  });

  it("rejects a candidate policy that widens the canonical geometry bounds", async () => {
    const doc = goodDoc();
    doc.formats.story.storyPolicy.maxDeadSpacePx = 900;
    doc.formats.story.storyPolicy.ctaGroup.maxGapPx = 900;
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /canonical 420px/);
    assert.match(result.blockers.join("; "), /canonical 52px/);
  });

  it("rejects low-contrast supporting copy against the ivory backing", async () => {
    const doc = goodDoc();
    doc.formats.story.layers.find((layer) => layer.id === "story-text-supporting").typo.color = IVORY;
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /contrast against canonical ivory/);
  });

  it("samples multiple exposed backing points for uniformity", async () => {
    const result = await evaluateStoryQa(goodDoc(), await nonUniformPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /not rendered uniformly in canonical ivory/);
  });

  it("rejects a CTA whose handle and arrow are not a safe grouped unit", async () => {
    const doc = goodDoc();
    doc.formats.story.layers.find((layer) => layer.id === "story-text-arrow").box.y = 0.79;
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /CTA group is too spread out/);
  });

  it("rejects unbounded dead space between the photo and supporting copy", async () => {
    const doc = goodDoc();
    doc.formats.story.layers.find((layer) => layer.id === "story-slot").box.height = 0.12;
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /dead space/);
  });

  it("rejects a release candidate with no machine-readable Story policy", async () => {
    const doc = goodDoc();
    delete doc.formats.story.storyPolicy;
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /story-policy\.v1 is required/);
    assert.throws(() => assertStoryQa("meta-missing-policy", result), /Story QA failed/);
  });

  it("reports native story-first layouts precisely when no native policy is present", async () => {
    const doc = goodDoc();
    doc.formats.story.native = true;
    delete doc.formats.story.storyPolicy;
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /native story-first layout.*automatic native policy derivation is unsupported/);
  });
});
