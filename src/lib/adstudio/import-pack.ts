import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { canonicalJson, templatePackSchema } from "../../../packages/ad-template-pack-contract/src/index.ts";
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
 * When `fetchPackBytes` is provided, the exact pack bytes come from this function instead
 * of a live network fetch of `input.packUrl`, and the HTTPS + origin allowlist
 * check is skipped — the caller vouches for the source. This is how tests and
 * local fixture imports (no live Frank URL) exercise the full pipeline.
 *
 * Production callers (the internal route) MUST NOT pass this option; for them
 * the allowlist and live fetch below remain enforced.
 */
export interface ImportOptions {
  fetchPackBytes?: (url: string) => Promise<string | Uint8Array>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PACK_SIZE = 50 * 1024 * 1024; // 50 MB
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
  if (options.fetchPackBytes && process.env.NODE_ENV === "production") {
    throw importError("fixture_injection_disabled", "Injected TemplatePack bytes are disabled in production");
  }

  // 0. Idempotency check
  const existing = await checkIdempotency(supabase, input.packSha256, input.packId);
  if (existing) return existing;

  // 1. Timestamp window
  validateTimestamp(input.issuedAt);

  // 2. Nonce check (recorded only after the complete pack validates)
  await assertNonceUnused(supabase, input.nonce);

  // 3. Origin allowlist — skipped only for injected test/local raw bytes
  if (!options.fetchPackBytes) {
    validateOrigin(input.packUrl);
  }

  // 3.5 Production route must never import without a key to authenticate the
  // pack. Enforced BEFORE any network fetch (fail fast, no wasted egress).
  // The only exception is the documented TEST/LOCAL-ONLY injection point:
  // when `fetchPackBytes` is provided the caller vouches for the source, so the
  // signature check may be skipped if FRANK_PACK_PUBLIC_KEY is unset.
  if (!options.fetchPackBytes && !process.env.FRANK_PACK_PUBLIC_KEY) {
    throw importError(
      "missing_public_key",
      "FRANK_PACK_PUBLIC_KEY is not set — refusing to import an unsigned pack",
    );
  }

  // 4. Fetch exactly once as bounded raw bytes. Production never hashes a
  // parsed/re-serialized object because template_pack.sha256 authenticates the
  // artifact bytes as served.
  const packBytes = options.fetchPackBytes
    ? normalizeInjectedPackBytes(await options.fetchPackBytes(input.packUrl))
    : await fetchPackBytes(input.packUrl);

  // 5. Size check before decoding or parsing (production also bounds while reading).
  if (packBytes.byteLength > MAX_PACK_SIZE) {
    throw importError("size_exceeded", "Pack exceeds 50 MB limit");
  }

  // 6. Exact raw-byte hash verification before JSON parsing.
  const actualHash = createHash("sha256").update(packBytes).digest("hex");
  if (actualHash !== input.packSha256) {
    throw importError("hash_mismatch", `Expected ${input.packSha256}, got ${actualHash}`);
  }

  // 7. Decode, parse, and validate schema.
  const packJson = parsePackJson(packBytes);
  const parsed = templatePackSchema.safeParse(packJson);
  if (!parsed.success) {
    throw importError("schema_invalid", "Pack failed schema validation", parsed.error.issues);
  }
  const pack = parsed.data as TemplatePack;
  if (pack.packId !== input.packId) {
    throw importError("pack_id_mismatch", "Fetched TemplatePack identity does not match the requested packId");
  }

  // 8. Signature verification — Ed25519 over the canonical pack JSON
  // (same canonicalization the factory signs: recursively sorted keys, no
  // whitespace). Skipped ONLY on the injected fetchPackBytes path when
  // FRANK_PACK_PUBLIC_KEY is unset (documented test/local exception).
  const publicKeyHex = process.env.FRANK_PACK_PUBLIC_KEY;
  if (publicKeyHex && !verifyPackSignature(packJson, input.signature, publicKeyHex)) {
    throw importError(
      "signature_rejected",
      "Ed25519 signature does not verify over the canonical pack JSON",
    );
  }

  await recordNonce(supabase, input.nonce);

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

  // 11. Atomic activation
  return await activatePack(supabase, input, pack);
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
 * @param signature    hex, base64, or base64url Ed25519 signature (from the import request)
 * @param publicKeyHex lowercase hex SPKI DER Ed25519 public key
 *                     (FRANK_PACK_PUBLIC_KEY env — the factory's public key)
 * @returns true only when the signature verifies; malformed key/signature
 *          hex or a mismatch all return false (never throws).
 */
export function verifyPackSignature(packJson: unknown, signature: string, publicKeyHex: string): boolean {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyHex, "hex"), format: "der", type: "spki" });
    const canonicalBytes = Buffer.from(canonicalJson(packJson), "utf-8");
    const signatureBytes = decodeEd25519Signature(signature);
    return signatureBytes !== null && verifyEd25519(null, canonicalBytes, publicKey, signatureBytes);
  } catch {
    return false; // malformed key/signature -> not verified
  }
}

function decodeEd25519Signature(signature: string): Buffer | null {
  if (/^[a-f0-9]{128}$/u.test(signature)) return Buffer.from(signature, "hex");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/u.test(signature)) return null;
  const normalized = signature.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = Buffer.from(padded, "base64");
  return bytes.length === 64 ? bytes : null;
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

function normalizeInjectedPackBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return value;
  throw importError("invalid_fixture_bytes", "Injected TemplatePack fixture must provide raw UTF-8 bytes");
}

function parsePackJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw importError("invalid_json", "TemplatePack artifact is not valid UTF-8 JSON");
  }
}

async function fetchPackBytes(url: string): Promise<Uint8Array> {
  // No redirects — fetch with redirect: 'manual'
  const response = await fetch(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw importError("redirect_not_allowed", "packUrl must not redirect");
  }
  if (!response.ok) {
    throw importError("fetch_failed", `Failed to fetch pack: ${response.status} ${response.statusText}`);
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PACK_SIZE) {
    await response.body?.cancel();
    throw importError("size_exceeded", "Pack exceeds 50 MB limit");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PACK_SIZE) {
        await reader.cancel();
        throw importError("size_exceeded", "Pack exceeds 50 MB limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function assertNonceUnused(supabase: SupabaseClient, nonce: string): Promise<void> {
  // Check if nonce was already used
  const { data } = await supabase.from("ad_import_nonces").select("nonce").eq("nonce", nonce).maybeSingle();
  if (data) throw importError("nonce_replay", "Nonce has already been used");
}

async function recordNonce(supabase: SupabaseClient, nonce: string): Promise<void> {
  // Record nonce
  const { error } = await supabase.from("ad_import_nonces").insert({ nonce });
  if (error) throw importError("nonce_insert_failed", error.message);
}

async function checkIdempotency(
  supabase: SupabaseClient,
  packSha256: string,
  packId: string,
): Promise<ImportReceipt | null> {
  const { data } = await supabase
    .from("ad_import_receipts")
    .select("*")
    .eq("pack_sha256", packSha256)
    .eq("status", "active")
    .maybeSingle();

  if (data) {
    if (data.pack_id !== packId) {
      throw importError("pack_id_mismatch", "Existing TemplatePack receipt does not match the requested packId");
    }
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
  }));
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

function importError(code: string, message: string, detail?: unknown): ImportError & Error {
  const err = new Error(message) as ImportError & Error;
  (err as ImportError).code = code;
  (err as ImportError).detail = detail;
  return err;
}
