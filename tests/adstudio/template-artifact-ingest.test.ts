import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { ingestTemplateArtifact } from "../../src/lib/adstudio/ingest-artifact.ts";

const bytes = (value: string) => Buffer.from(value).toString("base64");

function artifact(assetValues: Array<[string, string, string]> = [["hero", "hero.webp", "hero-one"]]) {
  const assets = Object.fromEntries(
    assetValues.map(([assetKey, fileName]) => [assetKey, { fileName, mimeType: "image/webp" }]),
  );
  return {
    template: {
      schema: "blockwise.ad-template",
      templateId: "direct-template",
      createdAt: "2026-08-30T00:00:00.000Z",
      feedLayout: {
        placement: "feed",
        layers: [{
          type: "plate",
          layerId: "feed-plate",
          colourRole: "background",
          assetKey: assetValues[0]?.[0],
          geometry: { x: 0, y: 0, width: 1080, height: 1350 },
          protected: true,
        }],
        safeZones: [],
      },
      storyLayout: {
        placement: "story",
        layers: [{
          type: "plate",
          layerId: "story-plate",
          colourRole: "background",
          assetKey: assetValues[0]?.[0],
          geometry: { x: 0, y: 0, width: 1080, height: 1920 },
          protected: true,
        }],
        safeZones: [],
      },
      imageInputs: [],
      textInputs: [],
      semanticColours: {
        background: "#ffffff",
        primary: "#17202a",
        secondary: "#8c9aa6",
        accent: "#376f86",
        mainText: "#17202a",
        inverseText: "#ffffff",
      },
      assets,
      fonts: [],
      metadata: {
        title: "Direct template",
        description: "Exact direct artifact",
        gallerySamples: {},
        metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
        aiWritingGuidance: { summary: "Use the authored copy.", fields: {} },
        publishRequirements: { objective: "OUTCOME_LEADS", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] },
        replacementAssets: [],
        realAssetRefs: [],
      },
    },
    assets: assetValues.map(([assetKey, fileName, value]) => ({
      assetKey,
      fileName,
      mimeType: "image/webp",
      bytesBase64: bytes(value),
    })),
  };
}

type StoredAsset = {
  asset_key: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
};

class FakeSupabase {
  templateJson: unknown = null;
  assetRows: StoredAsset[] = [];
  objects = new Map<string, Buffer>();
  uploadOptions: Array<{ contentType?: string; upsert?: boolean }> = [];
  removed: string[][] = [];
  rpcCalls = 0;
  uploadFailureAt: number | null = null;
  rpcError: { message: string; code?: string } | null = null;
  private uploads = 0;

  from(table: string) {
    const self = this;
    return {
      select() {
        const query = {
          eq() { return query; },
          async maybeSingle() {
            return {
              data: table === "ad_templates" && self.templateJson
                ? { template_json: self.templateJson }
                : null,
              error: null,
            };
          },
          then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
            return Promise.resolve({
              data: table === "ad_template_assets_direct" ? self.assetRows : [],
              error: null,
            }).then(resolve, reject);
          },
        };
        return query;
      },
    };
  }

  storage = {
    from: (_bucket: string) => ({
      upload: async (path: string, value: Buffer, options: { contentType?: string; upsert?: boolean }) => {
        this.uploads += 1;
        this.uploadOptions.push(options);
        if (this.uploadFailureAt === this.uploads) {
          return { error: { message: "storage unavailable" } };
        }
        if (this.objects.has(path)) return { error: { message: "The resource already exists" } };
        this.objects.set(path, Buffer.from(value));
        return { error: null };
      },
      download: async (path: string) => {
        const value = this.objects.get(path);
        return value
          ? { data: new Blob([value as unknown as BlobPart]), error: null }
          : { data: null, error: { message: "not found" } };
      },
      remove: async (paths: string[]) => {
        this.removed.push([...paths]);
        for (const path of paths) this.objects.delete(path);
        return { error: null };
      },
    }),
  };

  async rpc(_name: string, params: Record<string, unknown>) {
    this.rpcCalls += 1;
    if (this.rpcError) return { data: null, error: this.rpcError };
    const replayed = this.templateJson !== null;
    if (replayed && !isDeepStrictEqual(this.templateJson, params.p_template_json)) {
      return { data: null, error: { message: "template_artifact_conflict", code: "P0001" } };
    }
    if (!replayed) {
      this.templateJson = params.p_template_json;
      this.assetRows = params.p_assets as StoredAsset[];
    }
    return {
      data: [{ replayed, asset_count: (params.p_assets as StoredAsset[]).length }],
      error: null,
    };
  }
}

describe("direct template artifact ingest", () => {
  it("creates through the RPC with create-only uploads, then replays only exact bytes", async () => {
    const db = new FakeSupabase();
    const input = artifact();

    assert.deepEqual(await ingestTemplateArtifact(db as never, input), {
      templateId: "direct-template",
      assetCount: 1,
      replayed: false,
    });
    assert.deepEqual(db.uploadOptions, [{ contentType: "image/webp", upsert: false }]);
    assert.equal(db.rpcCalls, 1);

    assert.deepEqual(await ingestTemplateArtifact(db as never, structuredClone(input)), {
      templateId: "direct-template",
      assetCount: 1,
      replayed: true,
    });
    assert.equal(db.uploadOptions.length, 1, "an exact replay must not upload again");
    assert.equal(db.rpcCalls, 2, "metadata replay is serialized by the finalizer RPC");
  });

  it("rejects changed template JSON, declaration metadata, and stored bytes", async () => {
    const db = new FakeSupabase();
    const input = artifact();
    await ingestTemplateArtifact(db as never, input);

    const changedTemplate = structuredClone(input);
    changedTemplate.template.metadata.title = "Changed";
    await assert.rejects(
      ingestTemplateArtifact(db as never, changedTemplate),
      /template_artifact_conflict/,
    );

    const changedDeclaration = structuredClone(input);
    changedDeclaration.template.assets.hero.fileName = "changed.webp";
    changedDeclaration.assets[0]!.fileName = "changed.webp";
    await assert.rejects(
      ingestTemplateArtifact(db as never, changedDeclaration),
      /template_artifact_conflict/,
    );

    const storedPath = db.assetRows[0]!.storage_path;
    db.objects.set(storedPath, Buffer.from("tampered"));
    await assert.rejects(
      ingestTemplateArtifact(db as never, input),
      /template_artifact_conflict/,
    );
  });

  it("reuses a byte-identical orphan object but conflicts without deleting a different object", async () => {
    const input = artifact();
    const path = "templates/direct-template/hero-hero.webp";
    const exact = new FakeSupabase();
    exact.objects.set(path, Buffer.from("hero-one"));
    const result = await ingestTemplateArtifact(exact as never, input);
    assert.equal(result.replayed, false);
    assert.equal(exact.removed.length, 0);
    assert.deepEqual(exact.objects.get(path), Buffer.from("hero-one"));

    const mismatch = new FakeSupabase();
    mismatch.objects.set(path, Buffer.from("someone-elses-object"));
    await assert.rejects(
      ingestTemplateArtifact(mismatch as never, input),
      /template_artifact_conflict/,
    );
    assert.equal(mismatch.removed.length, 0);
    assert.deepEqual(mismatch.objects.get(path), Buffer.from("someone-elses-object"));
  });

  it("on partial upload or RPC failure removes only objects created by that call", async () => {
    const input = artifact([
      ["hero", "hero.webp", "hero-one"],
      ["detail", "detail.webp", "detail-two"],
    ]);

    const partial = new FakeSupabase();
    partial.uploadFailureAt = 2;
    partial.objects.set("unrelated/existing.webp", Buffer.from("keep"));
    await assert.rejects(ingestTemplateArtifact(partial as never, input), /storage unavailable/);
    assert.deepEqual(partial.removed, [["templates/direct-template/hero-hero.webp"]]);
    assert.deepEqual(partial.objects.get("unrelated/existing.webp"), Buffer.from("keep"));

    const rpcFailure = new FakeSupabase();
    rpcFailure.objects.set("templates/direct-template/hero-hero.webp", Buffer.from("hero-one"));
    rpcFailure.rpcError = { message: "database unavailable" };
    await assert.rejects(ingestTemplateArtifact(rpcFailure as never, input), /database unavailable/);
    assert.deepEqual(rpcFailure.removed, [["templates/direct-template/detail-detail.webp"]]);
    assert.deepEqual(
      rpcFailure.objects.get("templates/direct-template/hero-hero.webp"),
      Buffer.from("hero-one"),
    );
  });

  it("accepts normalized catalog subpaths and rejects traversal or platform paths", async () => {
    const nested = artifact([["hero", "home/open-home-living.webp", "hero-one"]]);
    const db = new FakeSupabase();
    await ingestTemplateArtifact(db as never, nested);
    assert.ok(db.objects.has("templates/direct-template/hero-home%2Fopen-home-living.webp"));

    for (const fileName of ["../secret.webp", "/absolute.webp", "home\\windows.webp", "home//empty.webp", "home/./dot.webp"]) {
      const invalid = artifact([["hero", fileName, "hero-one"]]);
      await assert.rejects(
        ingestTemplateArtifact(new FakeSupabase() as never, invalid),
        /invalid_template_artifact/,
      );
    }
  });
});

describe("direct template route and migration contract", () => {
  it("uses the sole shared schema and maps conflicts to HTTP 409", () => {
    const ingest = readFileSync("src/lib/adstudio/ingest-artifact.ts", "utf8");
    const route = readFileSync("src/app/api/internal/adstudio/template-artifacts/route.ts", "utf8");
    assert.match(ingest, /packages\/ad-template-contract\/src\/schema\.ts/);
    assert.doesNotMatch(ingest, /const rectSchema|\.passthrough\(\)/);
    assert.match(route, /template_artifact_conflict" \? 409/);
  });

  it("verifies internal HMAC requests and rejects unauthenticated calls", () => {
    const route = readFileSync("src/app/api/internal/adstudio/template-artifacts/route.ts", "utf8");
    assert.match(route, /verifyInternalRequest\(request, "adstudio\.templates"/);
    assert.match(route, /if \(!auth\.ok\)[\s\S]*status: auth\.status/);
    assert.doesNotMatch(route, /authorization\?\.match\(\/\^Bearer/);
  });

  it("keeps legacy customer data while allowing direct-template customer inserts", () => {
    const migration = readFileSync(
      "supabase/migrations/20260830020000_direct_template_artifact.sql",
      "utf8",
    );
    const createCustomerAd = readFileSync("src/lib/adstudio/create-customer-ad.ts", "utf8");
    assert.match(migration, /alter column template_pack_id drop not null/i);
    assert.match(migration, /alter column template_version drop not null/i);
    assert.match(migration, /ad_customer_ads_template_id_direct_fkey/);
    assert.match(migration, /references public\.ad_templates\(template_id\)[\s\S]*on delete restrict[\s\S]*not valid/i);
    assert.doesNotMatch(migration, /drop column[^;]*(?:template_pack_id|template_version)/i);
    assert.doesNotMatch(migration, /drop table[^;]*cascade/i);
    assert.match(createCustomerAd, /template_id: pack\.templateId/);
    assert.doesNotMatch(createCustomerAd, /template_pack_id:|template_version:/);
  });
});
