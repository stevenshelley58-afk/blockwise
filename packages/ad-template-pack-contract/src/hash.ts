import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

// ---------------------------------------------------------------------------
// RFC 8785 JSON Canonicalization Scheme hashing — deterministic, stable across Frank and Blockwise.
// ---------------------------------------------------------------------------

/**
 * Produce RFC 8785 JCS bytes represented as a string.
 * The canonicalize package owns key ordering, string escaping, and number formatting.
 */
export function canonicalJson(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TypeError("Cannot canonicalize an undefined JSON value");
  }
  return result;
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
