import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adapter = readFileSync("src/lib/adstudio/publish-adapter.ts", "utf8");
const execution = readFileSync("src/lib/providers/meta-execution.ts", "utf8");
const route = readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8");

test("publication matrix accepts saved Feed/Story variant selection", () => {
  assert.match(execution, /variantIds\?: Array<"feed" \| "story">/);
  assert.match(adapter, /selectedVariants = \[\.\.\.new Set\(input\.controls!\.variantIds!\)\]/);
  assert.match(adapter, /selectedVariants\.map\(\(variant\)/);
  assert.match(adapter, /adSets\.flatMap\(\(adSet, adSetIndex\) => selectedVariants\.map/);
  assert.match(adapter, /status: "PAUSED"/);
  assert.match(adapter, /variantTag: \{ variantId: variant/);
  assert.match(route, /isMetaPublishControls/);
});

test("existing parent targets remain referenced rather than mutated by the matrix", () => {
  assert.match(adapter, /existingId,/);
  assert.match(adapter, /reconciledObjects: \{/);
  assert.match(execution, /if \(reconciledObjects\.adSetIds\[adSet\.localId\]\)/);
});

test("direct publish persistence and activation use the customer-ad lineage", () => {
  const activation = readFileSync("src/app/api/adstudio/ads/[id]/activate/route.ts", "utf8");
  assert.match(adapter, /adStudioCampaignId: null/);
  assert.match(adapter, /customerAdId: input\.adId/);
  assert.match(adapter, /\.eq\("customer_ad_id", adId\)/);
  assert.match(execution, /customer_ad_id: plan\.customerAdId/);
  assert.match(activation, /plan\.customerAdId !== id/);
});

test("dry-run planning stops before provider token or network access", () => {
  assert.match(route, /if \(!writesEnabled\)[\s\S]*persistMetaPublishPlan/);
  assert.ok(route.indexOf("if (!writesEnabled)") < route.indexOf("const tokens = await loadStoredProviderTokens"));
  assert.match(route, /e2eDryRunOnly/);
});
