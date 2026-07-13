import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { RAW_ADSTUDIO_GALLERY_TEMPLATES } from "../src/lib/adstudio/template-gallery/index.ts";

const templates = RAW_ADSTUDIO_GALLERY_TEMPLATES as Array<{
  id: string;
  format: string;
  sourceAd: { file?: string; creativeId?: string };
  gallery: { sampleImageSrc: string; thumbnailSrc: string };
  classification: { primary_intent: string };
}>;

test("the expanded AdStudio gallery contains 50 new source-backed templates", () => {
  assert.equal(templates.length, 51);
  assert.equal(templates.filter((template) => template.id !== "meta-feed-020").length, 50);
  assert.equal(templates.filter((template) => template.format === "4:5").length, 26);
  assert.equal(templates.filter((template) => template.format === "9:16").length, 25);

  const sourceKeys = templates.map((template) => template.sourceAd.file ?? template.sourceAd.creativeId);
  assert.equal(new Set(sourceKeys).size, sourceKeys.length);

  const newTemplates = templates.filter((template) => template.id !== "meta-feed-020");
  const intents = new Set(newTemplates.map((template) => template.classification.primary_intent));
  assert.equal(intents.size, 6);

  for (const template of newTemplates) {
    for (const samplePath of [template.gallery.sampleImageSrc, template.gallery.thumbnailSrc]) {
      assert.ok(samplePath.startsWith("/"), `${template.id} sample must be a public path`);
      assert.ok(existsSync(path.join(process.cwd(), "public", samplePath.slice(1))), `${template.id} sample missing: ${samplePath}`);
    }
  }
});
