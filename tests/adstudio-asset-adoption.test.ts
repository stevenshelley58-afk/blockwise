import assert from "node:assert/strict";
import test from "node:test";

import { adoptWorkspaceAsset, AdoptAssetError } from "../src/lib/adstudio/adopt-workspace-asset.ts";

function accessClient(row: unknown, error: unknown = null) {
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row, error }; } };
  return { from() { return query; } } as any;
}

test("asset adoption denies cross-workspace sources", async () => {
  await assert.rejects(
    () => adoptWorkspaceAsset({ accessSupabase: accessClient(null), serviceSupabase: {} as any, workspaceId: "workspace-a", adId: "ad-a", sourceAssetId: "asset-b" }),
    (error: unknown) => error instanceof AdoptAssetError && error.code === "source_not_found",
  );
});

test("asset adoption distinguishes source lookup failures", async () => {
  await assert.rejects(
    () => adoptWorkspaceAsset({ accessSupabase: accessClient(null, { message: "db unavailable" }), serviceSupabase: {} as any, workspaceId: "workspace-a", adId: "ad-a", sourceAssetId: "asset-a" }),
    (error: unknown) => error instanceof AdoptAssetError && error.code === "database",
  );
});

test("asset adoption rejects invalid source bytes before ledger calls", async () => {
  const calls: string[] = [];
  const service = { storage: { from() { return { async download() { calls.push("download"); return { data: new Blob(["not an image"]), error: null }; } }; } }, rpc() { calls.push("rpc"); } };
  await assert.rejects(
    () => adoptWorkspaceAsset({ accessSupabase: accessClient({ id: "asset-a", workspace_id: "workspace-a", storage_path: "workspace-a/kit/a.png" }), serviceSupabase: service as any, workspaceId: "workspace-a", adId: "ad-a", sourceAssetId: "asset-a" }),
    (error: unknown) => error instanceof AdoptAssetError && error.code === "source_invalid",
  );
  assert.deepEqual(calls, ["download"]);
});
