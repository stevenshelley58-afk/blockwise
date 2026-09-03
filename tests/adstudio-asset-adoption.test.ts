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

test("valid adoption follows prepare, upload, verify, claim, finalize", async () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const calls: string[] = [];
  const object = { bytes, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  const bucket = (name: string) => ({ async download() { calls.push(`${name}:download`); return { data: object, error: null }; }, async upload() { calls.push(`${name}:upload`); return { error: null }; }, async info() { calls.push(`${name}:info`); return { data: { size: bytes.length }, error: null }; }, async remove() { calls.push(`${name}:remove`); return { error: null }; } });
  const service = { storage: { from: bucket }, async rpc(name: string) { calls.push(`rpc:${name}`); return { data: name.includes("prepare") ? { ok: true, status: "pending", reservation_id: "reservation-1" } : { ok: true }, error: null }; } };
  const result = await adoptWorkspaceAsset({ accessSupabase: accessClient({ id: "asset-a", workspace_id: "workspace-a", storage_path: "workspace-a/kit/a.png" }), serviceSupabase: service as any, workspaceId: "workspace-a", adId: "ad-a", sourceAssetId: "asset-a" });
  assert.match(result.ref, /^\/api\/adstudio\/customer-media\?/);
  assert.deepEqual(calls, ["workspace-artifacts:download", "rpc:adstudio_prepare_customer_image_upload", "adstudio-customer-images:upload", "adstudio-customer-images:info", "adstudio-customer-images:download", "rpc:adstudio_claim_customer_image_finalize", "rpc:adstudio_finalize_customer_image_upload"]);
});

test("failed discard claim never removes the customer object", async () => {
  const calls: string[] = [];
  const service = { storage: { from: () => ({ async remove() { calls.push("remove"); return { error: null }; } }) }, async rpc(name: string) { calls.push(name); return { data: false, error: null }; } };
  const module = await import("../src/lib/adstudio/adopt-workspace-asset.ts");
  const discard = (module as any).__testDiscard;
  assert.equal(typeof discard, "function");
  await discard({ serviceSupabase: service }, "reservation-1", "workspace-a", "ad-a", "workspace-a/adstudio/ads/ad-a/images/hash.png");
  assert.deepEqual(calls, ["adstudio_discard_customer_image_upload"]);
});
