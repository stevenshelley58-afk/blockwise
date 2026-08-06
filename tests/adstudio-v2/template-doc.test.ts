// Contract tests for src/lib/adstudio/v2/template-doc.ts.
//
// One rich valid fixture parses; every rule in plan §3 ("Rules the zod schema
// must enforce") has a failing mutation so a future schema edit that silently
// drops a rule turns this file red.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  adDocInstanceSchema,
  boxOverlapRatio,
  hasNonTrivialRestyle,
  isAdDocInstanceShape,
  isNormalizedBox,
  normalizeCanonicalJson,
  storySafeZoneViolation,
  templateDocV2Schema,
} from "../../src/lib/adstudio/v2/template-doc.ts";

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "adstudio-v2");

function loadDoc(id: string): any {
  return JSON.parse(readFileSync(join(fixtureRoot, id, "template.json"), "utf8"));
}

/** Clone + mutate one deep field, expect the schema to reject it. */
async function expectRuleViolation(id: string, mutate: (doc: any) => void, hint: RegExp) {
  const doc = loadDoc(id);
  mutate(doc);
  const result = templateDocV2Schema.safeParse(doc);
  assert.equal(result.success, false, `mutation should fail: ${hint}`);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => issue.message).join(" | ");
    assert.match(messages, hint, `wrong failure: ${messages}`);
  }
}

// ─── the valid fixture parses ────────────────────────────────────────────────

test("valid fixture parses: meta-fixture-story (ready, feed+story)", () => {
  const result = templateDocV2Schema.safeParse(loadDoc("meta-fixture-story"));
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
});

test("valid fixtures parse: simple and effects drafts", () => {
  for (const id of ["meta-fixture-simple", "meta-fixture-effects"]) {
    const result = templateDocV2Schema.safeParse(loadDoc(id));
    assert.equal(result.success, true, `${id}: ${result.success ? "" : JSON.stringify(result.error.issues)}`);
  }
});

// ─── identity rules ──────────────────────────────────────────────────────────

test("rule: id must match ^meta-[a-z0-9-]+$", async () => {
  await expectRuleViolation("meta-fixture-simple", (doc) => { doc.id = "Bad_ID"; }, /id must match/);
});

test("rule: schema tag is literal", async () => {
  await expectRuleViolation("meta-fixture-simple", (doc) => { doc.schema = "adstudio.template.v1"; }, /adstudio\.template\.v2/);
});

test("rule: sourceAd needs provenance (creativeId or file)", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { delete doc.provenance.sourceAd.file; },
    /provenance is not optional/,
  );
});

test("rule: content hashes are sha256", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.provenance.sourceAd.contentHash = "zzz"; },
    /sha256/,
  );
});

test("rule: sample must be a deterministic render", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.provenance.sample.generatedBy = "image_model"; },
    /deterministic_render/,
  );
});

// ─── input contract rules ────────────────────────────────────────────────────

test("rule: text layer referencing an undeclared input fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].inputKey = "ghost"; },
    /undeclared text input ghost/,
  );
});

test("rule: text input with no layer in a format fails (orphan input)", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.inputs.text.push({ key: "extra", label: "Extra", required: true, maxLength: 10, sample: "x" }); },
    /text input extra has no text layer/,
  );
});

test("rule: image input with no slot in a format fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.inputs.images.push({ key: "second", label: "Second", required: false, description: "x" }); },
    /image input second has no image slot/,
  );
});

test("rule: baked key cannot carry a text layer", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.exactness.bakedTextKeys = ["subline"]; },
    /renders baked key subline/,
  );
});

test("rule: baked key must be a declared text input", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.exactness.bakedTextKeys = ["not-real"]; },
    /not a declared text input/,
  );
});

test("rule: duplicate input keys fail", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.inputs.text.push({ ...doc.inputs.text[0] }); },
    /duplicate text input key/,
  );
});

test("rule: locked layer ids must exist", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.editPolicy.lockedLayerIds = ["missing-layer"]; },
    /locked layer missing-layer does not exist/,
  );
});

// ─── font resolution rules ───────────────────────────────────────────────────

test("rule: text typo must resolve to a fonts[] entry", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].typo.fontId = "not-registered"; },
    /no fonts\[\] entry/,
  );
});

test("rule: weight mismatch with fonts[] fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].typo.weight = 900; },
    /no fonts\[\] entry/,
  );
});

test("rule: family mismatch with fonts[] fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].typo.family = "Roboto"; },
    /does not match fonts\[\] family/,
  );
});

// ─── geometry rules ──────────────────────────────────────────────────────────

test("rule: colours must be lowercase #rrggbb", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].typo.color = "#FFFFFF"; },
    /#rrggbb/,
  );
});

test("rule: degenerate box fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].box = { x: 0.1, y: 0.1, width: 0, height: 0.2 }; },
    /box/i,
  );
});

test("rule: box escaping the canvas fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.formats.feed.layers[1].box = { x: 0.9, y: 0.1, width: 0.5, height: 0.2 }; },
    /box/i,
  );
});

test("rule: text boxes overlapping > 5% of the smaller fail", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => {
      // subline on top of headline: near-complete overlap
      doc.formats.feed.layers[2].box = { x: 0.05, y: 0.56, width: 0.9, height: 0.13 };
    },
    /overlap/,
  );
});

test("rule: story text inside the top safe zone fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.formats.story.layers[1].box = { x: 0.1, y: 0.05, width: 0.8, height: 0.1 }; },
    /safe zone/,
  );
});

test("rule: story text inside the bottom safe zone fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.formats.story.layers[1].box = { x: 0.1, y: 0.85, width: 0.8, height: 0.1 }; },
    /safe zone/,
  );
});

test("rule: layout height must match its format", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.formats.story.height = 1350; },
    /height must match/,
  );
});

// ─── ready implications ──────────────────────────────────────────────────────

test("rule: ready without a story layout fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { delete doc.formats.story; doc.exactness.residuals = { "feed-text-headline": 0.05 }; },
    /requires an authored story layout/,
  );
});

test("rule: ready without qaBy/qaAt fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { delete doc.exactness.qaBy; delete doc.exactness.qaAt; },
    /requires qaBy/,
  );
});

test("rule: ready with a residual over the threshold fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.exactness.residuals["feed-text-headline"] = 0.5; },
    /exceeds/,
  );
});

test("rule: ready with a missing residual fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.exactness.residuals = {}; },
    /no recorded residual/,
  );
});

test("rule: residual must reference a real layer id", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.exactness.residuals["ghost-layer"] = 0.01; },
    /not a layer id/,
  );
});

test("rule: ready with trivial restyle fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.restyle = { paletteMap: {}, replacedAssets: [] }; },
    /non-trivial restyle/,
  );
});

test("rule: sample hash equal to source hash fails", async () => {
  await expectRuleViolation(
    "meta-fixture-story",
    (doc) => { doc.provenance.sample.contentHash = doc.provenance.sourceAd.contentHash; },
    /must differ/,
  );
});

// ─── publish block rules ─────────────────────────────────────────────────────

test("rule: CTA must be in the lead subset", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.publish.cta = "CONTACT_US"; },
    /Invalid|invalid/,
  );
});

test("rule: copy arrays are capped at 5 entries", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.publish.copy.headlines = Array.from({ length: 6 }, () => "H"); },
    /5/,
  );
});

test("rule: primary text over 125 chars fails", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.publish.copy.primaryText = ["P".repeat(126)]; },
    /125/,
  );
});

test("rule: empty lead-form questions fail", async () => {
  await expectRuleViolation(
    "meta-fixture-simple",
    (doc) => { doc.publish.leadForm.questions = []; },
    /at least 1/,
  );
});

// ─── instance schema ─────────────────────────────────────────────────────────

test("instance fixture parses and is recognised by the shape guard", () => {
  const instance = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "instance-feed.json"), "utf8"));
  const result = adDocInstanceSchema.safeParse(instance);
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
  assert.equal(isAdDocInstanceShape(instance), true);
  assert.equal(isAdDocInstanceShape({ schema: "adstudio.instance.v1" }), false);
});

test("instance: zoom outside 1..3 fails", () => {
  const instance = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "instance-feed.json"), "utf8"));
  instance.values.images.photo.zoom = 5;
  assert.equal(adDocInstanceSchema.safeParse(instance).success, false);
});

test("instance: unknown override op fails", () => {
  const instance = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-story", "instance-feed.json"), "utf8"));
  instance.overrides.push({ layerId: "x", op: "rotate", angle: 5 });
  assert.equal(adDocInstanceSchema.safeParse(instance).success, false);
});

test("instance: color override must be a valid hex", () => {
  const instance = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-effects", "instance-feed.json"), "utf8"));
  instance.overrides[0].color = "red";
  assert.equal(adDocInstanceSchema.safeParse(instance).success, false);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

test("isNormalizedBox accepts valid, rejects degenerate/escaping", () => {
  assert.equal(isNormalizedBox({ x: 0, y: 0, width: 1, height: 1 }), true);
  assert.equal(isNormalizedBox({ x: 0.1, y: 0.1, width: 0, height: 0.5 }), false);
  assert.equal(isNormalizedBox({ x: 0.9, y: 0.1, width: 0.5, height: 0.2 }), false);
  assert.equal(isNormalizedBox(null), false);
});

test("boxOverlapRatio measures share of the smaller box", () => {
  const ratio = boxOverlapRatio(
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
  );
  assert.ok(Math.abs(ratio - 0.5) < 1e-9);
});

test("storySafeZoneViolation flags both bands at 1920", () => {
  assert.equal(storySafeZoneViolation({ x: 0.1, y: 0.05, width: 0.8, height: 0.1 }, 1920), "top");
  assert.equal(storySafeZoneViolation({ x: 0.1, y: 0.86, width: 0.8, height: 0.1 }, 1920), "bottom");
  assert.equal(storySafeZoneViolation({ x: 0.1, y: 0.5, width: 0.8, height: 0.1 }, 1920), null);
});

test("hasNonTrivialRestyle: palette OR full required-slot replacement", () => {
  const inputs = {
    images: [{ key: "photo", label: "p", required: true, description: "d" }],
    text: [],
  };
  assert.equal(hasNonTrivialRestyle({ restyle: { paletteMap: { "#a00000": "#0000aa" }, replacedAssets: [] }, inputs }), true);
  assert.equal(hasNonTrivialRestyle({ restyle: { paletteMap: {}, replacedAssets: ["photo"] }, inputs }), true);
  assert.equal(hasNonTrivialRestyle({ restyle: { paletteMap: {}, replacedAssets: [] }, inputs }), false);
});

test("normalizeCanonicalJson sorts keys but preserves array order", () => {
  const json = normalizeCanonicalJson({ b: 2, a: [3, { z: 1, y: 2 }] });
  assert.equal(json, JSON.stringify({ a: [3, { y: 2, z: 1 }], b: 2 }));
});
