import { templatePackSchema, sha256Hex } from "../../../packages/ad-template-pack-contract/src/index.ts";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types.js";
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
  const parsed = templatePackSchema.safeParse(packJson);
  if (!parsed.success) {
    throw importError("schema_invalid", "Pack failed schema validation", parsed.error.issues);
  }
  const pack = parsed.data as TemplatePack;

  // 8. Signature verification (placeholder — real Ed25519 in Phase 5)
  // verifySignature(pack.manifestSha256, input.signature, frankPublicKey);

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
