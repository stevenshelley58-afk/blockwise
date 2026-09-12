import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { AdTemplate } from "../../packages/ad-template-contract/src/types.ts";
import { applyTextValuesToScenes, convertTemplateToFabricScenes, nativeTemplateFonts, readVueNativeEditor, textValuesFromScenes } from "../../src/components/adstudio/vue-editor/fabric-scene.ts";

function pack(): AdTemplate {
  const fixture = JSON.parse(readFileSync("tests/fixtures/ad-template/minimal-feed-story.json", "utf8")) as AdTemplate;
  fixture.fonts = [{ file: "arimo-600.woff2" }];
  fixture.assets = {
    font: { fileName: "arimo-600.woff2", mimeType: "font/woff2" },
    photo: { fileName: "photo.jpg", mimeType: "image/jpeg" },
  };
  fixture.textInputs = [{ key: "headline", label: "Headline", placeholder: "Template headline", maxLength: 80 }];
  fixture.imageInputs = [{ key: "photo", label: "Photo", acceptedTypes: ["image/jpeg"], defaultAssetKey: "photo" }];
  for (const layout of [fixture.feedLayout, fixture.storyLayout]) {
    const height = layout.placement === "feed" ? 1350 : 1920;
    layout.layers.push(
      { type: "image_slot", layerId: `${layout.placement}-photo`, inputKey: "photo", geometry: { x: 80, y: 100, width: 920, height: height * .55 }, mask: "rounded_rect", minSourceWidth: 900, minSourceHeight: 700, defaultCrop: { x: 0, y: 0, width: 1, height: 1 }, allowedPlacementOverrides: ["crop", "position"], cornerRadius: 24 },
      { type: "text", layerId: `${layout.placement}-headline`, inputKey: "headline", font: { file: "arimo-600.woff2" }, fontSize: layout.placement === "feed" ? 64 : 72, fontWeight: 600, lineHeight: 1.1, tracking: 1, alignment: "left", maxCharacters: 80, maxLines: 2, colourRole: "mainText", overflowBehaviour: "scale_down", geometry: { x: 80, y: height * .72, width: 920, height: 200 } },
      { type: "vector", layerId: `${layout.placement}-rule`, geometry: { x: 80, y: height * .9, width: 920, height: 8 }, shape: "line", colourRole: "accent", opacity: 1 },
      { type: "icon", layerId: `${layout.placement}-mail`, geometry: { x: 80, y: height * .93, width: 48, height: 48 }, icon: "mail", colourRole: "mainText" },
    );
  }
  return fixture;
}

test("template conversion creates full-size Fabric scenes with an editor workspace", () => {
  const result = convertTemplateToFabricScenes({ pack: pack(), adId: "ad-1", sourceAdId: "source-1" });
  assert.equal(result.feed.width, 1080);
  assert.equal(result.feed.height, 1350);
  assert.equal(result.story.height, 1920);
  assert.equal(result.feed.objects[0].id, "workspace");
  assert.equal(result.feed.objects[0].selectable, false);
  assert.equal(result.sourceAdId, "source-1");
  const text = result.feed.objects.find(object => object.layerId === "feed-headline");
  assert.equal(text?.type, "textbox");
  assert.equal(text?.inputKey, "headline");
  assert.equal(text?.text, "Template headline");
  assert.equal(text?.splitByGrapheme, false);
  assert.equal(text?.lineHeight, 1.1 / 1.13);
  assert.deepEqual(text?.metadata.templateTextBox, { width: 920, height: 200, maxLines: 2, overflowBehaviour: "scale_down" });
  assert.equal((text?.metadata as { inputKey?: string }).inputKey, "headline");
  const image = result.feed.objects.find(object => object.layerId === "feed-photo");
  assert.equal(image?.type, "image");
  assert.match(String(image?.src), /^\/api\/adstudio\/templates\/fixture-minimal\/assets\/photo\?adId=ad-1$/);
});

test("copy application updates bound text in both placements without erasing freeform objects", () => {
  const native = convertTemplateToFabricScenes({ pack: pack(), adId: "ad-1" });
  native.feed.objects.push({ type: "textbox", id: "freeform", text: "Keep me", left: 20, top: 20 });
  const next = applyTextValuesToScenes(native, { headline: "Customer headline" });
  assert.equal(next.feed.objects.find(object => object.layerId === "feed-headline")?.text, "Customer headline");
  assert.equal(next.story.objects.find(object => object.layerId === "story-headline")?.text, "Customer headline");
  assert.equal(next.feed.objects.find(object => object.id === "freeform")?.text, "Keep me");
  assert.deepEqual(textValuesFromScenes(next), { headline: "Customer headline" });
});

test("native documents are accepted only with exact engine and placement dimensions", () => {
  const native = convertTemplateToFabricScenes({ pack: pack(), adId: "ad-1" });
  assert.ok(readVueNativeEditor({ nativeEditor: native }));
  assert.equal(readVueNativeEditor({ nativeEditor: { ...native, engine: "other" } }), null);
  assert.equal(readVueNativeEditor({ nativeEditor: { ...native, story: { ...native.story, height: 1080 } } }), null);
});

test("conversion refuses external image sources instead of claiming editable fidelity", () => {
  const template = pack();
  assert.throws(() => convertTemplateToFabricScenes({
    pack: template,
    adId: "ad-1",
    document: {
      schema: "blockwise.ad-document", templateId: template.templateId,
      sharedImageValues: { photo: "https://example.com/photo.jpg" }, sharedTextValues: {},
      feedCropOverrides: {}, storyCropOverrides: {}, colourMode: "template", resolvedColourMap: template.semanticColours,
      metaPrimaryText: "", metaHeadline: "", metaDescription: "", metaCta: "LEARN_MORE", revision: 1,
    },
  }), /same-origin/);
});

 test("native editor resolves both declared and bundled fonts instead of silently substituting", () => {
  const template = pack();
  template.fonts.push({ file: "/fonts/adstudio/manrope-600.woff2" });
  const fonts = nativeTemplateFonts(template, "ad-1");
  assert.equal(fonts.length, 2);
  assert.match(fonts[0].url, /assets\/font\?adId=ad-1$/);
  assert.equal(fonts[1].url, "/fonts/adstudio/manrope-600.woff2");
  assert.equal(fonts[1].family, "Blockwise_fixture-minimal_%2Ffonts%2Fadstudio%2Fmanrope-600.woff2");
});
