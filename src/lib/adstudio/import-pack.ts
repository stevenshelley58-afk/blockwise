import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { canonicalJson, templatePackAnySchema, sha256Hex } from "../../../packages/ad-template-pack-contract/src/index.ts";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportRequest {
  packUrl: string;
  packSha256: string;
  packId: string;
  buildId: string;
  issuedAt: string;
  nonce: string;
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

/**
 * TEST/LOCAL-ONLY injection point.
 *
 * When `fetchPack` is provided, the pack bytes come from this function instead
 * of a live network fetch of `input.packUrl`, and the HTTPS + origin allowlist
 * check is skipped — the caller vouches for the source. This is how tests and
 * local fixture imports (no live Frank URL) exercise the full pipeline.
 *
 * Production callers (the internal route) MUST NOT pass this option; for them
 * the allowlist and live fetch below remain enforced.
 */
export interface ImportOptions {
  fetchPack?: (url: string) => Promise<unknown>;
  fetchAsset?: (url: string) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PACK_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ASSET_SIZE = 10 * 1024 * 1024;
const MAX_ASSET_TOTAL_SIZE = 100 * 1024 * 1024;
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes
const ALLOWED_ORIGINS = ["frank.fail", "frank-template-factory.local"];

// ---------------------------------------------------------------------------
// Validation pipeline
// ---------------------------------------------------------------------------

export async function importTemplatePack(
  supabase: SupabaseClient,
  input: ImportRequest,
  options: ImportOptions = {},
): Promise<ImportReceipt> {
  // 0. Idempotency check
  const existing = await checkIdempotency(supabase, input.packSha256);
  if (existing) return existing;

  // 1. Timestamp window
  validateTimestamp(input.issuedAt);

  // 2. Nonce check
  await validateNonce(supabase, input.nonce);

  // 3. Origin allowlist — skipped only for the injected test/local fetchPack path
  if (!options.fetchPack) {
    validateOrigin(input.packUrl);
  }

  // 3.5 Production route must never import without a key to authenticate the
  // pack. Enforced BEFORE any network fetch (fail fast, no wasted egress).
  // The only exception is the documented TEST/LOCAL-ONLY injection point:
  // when `fetchPack` is provided the caller vouches for the source, so the
  // signature check may be skipped if FRANK_PACK_PUBLIC_KEY is unset.
  if (!options.fetchPack && !process.env.FRANK_PACK_PUBLIC_KEY) {
    throw importError(
      "missing_public_key",
      "FRANK_PACK_PUBLIC_KEY is not set — refusing to import an unsigned pack",
    );
  }

  // 4. Fetch pack (injected fixture source, or live Frank URL)
  const packJson = options.fetchPack
    ? await options.fetchPack(input.packUrl)
    : await fetchPack(input.packUrl);

  // 5. Size check
  const packBuffer = Buffer.from(JSON.stringify(packJson), "utf-8");
  if (packBuffer.length > MAX_PACK_SIZE) {
    throw importError("size_exceeded", "Pack exceeds 50 MB limit");
  }

  // 6. Hash verification
  const actualHash = sha256Hex(packJson);
  if (actualHash !== input.packSha256) {
    throw importError("hash_mismatch", `Expected ${input.packSha256}, got ${actualHash}`);
  }

  // 7. Schema validation
  const parsed = templatePackAnySchema.safeParse(packJson);
  if (!parsed.success) {
    throw importError("schema_invalid", "Pack failed schema validation", parsed.error.issues);
  }
  const pack = parsed.data as TemplatePack;

  // 8. Signature verification — Ed25519 over the canonical pack JSON
  // (same canonicalization the factory signs: recursively sorted keys, no
  // whitespace). Skipped ONLY on the injected fetchPack path when
  // FRANK_PACK_PUBLIC_KEY is unset (documented test/local exception).
  const publicKeyHex = process.env.FRANK_PACK_PUBLIC_KEY;
  if (publicKeyHex && !verifyPackSignature(packJson, input.signature, publicKeyHex)) {
    throw importError(
      "signature_rejected",
      "Ed25519 signature does not verify over the canonical pack JSON",
    );
  }

  // 9. Asset and font hash verification (placeholder — assets fetched in Phase 5)
  // for (const [key, asset] of Object.entries(pack.assets)) {
  //   const buf = await fetchAsset(key);
  //   if (sha256Hex(buf) !== asset.sha256) throw importError("asset_hash_mismatch", key);
  // }

  // 10. Canary renders (placeholder — full render in Phase 5)
  // const { renderBoth } = await import("@blockwise/ad-deterministic-renderer");
  // const [feed, story] = renderBoth({ pack, imageValues: {}, textValues: {}, colourMap: pack.semanticColours });
  // if (pack.safePreviews.feed.sha256 !== feed.sha256) throw importError("preview_mismatch", "Feed preview hash doesn't match canary render");
  // if (pack.safePreviews.story.sha256 !== story.sha256) throw importError("preview_mismatch", "Story preview hash doesn't match canary render");

  const resolvedAssets = await resolveDeclaredAssets(pack, input.packUrl, options.fetchAsset);

  // 11. Atomic activation
  return await activatePack(supabase, input, pack, resolvedAssets);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify the pack's Ed25519 signature over the CANONICAL JSON bytes of the
 * pack object — the exact bytes the Frank factory signs (recursively sorted
 * keys, no whitespace; same canonicalization as sha256Hex).
 *
 * @param packJson     the parsed pack object (as fetched)
 * @param signatureHex lowercase hex Ed25519 signature (from the import request)
 * @param publicKeyHex lowercase hex SPKI DER Ed25519 public key
 *                     (FRANK_PACK_PUBLIC_KEY env — the factory's public key)
 * @returns true only when the signature verifies; malformed key/signature
 *          hex or a mismatch all return false (never throws).
 */
export function verifyPackSignature(packJson: unknown, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyHex, "hex"), format: "der", type: "spki" });
    const canonicalBytes = Buffer.from(canonicalJson(packJson), "utf-8");
    return verifyEd25519(null, canonicalBytes, publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false; // malformed key/signature -> not verified
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
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw importError("invalid_origin", "packUrl must use HTTPS");
    const allowed = ALLOWED_ORIGINS.some(o => parsed.hostname === o || parsed.hostname.endsWith(`.${o}`));
    if (!allowed) throw importError("origin_not_allowed", `Origin ${parsed.hostname} is not in the allowlist`);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e) throw e;
    throw importError("invalid_url", "packUrl is not a valid URL");
  }
}

async function fetchPack(url: string): Promise<unknown> {
  // No redirects — fetch with redirect: 'manual'
  const response = await fetch(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw importError("redirect_not_allowed", "packUrl must not redirect");
  }
  if (!response.ok) {
    throw importError("fetch_failed", `Failed to fetch pack: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

type ResolvedAsset = { key: string; fileName: string; sha256: string; mimeType: string; bytes: Uint8Array };
type AssetRefLike = { assetKey?: unknown; url?: unknown };

async function resolveDeclaredAssets(pack: TemplatePack, packUrl: string, injectedFetch?: (url: string) => Promise<unknown>): Promise<ResolvedAsset[]> {
  if ((pack as unknown as { schema?: string }).schema !== "blockwise.template-pack/v2") return [];
  const refs = collectV2AssetRefs(pack);
  const base = releaseAssetBase(packUrl);
  const declarations: Array<{ key: string; fileName: string; sha256: string; mimeType: string; url: string | null }> = [];
  for (const [key, asset] of Object.entries(pack.assets)) {
    declarations.push({ key, fileName: asset.fileName, sha256: asset.sha256, mimeType: asset.mimeType, url: resolveDeclaredUrl(refs.get(key)?.url, base, asset.fileName) });
  }
  for (const font of pack.fonts) {
    declarations.push({ key: `font:${font.file}`, fileName: font.file, sha256: font.sha256, mimeType: mimeForFont(font.file), url: resolveDeclaredUrl(refs.get(font.file)?.url, base, font.file) });
  }
  const resolved: ResolvedAsset[] = [];
  let total = 0;
  for (const declaration of declarations) {
    if (!declaration.url) throw importError("asset_url_missing", `No resolvable URL declared for ${declaration.key}`);
    const bytes = await fetchAssetBytes(declaration.url, injectedFetch);
    if (bytes.byteLength > MAX_ASSET_SIZE) throw importError("asset_size_exceeded", `${declaration.key} exceeds the 10 MB per-file limit`);
    total += bytes.byteLength;
    if (total > MAX_ASSET_TOTAL_SIZE) throw importError("asset_total_size_exceeded", "Template assets exceed the 100 MB total limit");
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== declaration.sha256) throw importError("asset_hash_mismatch", `${declaration.key}: expected ${declaration.sha256}, got ${actualHash}`);
    const actualMime = sniffMime(bytes);
    if (actualMime !== declaration.mimeType) throw importError("asset_mime_mismatch", `${declaration.key}: expected ${declaration.mimeType}, got ${actualMime}`);
    resolved.push({ ...declaration, bytes });
  }
  return resolved;
}

function collectV2AssetRefs(pack: TemplatePack): Map<string, AssetRefLike> {
  const metadata = (pack as unknown as { metadata?: Record<string, unknown> }).metadata;
  const refs: AssetRefLike[] = [];
  const gallery = metadata?.gallerySamples as Record<string, unknown> | undefined;
  if (gallery) refs.push(...Object.values(gallery).filter(isRecord) as AssetRefLike[]);
  for (const field of ["replacementAssets", "realAssetRefs"] as const) {
    const values = metadata?.[field];
    if (Array.isArray(values)) refs.push(...values.filter(isRecord) as AssetRefLike[]);
  }
  return new Map(refs.filter((ref) => typeof ref.assetKey === "string").map((ref) => [String(ref.assetKey), ref]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function releaseAssetBase(packUrl: string): URL {
  const parsed = new URL(packUrl);
  if (parsed.protocol !== "https:") throw importError("invalid_origin", "packUrl must use HTTPS");
  parsed.search = ""; parsed.hash = "";
  parsed.pathname = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);
  return parsed;
}

function resolveDeclaredUrl(explicit: unknown, base: URL, fileName: string): string | null {
  try {
    const candidate = explicit == null ? new URL(fileName, base) : new URL(String(explicit), base);
    if (candidate.protocol !== "https:" || candidate.origin !== base.origin) return null;
    if (!candidate.pathname.startsWith(base.pathname) || candidate.pathname.includes("..")) return null;
    candidate.search = ""; candidate.hash = "";
    return candidate.toString();
  } catch { return null; }
}

async function fetchAssetBytes(url: string, injectedFetch?: (url: string) => Promise<unknown>): Promise<Uint8Array> {
  const value = injectedFetch ? await injectedFetch(url) : await fetch(url, { redirect: "manual" });
  if (value instanceof Response) {
    if (value.redirected || (value.status >= 300 && value.status < 400)) throw importError("redirect_not_allowed", `Asset URL must not redirect: ${url}`);
    if (!value.ok) throw importError("asset_fetch_failed", `Failed to fetch asset: ${value.status}`);
    return new Uint8Array(await value.arrayBuffer());
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  throw importError("asset_fetch_invalid", `Asset fetcher did not return bytes for ${url}`);
}

function mimeForFont(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}

function sniffMime(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 12));
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (head.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (head.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (head.subarray(0, 4).toString("ascii") === "wOFF") return "font/woff";
  if (head.subarray(0, 4).toString("ascii") === "wOF2") return "font/woff2";
  if (head.subarray(0, 4).toString("ascii") === "OTTO") return "font/otf";
  if (head.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]))) return "font/ttf";
  return "application/octet-stream";
}

async function validateNonce(supabase: SupabaseClient, nonce: string): Promise<void> {
  // Check if nonce was already used
  const { data } = await supabase.from("ad_import_nonces").select("nonce").eq("nonce", nonce).maybeSingle();
  if (data) throw importError("nonce_replay", "Nonce has already been used");

  // Record nonce
  const { error } = await supabase.from("ad_import_nonces").insert({ nonce });
  if (error) throw importError("nonce_insert_failed", error.message);
}

async function checkIdempotency(
  supabase: SupabaseClient,
  packSha256: string,
): Promise<ImportReceipt | null> {
  const { data } = await supabase
    .from("ad_import_receipts")
    .select("*")
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
  resolvedAssets: ResolvedAsset[],
): Promise<ImportReceipt> {
  // Check for conflicting packId with different hash
  const { data: existing } = await supabase
    .from("ad_import_receipts")
    .select("pack_sha256")
    .eq("pack_id", input.packId)
    .maybeSingle();

  if (existing && existing.pack_sha256 !== input.packSha256) {
    throw importError("pack_id_conflict", "Same packId with different hash — rejected");
  }

  // Upload all verified bytes before writing the active receipt/pack rows.
  // A failed upload therefore cannot activate a pack with missing assets.
  for (const asset of resolvedAssets) {
    const { error } = await supabase.storage.from("workspace-artifacts").upload(
      storagePathForAsset(pack.packId, asset)!, asset.bytes,
      { contentType: asset.mimeType, upsert: true },
    );
    if (error) throw importError("asset_upload_failed", `${asset.key}: ${error.message}`);
  }

  // Atomic: insert receipt + pack + assets in one conceptual transaction
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
      status: "active",
    })
    .select("id, pack_id, pack_sha256, created_at")
    .single();

  if (receiptError) throw importError("receipt_insert_failed", receiptError.message);

  // Insert pack
  await supabase.from("ad_template_packs").insert({
    pack_id: input.packId,
    template_id: pack.templateId,
    version: pack.version,
    manifest_sha256: pack.manifestSha256,
    signature: input.signature,
    pack_json: pack as unknown as Record<string, unknown>,
  });

  // Insert version
  await supabase.from("ad_template_pack_versions").insert({
    pack_id: input.packId,
    version: pack.version,
    manifest_sha256: pack.manifestSha256,
    pack_json: pack as unknown as Record<string, unknown>,
  });

  // Insert assets
  const assetRows = Object.entries(pack.assets).map(([key, asset]) => ({
    pack_id: input.packId,
    asset_key: key,
    file_name: (asset as { fileName: string }).fileName,
    sha256: (asset as { sha256: string }).sha256,
    mime_type: (asset as { mimeType: string }).mimeType,
    storage_path: storagePathForAsset(pack.packId, resolvedAssets.find((item) => item.key === key)),
  }));
  for (const asset of resolvedAssets.filter((item) => item.key.startsWith("font:"))) {
    assetRows.push({
      pack_id: input.packId,
      asset_key: asset.key,
      file_name: asset.fileName,
      sha256: asset.sha256,
      mime_type: asset.mimeType,
      storage_path: storagePathForAsset(pack.packId, asset),
    });
  }
  if (assetRows.length > 0) {
    await supabase.from("ad_template_assets").insert(assetRows);
  }

  return {
    receiptId: receipt!.id,
    packId: input.packId,
    packSha256: input.packSha256,
    status: "active",
    activatedAt: receipt!.created_at,
  };
}

function storagePathForAsset(packId: string, asset: ResolvedAsset | undefined): string | null {
  if (!asset) return null;
  const safeName = asset.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeKey = asset.key.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `templates/${packId}/${safeKey}-${asset.sha256.slice(0, 16)}-${safeName}`;
}

function importError(code: string, message: string, detail?: unknown): ImportError & Error {
  const err = new Error(message) as ImportError & Error;
  (err as ImportError).code = code;
  (err as ImportError).detail = detail;
  return err;
}
