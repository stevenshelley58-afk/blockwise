import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCustomerTemplate,
  getTemplateForExistingCustomerAd,
  getTemplateForInternalInspection,
  listCustomerTemplates,
  parseTemplateJson,
  templateAssetProxyUrl,
  templateAssetStoragePath,
} from "../../src/lib/adstudio/pack-gallery.ts";

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
    assert.equal(
      templateAssetProxyUrl("layered-template-01", "feed-plate", "8dc1234c-88d2-4d51-aebd-2c84a36fa8cf"),
      "/api/adstudio/templates/layered-template-01/assets/feed-plate?adId=8dc1234c-88d2-4d51-aebd-2c84a36fa8cf",
    );
    assert.equal(templateAssetProxyUrl("../escape", "feed-plate"), null);
    assert.equal(templateAssetProxyUrl("layered-template-01", "feed/plate"), null);
    assert.equal(templateAssetProxyUrl("layered-template-01", "feed-plate", "../escape"), null);
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
    const { client: internalClient, calls: internalCalls } = templateClient([{
      template_id: "quarantined-template",
      template_json: quarantinedTemplate,
      created_at: "2026-09-03T02:00:00.000Z",
      library_status: "quarantined",
    }]);

    const owned = await getTemplateForExistingCustomerAd({
      customerSupabase: customerAdClient(true) as never,
      internalSupabase: internalClient as never,
      workspaceId: "workspace-01",
      adId: "ad-01",
      templateId: "quarantined-template",
    });
    assert.equal(owned?.templateId, "quarantined-template");

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
  });

  it("omits quarantined templates from customer discovery while preserving direct internal inspection", async () => {
    const activeTemplate = fixture();
    activeTemplate.templateId = "active-template";
    const quarantinedTemplate = fixture();
    quarantinedTemplate.templateId = "quarantined-template";
    const rows: TemplateTestRow[] = [
      {
        template_id: "active-template",
        template_json: activeTemplate,
        created_at: "2026-09-03T01:00:00.000Z",
        library_status: "active",
      },
      {
        template_id: "quarantined-template",
        template_json: quarantinedTemplate,
        created_at: "2026-09-03T02:00:00.000Z",
        library_status: "quarantined",
      },
    ];
    const { client, calls } = templateClient(rows);

    const customerTemplates = await listCustomerTemplates(client as never);
    assert.deepEqual(customerTemplates.map(template => template.templateId), ["active-template"]);
    assert.equal(await getCustomerTemplate(client as never, "quarantined-template"), null);
    assert.equal(
      (await getTemplateForInternalInspection(client as never, "quarantined-template"))?.templateId,
      "quarantined-template",
    );
    assert.ok(calls.some(call => call[0] === "eq" && call[1] === "library_status" && call[2] === "active"));
  });

  it("fails closed for a new exact-id route while preserving explicit saved-ad continuity", () => {
    const editorRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/page.tsx", "utf8");
    const publishRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
    const sampleRoute = readFileSync("src/app/api/adstudio/templates/[templateId]/sample/route.ts", "utf8");
    const assetRoute = readFileSync("src/app/api/adstudio/templates/[templateId]/assets/[assetKey]/route.ts", "utf8");

    assert.match(editorRoute, /requestedAdId[\s\S]*getTemplateForExistingCustomerAd[\s\S]*getCustomerTemplate/);
    assert.match(publishRoute, /if \(!requestedAdId\) notFound\(\)/);
    assert.match(publishRoute, /getTemplateForExistingCustomerAd/);
    assert.match(sampleRoute, /getCustomerTemplate/);
    assert.match(assetRoute, /getCustomerTemplate/);
    assert.match(assetRoute, /requestedAdId[\s\S]*getTemplateForExistingCustomerAd/);
    assert.match(editorRoute, /if \(!template\) notFound\(\)/);
    assert.match(publishRoute, /if \(!pack\) notFound\(\)/);
    assert.match(sampleRoute, /if \(!template\) return notFoundResponse\(\)/);
    assert.match(assetRoute, /if \(!template \|\| !declared/);
  });

  it("keeps saved-ad support routes on workspace ownership plus an internal template reader", () => {
    const sources = [
      readFileSync("src/app/api/adstudio/ads/[id]/save/route.ts", "utf8"),
      readFileSync("src/app/api/adstudio/ads/[id]/copy-proposal/route.ts", "utf8"),
      readFileSync("src/app/api/adstudio/ads/[id]/instant-form/route.ts", "utf8"),
      readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8"),
      readFileSync("src/app/api/adstudio/library/route.ts", "utf8"),
    ];
    for (const source of sources) {
      assert.match(source, /createSupabaseServiceClient/);
    }
    assert.match(sources[0], /getTemplateForInternalInspection/);
    assert.match(sources[3], /templateSupabase: serviceSupabase/);
    assert.match(sources[4], /templateSupabase: createSupabaseServiceClient/);
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
          select(...args: unknown[]) {
            calls.push(["select", ...args]);
            return query;
          },
          eq(column: string, value: unknown) {
            calls.push(["eq", column, value]);
            filters.push([column, value]);
            return query;
          },
          order(...args: unknown[]) {
            calls.push(["order", ...args]);
            return query;
          },
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
