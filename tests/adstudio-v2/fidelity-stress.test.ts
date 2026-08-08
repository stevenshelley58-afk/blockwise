import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  NativeFidelityError,
  StressMatrixError,
  nativeSurfaceFor,
  runNativeSurfaceFidelity,
  runStressMatrix,
} from "../../src/lib/adstudio/v2/fidelity-stress.ts";
import { renderAdDocToPng } from "../../src/lib/adstudio/v2/render/server.ts";

const repoRoot = process.cwd();
const fixtureRoot = join(repoRoot, "tests", "fixtures", "adstudio-v2");
const fontsDir = join(repoRoot, "public", "fonts", "adstudio");
const photoBytes = readFileSync(join(fixtureRoot, "public", "slots", "photo-landscape.png"));
const renderOptions = { repoRoot: fixtureRoot, fontsDir, resolveSlotSrc: async () => photoBytes };

function fixture(id: string): any {
  return JSON.parse(readFileSync(join(fixtureRoot, id, "template.json"), "utf8"));
}

test("native fidelity selects feed unless story is explicitly native", () => {
  const doc = fixture("meta-fixture-story");
  assert.equal(nativeSurfaceFor(doc), "feed");
  doc.formats.story.native = true;
  assert.equal(nativeSurfaceFor(doc), "story");
});

test("native fidelity records every editable native text residual and exact outside pixels", async () => {
  const doc = fixture("meta-fixture-effects");
  const sourceValues = { headline: "HOME FINDER", ctaLine: "Free appraisal" };
  const rendered = await renderAdDocToPng(doc, {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash: "0".repeat(64),
    format: "4:5",
    values: { images: {}, text: sourceValues },
    overrides: [],
  }, "4:5", renderOptions);
  doc.provenance.sourceAd.contentHash = createHash("sha256").update(rendered).digest("hex");
  const result = await runNativeSurfaceFidelity(doc, {
    sourceBytes: rendered,
    sourceValues,
    renderOptions,
    checkedAt: "2026-08-08T00:00:00.000Z",
  });
  assert.equal(result.nativeSurface, "feed");
  assert.deepEqual(Object.keys(result.residuals).sort(), ["text-cta", "text-headline"]);
  assert.equal(result.outside.differingPixels, 0);
  assert.equal(result.checkedAt, "2026-08-08T00:00:00.000Z");
});

test("native fidelity rejects even one changed pixel outside padded editable text", async () => {
  const doc = fixture("meta-fixture-effects");
  const sourceValues = { headline: "HOME FINDER", ctaLine: "Free appraisal" };
  const rendered = await renderAdDocToPng(doc, {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash: "0".repeat(64),
    format: "4:5",
    values: { images: {}, text: sourceValues },
    overrides: [],
  }, "4:5", renderOptions);
  const raw = await sharp(rendered).ensureAlpha().raw().toBuffer();
  // Top-left is outside this fixture's text regions.
  raw[0] = raw[0] === 0 ? 1 : raw[0]! - 1;
  const changedSource = await sharp(raw, { raw: { width: 1080, height: 1350, channels: 4 } }).png().toBuffer();
  doc.provenance.sourceAd.contentHash = createHash("sha256").update(changedSource).digest("hex");
  await assert.rejects(
    () => runNativeSurfaceFidelity(doc, { sourceBytes: changedSource, sourceValues, renderOptions }),
    (error: Error) => error instanceof NativeFidelityError && error.result.outside.differingPixels === 1,
  );
});

test("stress matrix renders both formats and hashes its complete deterministic result", async () => {
  const doc = fixture("meta-fixture-story");
  // Make the fixture's declared legal maximum genuinely fit its measured box.
  doc.inputs.text[0].maxLength = 5;
  const first = await runStressMatrix(doc, { renderOptions });
  const second = await runStressMatrix(doc, { renderOptions });
  assert.equal(first.entries.length, 10);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(new Set(first.entries.map((entry) => entry.scenario)), new Set([
    "longest-copy", "one-character-copy", "minimum-resolution", "all-portrait", "all-landscape",
  ]));
  assert.deepEqual(new Set(first.entries.map((entry) => entry.format)), new Set(["4:5", "9:16"]));
});

test("stress matrix treats RenderFitError as a hard failure", async () => {
  const doc = fixture("meta-fixture-story");
  const headline = doc.formats.feed.layers.find((layer: any) => layer.type === "text");
  headline.constraints.maxLength = 400;
  headline.constraints.maxLines = 1;
  await assert.rejects(
    () => runStressMatrix(doc, { renderOptions }),
    (error: Error) => error instanceof StressMatrixError && /RenderFitError/.test(error.message),
  );
});
