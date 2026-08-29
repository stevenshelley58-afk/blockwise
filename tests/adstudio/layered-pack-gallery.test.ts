import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isApprovedLayeredImportReceipt,
  parseLayeredPackJson,
  templateAssetProxyUrl,
} from "../../src/lib/adstudio/pack-gallery.ts";

const fixturePath = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

function asLayeredV2(pack: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pack,
    schema: "blockwise.template-pack/v2",
    metadata: {
      title: "Layered fixture",
      description: "A source-free layered fixture",
      gallerySamples: {
        feed: { assetKey: "feed-sample", placement: "feed", purpose: "gallery_sample" },
        story: { assetKey: "story-sample", placement: "story", purpose: "gallery_sample" },
      },
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "Use verified claims only.", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS",
        specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
      },
      replacementAssets: [],
      realAssetRefs: [],
    },
  };
}

describe("Ad Studio gallery layered release gate", () => {
  it("keeps historical v1 packs out of the customer gallery/editor", () => {
    assert.equal(parseLayeredPackJson(fixture()), null);
  });

  it("accepts a schema-valid source-free layered v2 pack", () => {
    const parsed = parseLayeredPackJson(asLayeredV2(fixture()));
    assert.ok(parsed);
    assert.equal((parsed as unknown as { schema: string }).schema, "blockwise.template-pack/v2");
    assert.ok(parsed.feedLayout.layers.length > 0);
    assert.ok(parsed.storyLayout.layers.length > 0);
  });

  it("builds only canonical same-origin asset URLs", () => {
    assert.equal(
      templateAssetProxyUrl("layered-pack-01", "feed-plate"),
      "/api/adstudio/template-packs/layered-pack-01/assets/feed-plate",
    );
    assert.equal(templateAssetProxyUrl("../escape", "feed-plate"), null);
    assert.equal(templateAssetProxyUrl("layered-pack-01", "feed/plate"), null);
  });

  it("requires the complete iterative QA lineage before a pack is customer-visible", () => {
    const complete = {
      schema: "blockwise.ad-template-import-receipt.v1",
      status: "active",
      provenance: {
        runId: "trun_123",
        releaseId: "release_123",
        traceRef: "trace:123",
        qaReceiptRef: "qa:123",
        approvalReceiptRef: "approval:123",
        sanitizationReceiptRef: "sanitization:123",
      },
    };
    assert.equal(isApprovedLayeredImportReceipt(complete), true);
    assert.equal(
      isApprovedLayeredImportReceipt({
        ...complete,
        provenance: { ...complete.provenance, approvalReceiptRef: "" },
      }),
      false,
    );
    assert.equal(isApprovedLayeredImportReceipt(null), false);
  });
});
