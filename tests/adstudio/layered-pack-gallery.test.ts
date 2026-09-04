import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplateJson, templateAssetProxyUrl, templateAssetStoragePath } from "../../src/lib/adstudio/pack-gallery.ts";
import { adTemplateSchema } from "../../packages/ad-template-contract/src/schema.ts";

const fixturePath = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "ad-template", "minimal-feed-story.json");
function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

describe("Ad Studio direct layered template gallery", () => {
  it("accepts the direct layered template contract", () => {
    const parsed = parseTemplateJson(fixture());
    assert.ok(parsed);
    assert.equal(parsed.schema, "blockwise.ad-template");
    assert.equal(parsed.templateId, "fixture-minimal");
    assert.equal(parsed.feedLayout.placement, "feed");
    assert.equal(parsed.storyLayout.placement, "story");
  });

  it("rejects a non-direct template schema", () => {
    const invalid = fixture();
    invalid.schema = "blockwise.template";
    assert.equal(parseTemplateJson(invalid), null);
  });

  it("preserves an authored text sizeRatio through shared template validation", () => {
    const candidate = fixture();
    candidate.fonts = [{ file: "arimo-600.woff2" }];
    candidate.textInputs = [{ key: "headline", label: "Headline", placeholder: "", maxLength: 80 }];
    const feedLayout = candidate.feedLayout as { layers: unknown[] };
    feedLayout.layers.push({
      type: "text",
      layerId: "feed-headline",
      inputKey: "headline",
      font: { file: "arimo-600.woff2" },
      fontSize: 96,
      sizeRatio: 0.05,
      lineHeight: 1.1,
      tracking: 0,
      alignment: "left",
      maxCharacters: 80,
      maxLines: 2,
      colourRole: "mainText",
      overflowBehaviour: "scale_down",
      geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
    });
    const parsed = adTemplateSchema.safeParse(candidate);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    const textLayer = parsed.data.feedLayout.layers.find(layer => layer.type === "text");
    assert.equal(textLayer?.type, "text");
    assert.equal(textLayer?.sizeRatio, 0.05);
    const galleryParsed = parseTemplateJson(candidate);
    const galleryTextLayer = galleryParsed?.feedLayout.layers.find(layer => layer.type === "text");
    assert.equal(galleryTextLayer?.type, "text");
    assert.equal(galleryTextLayer?.sizeRatio, 0.05);
    const invalid = structuredClone(candidate);
    const invalidTextLayer = (invalid.feedLayout as { layers: Array<Record<string, unknown>> }).layers.find(layer => layer.type === "text");
    if (invalidTextLayer) invalidTextLayer.sizeRatio = 0;
    assert.equal(adTemplateSchema.safeParse(invalid).success, false);
  });

  it("builds only canonical same-origin asset URLs", () => {
    assert.equal(templateAssetProxyUrl("layered-template-01", "feed-plate"), "/api/adstudio/templates/layered-template-01/assets/feed-plate");
    assert.equal(templateAssetProxyUrl("layered-template-01", "photo:hero"), "/api/adstudio/templates/layered-template-01/assets/photo%3Ahero");
    assert.equal(templateAssetProxyUrl("../escape", "feed-plate"), null);
    assert.equal(templateAssetProxyUrl("layered-template-01", "feed/plate"), null);
  });

  it("uses exact component encoding and real layered previews", () => {
    assert.equal(
      templateAssetStoragePath("layered-template-01", "photo:hero", "catalog/property/hero.webp"),
      "templates/layered-template-01/photo%3Ahero-catalog%2Fproperty%2Fhero.webp",
    );
    const sampleRoute = readFileSync("src/app/api/adstudio/templates/[templateId]/sample/route.ts", "utf8");
    assert.match(sampleRoute, /renderPlacement/);
    assert.match(sampleRoute, /input\.placeholder/);
    assert.match(sampleRoute, /input\.defaultAssetKey/);
  });
});
