import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  loadAdStudioWorkspaceAssetRows,
  mediaLibraryAssetForRow,
} from "../src/lib/adstudio/assets.ts";

test("workspace media rows become renderable library assets", () => {
  const asset = mediaLibraryAssetForRow("workspace-1", {
    id: "asset-1",
    asset_type: "listing_image",
    storage_path: "workspace-1/adstudio/kit-1/uuid-front-of-house.jpg",
    metadata_json: { fileName: "Front of house.jpg" },
  });

  assert.deepEqual(asset, {
    id: "asset-1",
    src: "/api/adstudio/media?path=workspace-1%2Fadstudio%2Fkit-1%2Fuuid-front-of-house.jpg",
    label: "Front of house.jpg",
    type: "listing_image",
    role: "property",
    ratio: "Image",
  });
});

test("workspace library queries stay workspace-scoped", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const rows = [{ id: "asset-1" }];
  const query = {
    select(value: string) {
      calls.push(["select", value]);
      return this;
    },
    eq(column: string, value: string) {
      calls.push(["eq", column, value]);
      return this;
    },
    async order(column: string, options: unknown) {
      calls.push(["order", column, options]);
      return { data: rows, error: null };
    },
  };
  const supabase = {
    from(table: string) {
      calls.push(["from", table]);
      return query;
    },
  };

  assert.equal(await loadAdStudioWorkspaceAssetRows(supabase, "workspace-1"), rows);
  assert.deepEqual(calls, [
    ["from", "adstudio_brand_assets"],
    ["select", "*"],
    ["eq", "workspace_id", "workspace-1"],
    ["order", "created_at", { ascending: false }],
  ]);
});

test("Create receives the persisted workspace library in addition to current-session uploads", () => {
  const page = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");

  assert.match(page, /loadAdStudioWorkspaceAssetRows\(supabase, access\.workspaceId\)/);
  assert.match(page, /initialMediaAssets=\{initialMediaAssets\}/);
  assert.match(workbench, /\.\.\.uploadedAssets,\s*\.\.\.initialMediaAssets,/);
});
