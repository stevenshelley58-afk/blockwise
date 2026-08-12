import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Canonical JSON hashing — deterministic, stable across Frank and Blockwise.
// ---------------------------------------------------------------------------

/**
 * Produce a canonical (sorted-key) JSON string.
 * Keys are sorted recursively; no whitespace variation.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortedKeysReplacer);
}

function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * SHA-256 of the canonical JSON representation, lowercase hex.
 */
export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Compute the manifest hash: SHA-256 of the pack WITHOUT the manifestSha256
 * and signature fields (they can't hash themselves).
 */
export function computeManifestHash(pack: Record<string, unknown>): string {
  const { manifestSha256: _, signature: __, ...rest } = pack;
  return sha256Hex(rest);
}

/**
 * Verify that the pack's declared manifestSha256 matches the computed one.
 */
export function verifyManifestHash(pack: Record<string, unknown>): boolean {
  return computeManifestHash(pack) === pack.manifestSha256;
}
