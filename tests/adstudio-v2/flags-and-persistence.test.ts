// Flags + persistence passthrough for the v2 rebuild.

import assert from "node:assert/strict";
import test from "node:test";

import {
  adstudioTemplatesV2Enabled,
  metaAssetFeedEnabled,
} from "../../src/lib/adstudio/v2/flags.ts";
import { rowToCreative } from "../../src/lib/adstudio/persistence.ts";
import { isAdDocInstanceShape } from "../../src/lib/adstudio/v2/template-doc.ts";

test("flags default off and honour explicit values", () => {
  assert.equal(adstudioTemplatesV2Enabled({}), false);
  assert.equal(metaAssetFeedEnabled({}), false);
  assert.equal(adstudioTemplatesV2Enabled({ ADSTUDIO_TEMPLATES_V2: "true" }), true);
  assert.equal(adstudioTemplatesV2Enabled({ ADSTUDIO_TEMPLATES_V2: "1" }), true);
  assert.equal(adstudioTemplatesV2Enabled({ ADSTUDIO_TEMPLATES_V2: "false" }), false);
  assert.equal(metaAssetFeedEnabled({ META_ASSET_FEED_ENABLED: "yes-please" }), false);
});

test("rowToCreative passes v2 instance docs through untouched", () => {
  const instance = {
    schema: "adstudio.instance.v2",
    templateId: "meta-fixture-story",
    templateHash: "0".repeat(64),
    format: "4:5",
    values: { images: {}, text: {} },
    overrides: [],
  };
  assert.equal(isAdDocInstanceShape(instance), true);

  const row = {
    id: 42,
    campaign_id: 7,
    variant_id: "v1",
    format: "4:5",
    width: 1080,
    height: 1350,
    canvas_json: instance,
    preview_svg: "",
  };
  const creative = rowToCreative(row);
  // The v2 doc must arrive byte-for-byte as stored: no cloneQa key injected,
  // schema tag intact for downstream routing.
  assert.equal((creative.canvas as { schema?: string }).schema, "adstudio.instance.v2");
  assert.equal("cloneQa" in creative.canvas, false);
  assert.deepEqual(creative.canvas, instance);
});

test("rowToCreative still normalizes v1 cloneQa blobs", () => {
  const row = {
    id: 43,
    campaign_id: 7,
    variant_id: "v1",
    format: "4:5",
    width: 1080,
    height: 1350,
    canvas_json: {
      width: 1080,
      height: 1350,
      objects: [],
      cloneQa: { copyChecks: [{ key: "headline", expected: "Hello" }] },
    },
    preview_svg: "",
  };
  const creative = rowToCreative(row);
  const canvas = creative.canvas as { cloneQa?: { copyValues?: Record<string, string> } };
  assert.deepEqual(canvas.cloneQa?.copyValues, { headline: "Hello" });
});
