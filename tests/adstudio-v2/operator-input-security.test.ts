import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import sharp from "sharp";

import { resolveSourceAdPath, sourceAdContentType } from "../../src/lib/adstudio/source-ad-path.ts";
import {
  isApprovedTraceSamplePath,
  validatedTraceImageDataUrl,
} from "../../src/lib/operator/template-trace-input.ts";
import {
  decodeInlineAdDocImageBytes,
  validateAdDocSlotImageDimensions,
} from "../../src/lib/adstudio/v2/media.ts";
import { templateDocV2Schema } from "../../src/lib/adstudio/v2/template-doc.ts";

test("operator trace overrides accept bounded image bytes and reject fetch instructions", async () => {
  const bytes = readFileSync("tests/fixtures/adstudio-v2/public/slots/photo-square.png");
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  assert.equal(await validatedTraceImageDataUrl(dataUrl), dataUrl);
  await assert.rejects(validatedTraceImageDataUrl("http://169.254.169.254/latest/meta-data"), /uploaded JPG/);
  await assert.rejects(validatedTraceImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), /uploaded JPG/);
});

test("source archive paths and sample fetches cannot escape their approved roots", () => {
  assert.equal(
    resolveSourceAdPath("/srv/source-archive", "batch-001/source.png"),
    "/srv/source-archive/batch-001/source.png",
  );
  assert.equal(resolveSourceAdPath("/srv/source-archive", "../package.json"), null);
  assert.equal(resolveSourceAdPath("/srv/source-archive", "batch-001/../../package.json"), null);
  assert.equal(sourceAdContentType("batch-001/source.webp"), "image/webp");
  assert.equal(isApprovedTraceSamplePath("/adstudio-samples/meta-feed-018.png"), true);
  assert.equal(isApprovedTraceSamplePath("https://169.254.169.254/source.png"), false);
  assert.equal(isApprovedTraceSamplePath("/adstudio-samples/../private.png"), false);
});

test("template contracts reject provenance traversal and decoded image bombs", async () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/adstudio-v2/meta-fixture-effects/template.json", "utf8"),
  );
  fixture.provenance.sourceAd.file = "../package.json";
  assert.equal(templateDocV2Schema.safeParse(fixture).success, false);

  const tooWide = await sharp({
    create: { width: 8_193, height: 1, channels: 3, background: "#ffffff" },
  }).png().toBuffer();
  await assert.rejects(validateAdDocSlotImageDimensions(tooWide), /no larger than/);
});

test("customer generation bounds inline image text before base64 decoding", () => {
  const oversized = `data:image/png;base64,${"A".repeat(12_000_000)}`;
  assert.throws(() => decodeInlineAdDocImageBytes(oversized), /under 8 MB/);
  const generation = readFileSync("src/lib/adstudio/v2/generate.ts", "utf8");
  assert.match(generation, /decodeInlineAdDocImageBytes\(ref\)/);
  assert.doesNotMatch(generation, /Buffer\.from\(ref\.slice/);
});
