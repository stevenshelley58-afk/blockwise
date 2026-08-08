// Flags + persistence passthrough for the v2 rebuild.

import assert from "node:assert/strict";
import test from "node:test";

import {
  adstudioTemplatesV2Enabled,
  metaAssetFeedEnabled,
} from "../../src/lib/adstudio/v2/flags.ts";
import {
  compactAdStudioCampaignPackForTransport,
  persistAdStudioCampaignPack,
  rowToCreative,
} from "../../src/lib/adstudio/persistence.ts";
import type { AdStudioCampaignPack } from "../../src/lib/adstudio/types.ts";
import { isAdDocInstanceShape, type AdDocInstance } from "../../src/lib/adstudio/v2/template-doc.ts";
import { buildCloneTestPack } from "../adstudio-clone-fixture.ts";

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

test("v2 generated creatives compact and persist as docs with canonical dimensions", async () => {
  const legacyPack = buildCloneTestPack("workspace_v2_persistence");
  const v2Pack: AdStudioCampaignPack = {
    ...legacyPack,
    brandKit: {
      ...legacyPack.brandKit,
      source: { ...legacyPack.brandKit.source, url: "https://northstar.test" },
    },
    creatives: legacyPack.creatives.map((creative): typeof creative => {
      const format = creative.format === "9:16" ? "9:16" : "4:5";
      const canvas: AdDocInstance = {
        schema: "adstudio.instance.v2",
        templateId: "meta-generated-v2",
        templateHash: "a".repeat(64),
        format,
        values: { images: {}, text: {} },
        overrides: [],
        renders: format === "9:16" ? { story: "workspace_v2_persistence/story.png" } : { feed: "workspace_v2_persistence/feed.png" },
      };
      return { ...creative, format, canvas };
    }),
  };

  const transported = compactAdStudioCampaignPackForTransport(v2Pack);
  for (let index = 0; index < v2Pack.creatives.length; index += 1) {
    assert.equal(transported.creatives[index]?.canvas, v2Pack.creatives[index]?.canvas);
    assert.equal("objects" in transported.creatives[index]!.canvas, false);
  }

  let rpcArgs: Record<string, unknown> | undefined;
  const revisionQuery = {
    eq: () => revisionQuery,
    in: async () => ({ data: [], error: null }),
  };
  const supabase = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcArgs = args;
      return { data: null, error: null };
    },
    from: () => ({ select: () => revisionQuery }),
  };

  await persistAdStudioCampaignPack(supabase as never, v2Pack, "user_v2");
  const persistedCreatives = (rpcArgs?.creatives ?? []) as Array<{
    format: string;
    width: number;
    height: number;
    canvas_json: Record<string, unknown>;
  }>;
  assert.deepEqual(
    persistedCreatives.map(({ format, width, height }) => ({ format, width, height })).sort((a, b) => a.format.localeCompare(b.format)),
    [
      { format: "4:5", width: 1080, height: 1350 },
      { format: "9:16", width: 1080, height: 1920 },
    ],
  );
  assert.equal(persistedCreatives.every((creative) => creative.canvas_json.schema === "adstudio.instance.v2" && !("objects" in creative.canvas_json)), true);
});
