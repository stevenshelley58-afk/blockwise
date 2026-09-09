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
    { id: "story-slot", z: 1, type: "image_slot", inputKey: "photo", box: { x: 0.1, y: 0.27, width: 0.8, height: 0.34 } },
    { ...text("story-text-headline", "headline", 0.15, 0.8, 0.1), z: 2 },
    { id: "story-backing-supporting", z: 3, type: "overlay_patch", box: { x: 0.078, y: 0.622, width: 0.764, height: 0.086 } },
    { ...text("story-text-supporting", "supporting", 0.64), z: 4 },
    { id: "story-backing-cta", z: 5, type: "overlay_patch", box: { x: 0.08, y: 0.732, width: 0.78, height: 0.086 } },
    { ...text("story-text-handle", "handle", 0.75, 0.4), z: 6 },
    { ...text("story-text-arrow", "arrow", 0.75, 0.16), z: 7 },
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
    assert.match(result.blockers.join("; "), /supporting copy requires a full-coverage declared backing patch/);
  });

  it("passes rendered Story QA when supporting and CTA backings are present", async () => {
    const result = await evaluateStoryQa(goodDoc(), await ivoryPreview());
    assert.equal(result.passed, true, result.blockers.join("; "));
  });

  it("rejects the c15 About and Property Features collision as essential text overlap", async () => {
    const doc = goodDoc();
    const about = doc.formats.story.layers.find((layer) => layer.id === "story-text-supporting");
    about.id = "story-about-copy";
    about.inputKey = "aboutCopy";
    about.box = { x: 0.1, y: 1108 / 1920, width: 0.78, height: 216 / 1920 };
    doc.formats.story.layers.push(text("story-features-heading", "featuresHeading", 1218 / 1920, 0.72, 48 / 1920));

    const result = await evaluateStoryQa(doc, await ivoryPreview());

    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /story-about-copy \(about-copy\).*story-features-heading \(feature-heading\).*overlap by 106px/);
  });

  it("allows adjacent About copy, feature heading, and feature rows without overlap", async () => {
    const doc = goodDoc();
    const about = doc.formats.story.layers.find((layer) => layer.id === "story-text-supporting");
    about.id = "story-about-copy";
    about.inputKey = "aboutCopy";
    about.box = { x: 0.1, y: 0.51, width: 0.78, height: 0.06 };
    doc.formats.story.layers.push(
      text("story-features-heading", "featuresHeading", 0.57, 0.72, 0.025),
      text("story-feature-row-1", "featureRow1", 0.595, 0.34, 0.02),
      { ...text("story-feature-row-2", "featureRow2", 0.595, 0.34, 0.02), box: { x: 0.48, y: 0.595, width: 0.34, height: 0.02 } },
    );

    const result = await evaluateStoryQa(doc, await ivoryPreview());

    assert.equal(result.passed, true, result.blockers.join("; "));
  });

  it("rejects the c15 Story address when painted ink exceeds its geometry by four pixels", async () => {
    const doc = goodDoc();
    const address = text("story-address", "address", 0.51, 344 / 1080, 50 / 1920);
    address.box.x = 624 / 1080;
    address.typo.paintedBounds = { x: 713, y: 990, width: 259, height: 38 };
    doc.formats.story.layers.push(address);

    const result = await evaluateStoryQa(doc, await ivoryPreview());

    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /story-address painted bounds exceed declared geometry \(right 4px\)/);
  });

  it("rejects a rendered dark backing even when the policy names an ivory patch", async () => {
    const result = await evaluateStoryQa(goodDoc(), await darkPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /does not match its declared design-system colour/);
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
    assert.match(result.blockers.join("; "), /contrast against its rendered backing/);
  });

  it("samples multiple exposed backing points for uniformity", async () => {
    const result = await evaluateStoryQa(goodDoc(), await nonUniformPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /not rendered uniformly in its design-system colour/);
  });

  it("uses all property media for dead-space QA but ignores an optional logo", async () => {
    const doc = goodDoc();
    doc.formats.story.layers.unshift({
      id: "logo_slot", type: "image_slot", inputKey: "logo_slot",
      box: { x: 0.72, y: 0.13, width: 0.2, height: 0.04 },
    });
    doc.formats.story.layers.push({
      id: "story-supporting-photo", type: "image_slot", inputKey: "property_image_1",
      box: { x: 0.1, y: 0.62, width: 0.18, height: 0.08 },
    });
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, true, result.blockers.join("; "));
  });

  it("checks CTA copy against its authored vector backing", async () => {
    const doc = goodDoc();
    const handle = doc.formats.story.layers.find((layer) => layer.id === "story-text-handle");
    const arrow = doc.formats.story.layers.find((layer) => layer.id === "story-text-arrow");
    handle.z = 12;
    arrow.z = 14;
    handle.typo = { color: "#11181b", weight: 600, sizeRatio: 0.45 };
    arrow.typo = { color: "#ffffff", weight: 700, sizeRatio: 0.5 };
    doc.restyle = { paletteRoles: { background: "#ffffff", surface: "#dce1e4", accent: "#657b88", ink: "#11181b", inverseText: "#ffffff" } };
    doc.formats.story.storyPolicy.backingColour = "#ffffff";
    doc.formats.story.layers.push(
      { id: "story-contact-bar", z: 11, type: "vector", shape: "rect", fill: "#dce1e4", box: { x: 0.08, y: 0.732, width: 0.46, height: 0.086 } },
      { id: "story-cta-button", z: 13, type: "vector", shape: "rounded", fill: "#657b88", box: { x: 0.68, y: 0.732, width: 0.22, height: 0.086 } },
    );
    handle.box = { x: 0.1, y: 0.75, width: 0.4, height: 0.04 };
    arrow.box = { x: 0.71, y: 0.75, width: 0.16, height: 0.04 };
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, true, result.blockers.join("; "));

    arrow.typo.color = "#657b88";
    const lowContrast = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(lowContrast.passed, false);
    assert.match(lowContrast.blockers.join("; "), /rendered backing/);
  });

  it("rejects a backing colour outside the template design system", async () => {
    const doc = goodDoc();
    doc.restyle = { paletteRoles: { background: "#ffffff", ink: "#2b2118" } };
    doc.formats.story.storyPolicy.backingColour = "#ff00ff";
    const result = await evaluateStoryQa(doc, await ivoryPreview());
    assert.equal(result.passed, false);
    assert.match(result.blockers.join("; "), /belong to the template design system/);
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
