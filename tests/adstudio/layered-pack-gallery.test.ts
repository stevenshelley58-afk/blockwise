import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTemplate,
  getTemplateForExistingCustomerAd,
  getTemplateForInternalInspection,
  gallerySampleProxyUrl,
  listTemplates,
  parseTemplateJson,
  parseTemplateJsonForSavedAdHistory,
  templateAssetProxyUrl,
  templateAssetStoragePath,
  templateLeadType,
} from "../../src/lib/adstudio/pack-gallery.ts";
import { adTemplateSchema } from "../../packages/ad-template-contract/src/schema.ts";

const fixturePath = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "ad-template", "minimal-feed-story.json");
function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

describe("Ad Studio direct layered template gallery", () => {
  it("classifies templates into customer lead types", () => {
    assert.equal(templateLeadType("Just listed property feature"), "buyer");
    assert.equal(templateLeadType("Free home appraisal"), "appraisal");
    assert.equal(templateLeadType("Open home follow-up"), "open_home");
    assert.equal(templateLeadType("Quarterly suburb market report"), "market_update");
    assert.equal(templateLeadType("Vendor listing nurture"), "seller");
    assert.equal(templateLeadType("Agency brand campaign"), "other");
  });

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
    assert.equal(
      templateAssetProxyUrl("layered-template-01", "feed-plate", "8dc1234c-88d2-4d51-aebd-2c84a36fa8cf"),
      "/api/adstudio/templates/layered-template-01/assets/feed-plate?adId=8dc1234c-88d2-4d51-aebd-2c84a36fa8cf",
    );
    assert.equal(templateAssetProxyUrl("../escape", "feed-plate"), null);
    assert.equal(templateAssetProxyUrl("layered-template-01", "feed/plate"), null);
    assert.equal(templateAssetProxyUrl("layered-template-01", "feed-plate", "../escape"), null);
    assert.equal(
      gallerySampleProxyUrl("layered-template-01", "feed", "8dc1234c-88d2-4d51-aebd-2c84a36fa8cf"),
      "/api/adstudio/templates/layered-template-01/sample?placement=feed&adId=8dc1234c-88d2-4d51-aebd-2c84a36fa8cf",
    );
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

  it("resolves a quarantined template only for an exact workspace-owned saved ad", async () => {
    const quarantinedTemplate = fixture();
    quarantinedTemplate.templateId = "quarantined-template";
    quarantinedTemplate.fonts = [{ file: "arimo-600.woff2" }];
    quarantinedTemplate.textInputs = [{ key: "headline", label: "Headline", placeholder: "Saved headline", maxLength: 80 }];
    (quarantinedTemplate.feedLayout as { layers: unknown[] }).layers.push({
      type: "text",
      layerId: "feed-legacy-headline",
      inputKey: "headline",
      font: { file: "arimo-600.woff2" },
      fontSize: 22,
      lineHeight: 1.1,
      tracking: 0,
      alignment: "left",
      maxCharacters: 80,
      maxLines: 2,
      colourRole: "mainText",
      overflowBehaviour: "scale_down",
      geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
    });
    (quarantinedTemplate.storyLayout as { layers: unknown[] }).layers.push({
      type: "text",
      layerId: "story-legacy-headline",
      inputKey: "headline",
      font: { file: "arimo-600.woff2" },
      fontSize: 18,
      lineHeight: 1.1,
      tracking: 0,
      alignment: "left",
      maxCharacters: 80,
      maxLines: 2,
      colourRole: "mainText",
      overflowBehaviour: "scale_down",
      geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
    });
    const { client: internalClient, calls: internalCalls } = templateClient([{
      template_id: "quarantined-template",
      template_json: quarantinedTemplate,
      created_at: "2026-09-03T02:00:00.000Z",
      library_status: "quarantined",
    }]);

    assert.equal(parseTemplateJson(quarantinedTemplate), null, "new-template parsing must keep the Story readability floor");
    const historyParsed = parseTemplateJsonForSavedAdHistory(quarantinedTemplate);
    const historicalFeedText = historyParsed?.feedLayout.layers.find(layer => layer.type === "text");
    const historicalText = historyParsed?.storyLayout.layers.find(layer => layer.type === "text");
    assert.equal(historicalFeedText?.type, "text");
    assert.equal(historicalFeedText?.fontSize, 22, "Feed history must preserve its exact authored size");
    assert.equal(historicalText?.type, "text");
    assert.equal(historicalText?.fontSize, 18, "saved history must preserve the exact authored font size");
    assert.equal(await getTemplateForInternalInspection(internalClient as never, "quarantined-template"), null, "internal release inspection stays strict");

    const owned = await getTemplateForExistingCustomerAd({
      customerSupabase: customerAdClient(true) as never,
      internalSupabase: internalClient as never,
      workspaceId: "workspace-01",
      adId: "ad-01",
      templateId: "quarantined-template",
    });
    assert.equal(owned?.templateId, "quarantined-template");
    assert.equal(owned?.storyLayout.layers.find(layer => layer.type === "text")?.fontSize, 18);

    const callsBeforeDenial = internalCalls.length;
    const denied = await getTemplateForExistingCustomerAd({
      customerSupabase: customerAdClient(false) as never,
      internalSupabase: internalClient as never,
      workspaceId: "workspace-02",
      adId: "ad-01",
      templateId: "quarantined-template",
    });
    assert.equal(denied, null);
    assert.equal(internalCalls.length, callsBeforeDenial, "denied ownership must not reach the internal template reader");

    const malformed = structuredClone(quarantinedTemplate);
    const legacyLayer = (malformed.storyLayout as { layers: Array<Record<string, unknown>> }).layers.find(layer => layer.layerId === "story-legacy-headline");
    if (legacyLayer) legacyLayer.tracking = 99;
    assert.equal(parseTemplateJsonForSavedAdHistory(malformed), null, "saved history cannot bypass current non-font safety constraints");
  });

  it("omits quarantined templates from discovery while preserving internal inspection", async () => {
    const activeTemplate = fixture();
    activeTemplate.templateId = "active-template";
    const quarantinedTemplate = fixture();
    quarantinedTemplate.templateId = "quarantined-template";
    const { client, calls } = templateClient([
      { template_id: "active-template", template_json: activeTemplate, created_at: "2026-09-03T01:00:00.000Z", library_status: "active" },
      { template_id: "quarantined-template", template_json: quarantinedTemplate, created_at: "2026-09-03T02:00:00.000Z", library_status: "quarantined" },
    ]);

    assert.deepEqual((await listTemplates(client as never)).map(template => template.templateId), ["active-template"]);
    assert.equal(await getTemplate(client as never, "quarantined-template"), null);
    assert.equal((await getTemplateForInternalInspection(client as never, "quarantined-template"))?.templateId, "quarantined-template");
    assert.ok(calls.some(call => call[0] === "eq" && call[1] === "library_status" && call[2] === "active"));
  });

  it("keeps saved-ad routes ownership-gated and service-backed", () => {
    const editorRoute = readFileSync("src/app/(customer)/ad-studio/ads/[id]/page.tsx", "utf8");
    const publishPage = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
    const assetRoute = readFileSync("src/app/api/adstudio/templates/[templateId]/assets/[assetKey]/route.ts", "utf8");
    const sampleRoute = readFileSync("src/app/api/adstudio/templates/[templateId]/sample/route.ts", "utf8");
    const saveRoute = readFileSync("src/app/api/adstudio/ads/[id]/save/route.ts", "utf8");
    const copyRoute = readFileSync("src/app/api/adstudio/ads/[id]/copy-proposal/route.ts", "utf8");
    const formRoute = readFileSync("src/app/api/adstudio/ads/[id]/instant-form/route.ts", "utf8");
    const publishRoute = readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8");

    assert.match(editorRoute, /getTemplateForExistingCustomerAd/);
    assert.match(publishPage, /getTemplateForExistingCustomerAd/);
    assert.match(publishPage, /templateSupabase: serviceSupabase/);
    assert.match(assetRoute, /requestedAdId[\s\S]*getTemplateForExistingCustomerAd/);
    assert.match(sampleRoute, /requestedAdId[\s\S]*getTemplateForExistingCustomerAd/);
    assert.match(saveRoute, /getTemplateForInternalInspection/);
    assert.match(saveRoute, /templateSupabase: serviceSupabase/);
    assert.match(copyRoute, /createSupabaseServiceClient/);
    assert.match(formRoute, /createSupabaseServiceClient/);
    assert.match(publishRoute, /templateSupabase: serviceSupabase/);
  });

  it("keeps template quarantine schema history in the product migration set", () => {
    const productMigrations = readFileSync("infra/product/product-migrations.txt", "utf8");
    for (const migration of [
      "20260903130000_ad_template_library_status.sql",
      "20260904010000_ad_template_review_activation_columns.sql",
      "20260904011000_quarantine_unreviewed_ad_templates.sql",
      "20260904012000_enforce_ad_template_review_activation.sql",
    ]) {
      assert.match(productMigrations, new RegExp(`^${migration}$`, "m"));
      assert.ok(readFileSync(`supabase/migrations/${migration}`, "utf8").length > 0);
    }
  });
});

type TemplateTestRow = {
  template_id: string;
  template_json: Record<string, unknown>;
  created_at: string;
  library_status: "active" | "quarantined";
};

function templateClient(rows: TemplateTestRow[]) {
  const calls: Array<[method: string, ...args: unknown[]]> = [];
  return {
    calls,
    client: {
      from(table: string) {
        assert.equal(table, "ad_templates");
        const filters: Array<[column: string, value: unknown]> = [];
        const query: any = {
          select(...args: unknown[]) { calls.push(["select", ...args]); return query; },
          eq(column: string, value: unknown) { calls.push(["eq", column, value]); filters.push([column, value]); return query; },
          order(...args: unknown[]) { calls.push(["order", ...args]); return query; },
          async maybeSingle() {
            calls.push(["maybeSingle"]);
            const data = rows.filter(row => filters.every(([column, value]) => row[column as keyof TemplateTestRow] === value));
            return { data: data[0] ?? null, error: null };
          },
          then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
            const data = rows.filter(row => filters.every(([column, value]) => row[column as keyof TemplateTestRow] === value));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    },
  };
}

function customerAdClient(owned: boolean) {
  return {
    from(table: string) {
      assert.equal(table, "ad_customer_ads");
      const query: any = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() { return { data: owned ? { id: "ad-01" } : null, error: null }; },
      };
      return query;
    },
  };
}
