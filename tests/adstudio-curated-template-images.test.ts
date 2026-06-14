import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  AD_STUDIO_TEMPLATES,
  builtInAdStudioTemplates,
  curatedTemplateImages,
  defaultCuratedTemplateImage,
} from "../src/lib/adstudio/index.ts";

test("every built-in template ships curated, on-brand images under /ads/", () => {
  for (const template of AD_STUDIO_TEMPLATES) {
    const images = template.images ?? [];
    assert.ok(images.length >= 1, `${template.id} should have at least one curated image`);
    for (const image of images) {
      // Curated srcs must sit under /ads/ so they pass the server image guard
      // (isAdStudioImageSrc in the campaigns route) without an upload.
      assert.ok(image.src.startsWith("/ads/"), `${template.id} image ${image.src} must live under /ads/`);
      assert.ok(image.label.trim().length > 0, `${template.id} image needs a label`);
    }
  }
});

test("curated image files exist on disk in public/", () => {
  const srcs = new Set<string>();
  for (const template of AD_STUDIO_TEMPLATES) {
    for (const image of template.images ?? []) srcs.add(image.src);
  }
  for (const src of srcs) {
    assert.ok(existsSync(`public${src}`), `missing curated asset public${src}`);
  }
});

test("defaultCuratedTemplateImage returns the first image and is null for unknown templates", () => {
  for (const template of AD_STUDIO_TEMPLATES) {
    const expected = (template.images ?? [])[0] ?? null;
    assert.deepEqual(defaultCuratedTemplateImage(template.id), expected);
  }
  assert.equal(defaultCuratedTemplateImage(""), null);
  assert.equal(defaultCuratedTemplateImage(undefined), null);
  assert.equal(defaultCuratedTemplateImage("not_a_real_template"), null);
  assert.deepEqual(curatedTemplateImages("not_a_real_template"), []);
});

test("built-in templates carry curated images through builtInAdStudioTemplates()", () => {
  for (const template of builtInAdStudioTemplates()) {
    assert.ok((template.images ?? []).length >= 1, `${template.id} lost curated images when mapped`);
  }
});

test("New Ad dialog default-fills the curated image on template select", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  assert.match(dialog, /defaultCuratedTemplateImage/);
  // Both entry points (gallery select and pre-selected template) must pre-fill the image.
  assert.match(dialog, /const curated = defaultCuratedTemplateImage\(id\)/);
  assert.match(dialog, /setImageDataUrl\(curated\?\.src \?\? ""\)/);
});

test("Template cards render the curated image as the thumbnail", () => {
  const panel = readFileSync("src/components/adstudio/panels/templates-panel.tsx", "utf8");
  assert.match(panel, /defaultCuratedTemplateImage/);
  assert.match(panel, /const image = template\.images\?\.\[0\] \?\? defaultCuratedTemplateImage\(template\.id\)/);
  assert.match(panel, /backgroundImage: `url\("\$\{image\.src\}"\)`/);
});

test("Media tab exposes the template's curated images as swap options", () => {
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  assert.match(workbench, /curatedTemplateImages/);
  assert.match(workbench, /setTemplateMediaAssets\(curatedTemplateImages\(input\.templateId \?\? input\.templateKey\)\)/);
  assert.match(workbench, /\.\.\.templateMediaAssets/);
  assert.match(workbench, /dedupeAssetsBySrc/);
});
