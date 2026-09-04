import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adFormatLabel,
  deriveAdLibraryStatus,
  filterAndSortAssets,
  filterAndSortAds,
} from "../src/lib/adstudio/library-contract.ts";
import { loadAdStudioLibraryPage } from "../src/lib/adstudio/library-read-model.ts";

test("ad library status is conservative and never treats Meta creation as active", () => {
  assert.equal(deriveAdLibraryStatus({}), "saved");
  assert.equal(deriveAdLibraryStatus({ status: "created" }), "saved");
  assert.equal(deriveAdLibraryStatus({ publishStatus: "paused_live" }), "created_on_meta_paused");
  assert.equal(deriveAdLibraryStatus({ metaEffectiveStatus: "ACTIVE" }), "active");
  assert.equal(deriveAdLibraryStatus({ metaEffectiveStatus: "PAUSED", endedAt: "2026-09-01T00:00:00Z" }), "ended");
  assert.equal(deriveAdLibraryStatus({ status: "created_on_meta" }), "saved");
  assert.equal(deriveAdLibraryStatus({ mutationActions: [
    { action: "activate", status: "applied", updatedAt: "2026-09-03T00:00:00Z" },
    { action: "pause", status: "applied", updatedAt: "2026-09-02T00:00:00Z" },
  ] }), "active");
  assert.equal(deriveAdLibraryStatus({ mutationActions: [
    { action: "activate", status: "applied", updatedAt: "2026-09-02T00:00:00Z" },
    { action: "pause", status: "applied", updatedAt: "2026-09-03T00:00:00Z" },
  ] }), "ended");
});

test("ad format labels reflect the saved revision render outputs", () => {
  assert.equal(adFormatLabel(true, true), "Feed + Story");
  assert.equal(adFormatLabel(true, false), "Feed");
  assert.equal(adFormatLabel(false, true), "Story");
});

test("ad library filtering and sorting preserve exact ad identity", () => {
  const ads = [
    { adId: "a-2", name: "Zebra", format: "Feed", updatedAt: "2026-09-02T00:00:00Z", status: "saved" as const },
    { adId: "a-1", name: "Alpha", format: "Feed + Story", updatedAt: "2026-09-03T00:00:00Z", status: "active" as const },
    { adId: "a-3", name: "Paused", format: "Story", updatedAt: "2026-09-01T00:00:00Z", status: "created_on_meta_paused" as const },
  ];
  assert.deepEqual(filterAndSortAds(ads, { query: "a-1" }).map((ad) => ad.adId), ["a-1"]);
  assert.deepEqual(filterAndSortAds(ads, { status: "active" }).map((ad) => ad.adId), ["a-1"]);
  assert.deepEqual(filterAndSortAds(ads, { sort: "name" }).map((ad) => ad.adId), ["a-1", "a-3", "a-2"]);
  assert.deepEqual(filterAndSortAds(ads, { sort: "recent" }).map((ad) => ad.adId), ["a-1", "a-2", "a-3"]);
});

test("asset library filters every role and sorts without mutating the source", () => {
  const assets = [
    { id: "logo", label: "North logo", type: "logo", role: "logo" as const, createdAt: "2026-09-02T00:00:00Z", lastUsedAt: "2026-09-04T00:00:00Z" },
    { id: "person", label: "Mia headshot", type: "headshot", role: "person" as const, createdAt: "2026-09-03T00:00:00Z", lastUsedAt: null },
    { id: "property", label: "Front elevation", type: "listing_image", role: "property" as const, createdAt: "2026-09-01T00:00:00Z" },
  ];
  assert.deepEqual(filterAndSortAssets(assets, { role: "person" }).map((asset) => asset.id), ["person"]);
  assert.deepEqual(filterAndSortAssets(assets, { query: "logo" }).map((asset) => asset.id), ["logo"]);
  assert.deepEqual(filterAndSortAssets(assets, { sort: "recent" }).map((asset) => asset.id), ["logo", "person", "property"]);
  assert.deepEqual(assets.map((asset) => asset.id), ["logo", "person", "property"]);
});

test("library read model stays workspace-scoped and exposes asset metadata", async () => {
  const client = mockClient({
    adstudio_brand_assets: [{
      id: "asset-1",
      workspace_id: "workspace-1",
      asset_type: "listing_image",
      source_url: "https://cdn.assets.test/front.webp",
      metadata_json: { fileName: "front.webp", width: 1000, height: 750, usageCount: 2 },
      created_at: "2026-09-03T00:00:00Z",
    }],
  });
  const page = await loadAdStudioLibraryPage({ supabase: client, workspaceId: "workspace-1", kind: "assets", limit: 24 });
  assert.equal(page.items.length, 1);
  assert.partialDeepStrictEqual(page.items[0], { label: "front.webp", role: "property", dimensionsLabel: "1000 × 750", usageCount: 2 });
  assert.deepEqual(client.scopes, ["workspace-1"]);
});

test("the Library route unifies ads and assets without retiring their feature routes", () => {
  const page = readFileSync("src/app/(customer)/ad-studio/library/page.tsx", "utf8");
  const shell = readFileSync("src/components/adstudio/studio-library.tsx", "utf8");
  const ads = readFileSync("src/components/adstudio/ads-library.tsx", "utf8");
  const assets = readFileSync("src/components/adstudio/media-library.tsx", "utf8");

  assert.doesNotMatch(page, /redirect\(/);
  assert.match(page, /kind: "ads"/);
  assert.match(page, /kind: "assets"/);
  assert.match(shell, /TabsList/);
  assert.match(shell, /value="ads"/);
  assert.match(shell, /value="assets"/);
  assert.match(ads, /embedded\?: boolean/);
  assert.match(assets, /embedded\?: boolean/);
});

function mockClient(rows: Record<string, unknown[]>) {
  const scopes: string[] = [];
  return {
    scopes,
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    from(table: string) {
      return new MockQuery(rows[table] ?? [], scopes);
    },
  };
}

class MockQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  private readonly rows: unknown[];
  private readonly scopes: string[];
  constructor(rows: unknown[], scopes: string[]) { this.rows = rows; this.scopes = scopes; }
  select() { return this; }
  eq(column: string, value: unknown) { if (column === "workspace_id" && typeof value === "string") this.scopes.push(value); return this; }
  order() { return this; }
  limit() { return this; }
  or() { return this; }
  gt() { return this; }
  in() { return this; }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}
