#!/usr/bin/env node
import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import { assertHermesOwnedStorageUrl, hermesSupabaseHeaders, resolveHermesResearchStorageCredential, resolveHermesSupabaseCredential } from "./supabase-credentials.mjs";

const MAX_BYTES = Math.max(1_024, Number(process.env.HERMES_MEDIA_ARCHIVE_MAX_BYTES || 52_428_800));
const MIN_FREE_BYTES = Math.max(0, Number(process.env.HERMES_MEDIA_ARCHIVE_MIN_FREE_BYTES || 2_147_483_648));
const bucket = process.env.HERMES_RESEARCH_AD_CREATIVES_BUCKET || "research-ad-creatives";
const researchUrl = String(process.env.HERMES_SUPABASE_URL || "").replace(/\/+$/u, "");
const storageUrl = assertHermesOwnedStorageUrl(process.env.HERMES_RESEARCH_STORAGE_URL || "");
const researchCredential = resolveHermesSupabaseCredential();
const storageCredential = resolveHermesResearchStorageCredential();
const assetId = process.argv[process.argv.indexOf("--asset-id") + 1];

if (!assetId || !researchUrl || !researchCredential || !storageCredential) {
  throw new Error("usage: media-archive.mjs --asset-id <uuid>; Hermes DB and Storage credentials are required");
}
await assertDiskHeadroom();
const [asset] = await researchRest(`media_assets?select=id,source_url,capture_status,kind& id=eq.${encodeURIComponent(assetId)}`.replace("& id", "&id"));
if (!asset?.source_url) throw new Error("media asset has no provenance source URL");
const captured = await downloadAndVerify(asset.source_url, MAX_BYTES);
const objectKey = `sha256/${captured.sha256}`;
await uploadOrVerify(objectKey, captured);
await researchRest("rpc/link_verified_media_archive", {
  method: "POST",
  body: JSON.stringify({ p_media_asset_id: asset.id, p_content_hash: captured.sha256, p_storage_bucket: bucket, p_object_key: objectKey, p_byte_size: captured.bytes.length, p_mime_type: captured.mimeType }),
});
console.log(JSON.stringify({ assetId: asset.id, status: "captured", objectKey, sha256: captured.sha256, byteSize: captured.bytes.length, mimeType: captured.mimeType }));

async function assertDiskHeadroom() {
  const stats = await statfs("/opt").catch(() => null);
  if (stats && Number(stats.bavail) * Number(stats.bsize) < MIN_FREE_BYTES) throw new Error("research media archive blocked: insufficient VPS disk headroom");
}

export async function downloadAndVerify(url, maxBytes, fetchImpl = fetch) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("media source must be HTTP(S)");
  const response = await fetchImpl(parsed, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "BlockwiseHermesArchive/1.0" } });
  if (!response.ok || !response.body) throw new Error(`media source fetch failed: ${response.status}`);
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > maxBytes) throw new Error("media source exceeds archive size limit");
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new Error("media source exceeds archive size limit"); } chunks.push(value); }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (!bytes.length) throw new Error("media source is empty");
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  if (!/^image\//u.test(mimeType) && !/^video\//u.test(mimeType)) throw new Error(`unsupported archived media MIME: ${mimeType}`);
  return { bytes, mimeType, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function uploadOrVerify(objectKey, captured) {
  const path = `storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  let response = await fetch(`${storageUrl}/${path}`, { method: "PUT", body: captured.bytes, headers: hermesSupabaseHeaders(storageCredential, { "content-type": captured.mimeType, "x-upsert": "false" }) });
  if (!response.ok && response.status !== 409) throw new Error(`archive upload failed: ${response.status}`);
  response = await fetch(`${storageUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectKey.split("/").map(encodeURIComponent).join("/")}`, { headers: hermesSupabaseHeaders(storageCredential) });
  if (!response.ok) throw new Error(`archive verification download failed: ${response.status}`);
  const stored = Buffer.from(await response.arrayBuffer());
  if (stored.length !== captured.bytes.length || createHash("sha256").update(stored).digest("hex") !== captured.sha256) {
    throw new Error("stored archive byte/hash mismatch");
  }
}

async function researchRest(path, init = {}) {
  const response = await fetch(`${researchUrl}/rest/v1/${path}`, { ...init, headers: hermesSupabaseHeaders(researchCredential, { "Accept-Profile": "research", "Content-Profile": "research", "Content-Type": "application/json", ...(init.headers || {}) }) });
  const text = await response.text(); if (!response.ok) throw new Error(`research API failed ${response.status}: ${text.slice(0, 300)}`); return text ? JSON.parse(text) : null;
}
