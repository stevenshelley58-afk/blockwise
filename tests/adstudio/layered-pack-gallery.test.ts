import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplateJson, templateAssetProxyUrl } from "../../src/lib/adstudio/pack-gallery.ts";

const fixturePath = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "template-pack", "minimal-feed-story.json");
function fixture(): Record<string, unknown> { return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>; }
function asDirectTemplate(pack: Record<string, unknown>): Record<string, unknown> {
  const { schema: _schema, version: _version, packId: _packId, builderVersion: _builderVersion, rendererVersion: _rendererVersion, classification: _classification, manifestSha256: _manifestSha256, signature: _signature, safePreviews: _safePreviews, qaEvidence: _qaEvidence, ...direct } = pack; return { ...direct, schema: "blockwise.ad-template", metadata: {
    title: "Layered fixture", description: "A source-free layered fixture",
    gallerySamples: { feed: { assetKey: "feed-sample", placement: "feed", purpose: "gallery_sample" }, story: { assetKey: "story-sample", placement: "story", purpose: "gallery_sample" } },
    metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
    aiWritingGuidance: { summary: "Use verified claims only.", fields: {} },
    publishRequirements: { objective: "OUTCOME_LEADS", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null } },
    replacementAssets: [], realAssetRefs: [],
  }};
}
describe("Ad Studio direct Hermes artifact gallery", () => {
  it("keeps historical v1 packs out of the customer gallery/editor", () => assert.equal(parseTemplateJson(fixture()), null));
  it("accepts a schema-valid source-free layered template", () => {
    const parsed = parseTemplateJson(asDirectTemplate(fixture()));
    assert.ok(parsed); assert.equal((parsed as unknown as { schema: string }).schema, "blockwise.ad-template");
    assert.ok(parsed.feedLayout.layers.length > 0); assert.ok(parsed.storyLayout.layers.length > 0);
  });
  it("builds only canonical same-origin asset URLs", () => {
    assert.equal(templateAssetProxyUrl("layered-pack-01", "feed-plate"), "/api/adstudio/templates/layered-pack-01/assets/feed-plate");
    assert.equal(templateAssetProxyUrl("../escape", "feed-plate"), null);
    assert.equal(templateAssetProxyUrl("layered-pack-01", "feed/plate"), null);
  });
});
