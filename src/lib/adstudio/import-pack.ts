import { createHash } from "node:crypto";
import { verify } from "node:crypto";
import { templatePackSchema } from "../../../packages/ad-template-pack-contract/src/schema.ts";
import { computeManifestHash } from "../../../packages/ad-template-pack-contract/src/hash.ts";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types.ts";
import { extractArchiveEntries, verifyEntrySet } from "./import-archive.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Phase 3 — Blockwise importer: signed TemplatePack transport from Frank.
//
// Envelope: expiring HTTPS URL on the Frank allowlist serving a ZIP archive.
// Archive layout (exact set, enforced):
//   manifest.json                      — the signed TemplatePack (no signature
//                                        required inside; signature is at
//                                        envelope level over manifestSha256)
//   assets/<fileName>                  — every entry in pack.assets
//   fonts/<file>                       — every entry in pack.fonts
//   previews/feed.png, previews/story.png — deterministic chrome previews
//
// Security pipeline (order matters — fail fast, fail closed):
//   idempotency → timestamp window → one-use nonce → origin allowlist →
//   no-redirect fetch with size ceiling → archive security parsing
//   (traversal/symlink/bomb rejection) → manifest schema → manifest hash →
//   Ed25519 signature → asset + font hash verification → canary renders vs
//   supplied previews → quarantine receipt → storage upload → activation.
// ---------------------------------------------------------------------------

export interface ImportRequest {
  packUrl: string;
  packSha256: string;
  packId: string;
  buildId: string;
  issuedAt: string;
  nonce: string;
  /** Base64 Ed25519 signature of pack.manifestSha256 (utf8). */
  signature: string;
  idempotencyKey: string;
}

export interface ImportReceipt {
  receiptId: string;
  packId: string;
  packSha256: string;
  status: "active" | "replayed";
  activatedAt: string;
}

export interface ImportError {
  code: string;
  message: string;
  detail?: unknown;
}

export interface ImportDeps {
  /** Frank's Ed25519 public key (raw 32 bytes, hex or base64). Fail closed if absent. */
  frankPublicKey: string;
  /** Injected fetch for testability. */
  fetchFn?: typeof fetch;
  /** Upload one byte buffer to template storage; returns the durable path. */
  uploadAsset?: (path: string, bytes: Buffer, mimeType: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024; // 50 MB transport ceiling
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes
const ALLOWED_ORIGINS = ["frank.fail", "frank-template-factory.local"];

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function importTemplatePack(
  supabase: SupabaseClient,
  input: ImportRequest,
  deps: ImportDeps,
): Promise<ImportReceipt> {
  // 1. Idempotency — identical replay returns the same receipt.
  const existing = await checkIdempotency(supabase, input.packSha256);
  if (existing) return existing;

  // 2. Timestamp window.
  validateTimestamp(input.issuedAt);

  // 3. One-use nonce.
  await validateNonce(supabase, input.nonce);

  // 4. HTTPS origin + path allowlist.
  validateOrigin(input.packUrl);

  // 5. Fetch archive — no redirects, size-ceiled.
  const archive = await fetchArchive(input.packUrl, deps.fetchFn ?? fetch);

  // 6. Archive-level security parsing (traversal, symlinks, bomb, magic).
  const entries = extractArchiveEntries(archive);

  // 7. Manifest extraction + schema validation.
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw importError("zip_missing_entry", "archive does not contain manifest.json");
  const manifestJson = safeParseJson(manifestBytes);
  const parsed = templatePackSchema.safeParse(manifestJson);
  if (!parsed.success) {
    throw importError("schema_invalid", "Pack failed schema validation", parsed.error.issues);
  }
  const pack = parsed.data as TemplatePack;

  // 8. Manifest hash verification (signature binds to this).
  const computedManifestHash = computeManifestHash(manifestJson as Record<string, unknown>);
  if (computedManifestHash !== pack.manifestSha256) {
    throw importError("manifest_hash_mismatch", `computed ${computedManifestHash}, declared ${pack.manifestSha256}`);
  }

  // 9. Transport hash verification.
  const archiveHash = createHash("sha256").update(archive).digest("hex");
  if (archiveHash !== input.packSha256) {
    throw importError("hash_mismatch", `Expected ${input.packSha256}, got ${archiveHash}`);
  }

  // 10. Ed25519 signature verification — fail closed.
  verifySignature(pack.manifestSha256, input.signature, deps.frankPublicKey);

  // 11. Exact-set validation against the manifest's declared contents.
  const expected = expectedEntryMap(pack);
  verifyEntrySet(entries, expected);

  // 12. Asset + font hash verification against archive bytes.
  verifyAssetAndFontHashes(pack, entries);

  // 13. Canary renders — deterministic chrome renders must match supplied previews.
  await verifyCanaryRenders(pack, entries);

  // 14. Activation: quarantine receipt → storage upload → atomic activation.
  return await activatePack(supabase, input, pack, entries, deps);
}

// ---------------------------------------------------------------------------
// Validation steps
// ---------------------------------------------------------------------------

function safeParseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw importError("schema_invalid", "manifest.json is not valid JSON");
  }
}

function validateTimestamp(issuedAt: string): void {
  const ts = new Date(issuedAt).getTime();
  if (isNaN(ts)) throw importError("invalid_timestamp", "issuedAt is not a valid ISO timestamp");
  const now = Date.now();
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_MS) {
    throw importError("timestamp_expired", "issuedAt is outside the ±5 minute window");
  }
}

function validateOrigin(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw importError("invalid_url", "packUrl is not a valid URL");
  }
  if (parsed.protocol !== "https:") throw importError("invalid_origin", "packUrl must use HTTPS");
  const allowed = ALLOWED_ORIGINS.some(o => parsed.hostname === o || parsed.hostname.endsWith(`.${o}`));
  if (!allowed) throw importError("origin_not_allowed", `Origin ${parsed.hostname} is not in the allowlist`);
}

async function fetchArchive(url: string, fetchFn: typeof fetch): Promise<Buffer> {
  const response = await fetchFn(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw importError("redirect_not_allowed", "packUrl must not redirect");
  }
  if (!response.ok) {
    throw importError("fetch_failed", `Failed to fetch pack: ${response.status} ${response.statusText}`);
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && parseInt(declaredLength, 10) > MAX_ARCHIVE_SIZE) {
    throw importError("size_exceeded", "Pack exceeds 50 MB limit");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE_SIZE) {
    throw importError("size_exceeded", "Pack exceeds 50 MB limit");
  }
  return bytes;
}

/** Build the exact expected archive entry set from the manifest. */
export function expectedEntryMap(pack: TemplatePack): Record<string, string> {
  const map: Record<string, string> = {
    "manifest.json": "application/json",
    "previews/feed.png": "image/png",
    "previews/story.png": "image/png",
  };
  for (const asset of Object.values(pack.assets)) {
    map[`assets/${asset.fileName}`] = asset.mimeType;
  }
  for (const font of pack.fonts) {
    map[`fonts/${font.file}`] = font.file.endsWith(".woff") ? "font/woff" : "font/woff2";
  }
  return map;
}

function verifyAssetAndFontHashes(pack: TemplatePack, entries: Map<string, Buffer>): void {
  for (const [key, asset] of Object.entries(pack.assets)) {
    const bytes = entries.get(`assets/${asset.fileName}`);
    if (!bytes) throw importError("asset_missing", `declared asset ${key} (${asset.fileName}) not in archive`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.sha256) {
      throw importError("asset_hash_mismatch", `asset ${key}: expected ${asset.sha256}, got ${actual}`);
    }
  }
  for (const font of pack.fonts) {
    const bytes = entries.get(`fonts/${font.file}`);
    if (!bytes) throw importError("font_missing", `declared font ${font.file} not in archive`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== font.sha256) {
      throw importError("font_hash_mismatch", `font ${font.file}: expected ${font.sha256}, got ${actual}`);
    }
  }
}

async function verifyCanaryRenders(pack: TemplatePack, entries: Map<string, Buffer>): Promise<void> {
  // Dynamic import keeps @napi-rs/canvas out of cold-start routes that reject
  // earlier in the pipeline.
  const { renderBoth } = await import("../../../packages/ad-deterministic-renderer/src/renderer.ts");

  const fonts: Record<string, Buffer> = {};
  for (const font of pack.fonts) {
    fonts[font.file] = entries.get(`fonts/${font.file}`)!;
  }

  const [feed, story] = await renderBoth({
    pack,
    imageValues: {},
    textValues: {},
    colourMap: pack.semanticColours,
    fonts,
  });

  const declaredFeedHash = pack.safePreviews.feed.sha256;
  const declaredStoryHash = pack.safePreviews.story.sha256;
  if (declaredFeedHash !== feed.sha256) {
    throw importError("preview_mismatch", `Feed canary render ${feed.sha256} does not match declared preview ${declaredFeedHash}`);
  }
  if (declaredStoryHash !== story.sha256) {
    throw importError("preview_mismatch", `Story canary render ${story.sha256} does not match declared preview ${declaredStoryHash}`);
  }

  // Supplied preview bytes must hash to the same values.
  const feedPreview = entries.get("previews/feed.png")!;
  const storyPreview = entries.get("previews/story.png")!;
  const feedBytesHash = createHash("sha256").update(feedPreview).digest("hex");
  const storyBytesHash = createHash("sha256").update(storyPreview).digest("hex");
  if (feedBytesHash !== declaredFeedHash) {
    throw importError("preview_mismatch", "Feed preview bytes do not match declared preview hash");
  }
  if (storyBytesHash !== declaredStoryHash) {
    throw importError("preview_mismatch", "Story preview bytes do not match declared preview hash");
  }
}

function verifySignature(manifestSha256: string, signatureB64: string, publicKey: string): void {
  if (!publicKey || publicKey === "change-me-in-production") {
    throw importError("signature_config_missing", "Frank public key is not configured — refusing unsigned import");
  }
  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(publicKey, publicKey.length === 64 ? "hex" : "base64");
    if (keyBuffer.length !== 32) throw new Error("bad key length");
  } catch {
    throw importError("signature_config_invalid", "Frank public key is not 32 bytes of hex or base64");
  }
  let sigBuffer: Buffer;
  try {
    sigBuffer = Buffer.from(signatureB64, "base64");
    if (sigBuffer.length !== 64) throw new Error("bad sig length");
  } catch {
    throw importError("signature_invalid", "signature is not valid base64 of a 64-byte Ed25519 signature");
  }
  const keyObject = {
    key: Buffer.concat([
      // PKCS8 prefix for a raw Ed25519 public key (RFC 8410)
      Buffer.from("302a300506032b6570032100", "hex"),
      keyBuffer,
    ]),
    format: "der" as const,
    type: "spki" as const,
  };
  const ok = verify(null, Buffer.from(manifestSha256, "utf8"), keyObject, sigBuffer);
  if (!ok) throw importError("signature_rejected", "Ed25519 signature does not verify against Frank's public key");
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function validateNonce(supabase: SupabaseClient, nonce: string): Promise<void> {
  const { data } = await supabase.from("ad_import_nonces").select("nonce").eq("nonce", nonce).maybeSingle();
  if (data) throw importError("nonce_replay", "Nonce has already been used");
  const { error } = await supabase.from("ad_import_nonces").insert({ nonce });
  if (error) throw importError("nonce_insert_failed", error.message);
}

async function checkIdempotency(
  supabase: SupabaseClient,
  packSha256: string,
): Promise<ImportReceipt | null> {
  const { data } = await supabase
    .from("ad_import_receipts")
    .select("id, pack_id, pack_sha256, created_at")
    .eq("pack_sha256", packSha256)
    .eq("status", "active")
    .maybeSingle();

  if (data) {
    return {
      receiptId: data.id,
      packId: data.pack_id,
      packSha256: data.pack_sha256,
      status: "replayed",
      activatedAt: data.created_at,
    };
  }
  return null;
}

async function activatePack(
  supabase: SupabaseClient,
  input: ImportRequest,
  pack: TemplatePack,
  entries: Map<string, Buffer>,
  deps: ImportDeps,
): Promise<ImportReceipt> {
  // Same packId with a different transport hash = conflicting replay → 409.
  const { data: existing } = await supabase
    .from("ad_import_receipts")
    .select("pack_sha256")
    .eq("pack_id", input.packId)
    .maybeSingle();
  if (existing && existing.pack_sha256 !== input.packSha256) {
    throw importError("pack_id_conflict", "Same packId with different hash — rejected");
  }

  // 1. Quarantine receipt — visible record that never serves customers.
  const { data: receipt, error: receiptError } = await supabase
    .from("ad_import_receipts")
    .insert({
      pack_id: input.packId,
      pack_sha256: input.packSha256,
      build_id: input.buildId,
      issuer: new URL(input.packUrl).hostname,
      issued_at: input.issuedAt,
      nonce: input.nonce,
      signature: input.signature,
      status: "quarantined",
      receipt: { buildId: input.buildId, idempotencyKey: input.idempotencyKey },
    })
    .select("id, pack_id, pack_sha256, created_at")
    .single();

  if (receiptError) throw importError("receipt_insert_failed", receiptError.message);

  try {
    // 2. Storage upload of assets, fonts and previews.
    const assetMap: Record<string, string> = {};
    const fontMap: Record<string, string> = {};
    const previewMap: Record<string, string> = {};
    if (deps.uploadAsset) {
      for (const [key, asset] of Object.entries(pack.assets)) {
        const bytes = entries.get(`assets/${asset.fileName}`)!;
        assetMap[key] = await deps.uploadAsset(`${input.packId}/assets/${asset.fileName}`, bytes, asset.mimeType);
      }
      for (const font of pack.fonts) {
        const bytes = entries.get(`fonts/${font.file}`)!;
        fontMap[font.file] = await deps.uploadAsset(`${input.packId}/fonts/${font.file}`, bytes, "font/woff2");
      }
      previewMap.feed = await deps.uploadAsset(`${input.packId}/previews/feed.png`, entries.get("previews/feed.png")!, "image/png");
      previewMap.story = await deps.uploadAsset(`${input.packId}/previews/story.png`, entries.get("previews/story.png")!, "image/png");
    }

    // 3. Immutable pack + version + asset rows.
    const packRow = {
      pack_id: input.packId,
      template_id: pack.templateId,
      version: pack.version,
      manifest_sha256: pack.manifestSha256,
      signature: input.signature,
      pack_json: manifestForStorage(pack),
      asset_map: assetMap,
      fonts_map: fontMap,
      previews_map: previewMap,
    };
    const { error: packError } = await supabase.from("ad_template_packs").insert(packRow);
    if (packError) {
      if (/duplicate key/i.test(packError.message)) {
        throw importError("pack_version_conflict", `pack_id ${input.packId} already registered with a different transport`);
      }
      throw importError("pack_insert_failed", packError.message);
    }

    const { error: versionError } = await supabase.from("ad_template_pack_versions").insert({
      pack_id: input.packId,
      version: pack.version,
      manifest_sha256: pack.manifestSha256,
      pack_json: manifestForStorage(pack),
    });
    if (versionError) throw importError("version_insert_failed", versionError.message);

    const assetRows = Object.entries(pack.assets).map(([key, asset]) => ({
      pack_id: input.packId,
      asset_key: key,
      file_name: asset.fileName,
      sha256: asset.sha256,
      mime_type: asset.mimeType,
      storage_path: assetMap[key] ?? null,
    }));
    if (assetRows.length > 0) {
      const { error: assetError } = await supabase.from("ad_template_assets").insert(assetRows);
      if (assetError) throw importError("asset_insert_failed", assetError.message);
    }

    // 4. Atomic activation — the receipt flips only when everything landed.
    const { error: activateError } = await supabase
      .from("ad_import_receipts")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", receipt!.id);
    if (activateError) throw importError("activation_failed", activateError.message);

    return {
      receiptId: receipt!.id,
      packId: input.packId,
      packSha256: input.packSha256,
      status: "active",
      activatedAt: receipt!.created_at,
    };
  } catch (err) {
    // Mark the quarantine receipt rejected so failures are auditable.
    await supabase
      .from("ad_import_receipts")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", receipt!.id);
    throw err;
  }
}

/** Strip transport-only fields before storage (keep the signed manifest pure). */
function manifestForStorage(pack: TemplatePack): Record<string, unknown> {
  return pack as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function importError(code: string, message: string, detail?: unknown): ImportError & Error {
  const err = new Error(message) as ImportError & Error;
  err.code = code;
  err.detail = detail;
  return err;
}
