import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

/** RFC 8785 JSON Canonicalization Scheme used by Frank release contracts. */
export function canonicalizeFrankRelease(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new TypeError("Frank release value cannot be canonicalized.");
  }
  return canonical;
}

export function hashFrankReleaseValue(value: unknown): string {
  return createHash("sha256").update(canonicalizeFrankRelease(value), "utf8").digest("hex");
}

export function hashFrankReleaseEnvelope(value: Record<string, unknown>): string {
  const { release_hash: _releaseHash, ...unsignedRelease } = value;
  return hashFrankReleaseValue(unsignedRelease);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
