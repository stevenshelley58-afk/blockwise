import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplateJson, templateAssetProxyUrl, templateAssetStoragePath } from "../../src/lib/adstudio/pack-gallery.ts";

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
