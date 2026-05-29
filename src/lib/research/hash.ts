import { createHash } from "node:crypto";

/**
 * Canonical JSON serialisation: sorted keys, no whitespace.
 *
 * Two payloads with the same data but different key order, whitespace, or
 * insertion sequence must produce the SAME canonical bytes. This is the
 * whole reason payload_hash works.
 */
export function canonicaliseJson(value: unknown): string {
  return JSON.stringify(value, replacer);
}

function replacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = record[key];
    }
    return sorted;
  }
  return value;
}

/**
 * SHA-256 of a canonicalised payload.
 *
 * Use for:
 *  - observed_ads.payload_hash (idempotent upsert short-circuit)
 *  - ad_snapshots.payload_hash (unique to prevent duplicate snapshots)
 *  - ad_creatives.creative_hash (dedupe identical creative across ads)
 *  - source_documents.content_hash (uniqueness by source+content)
 *  - ad_fetch_runs.input_hash (re-trigger guard)
 *  - ingest_events.payload_hash (audit)
 */
export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicaliseJson(value), "utf8").digest("hex");
}

/**
 * Hash a creative tuple. Two ads with the same creative content but different
 * external_ad_ids should still share creative_hash.
 */
export function creativeHash(input: {
  headline?: string | null;
  body?: string | null;
  primaryImageUrl?: string | null;
  videoUrl?: string | null;
  ctaUrl?: string | null;
}): string {
  return payloadHash({
    headline: input.headline?.trim() ?? null,
    body: input.body?.trim() ?? null,
    primaryImageUrl: input.primaryImageUrl ?? null,
    videoUrl: input.videoUrl ?? null,
    ctaUrl: input.ctaUrl ?? null,
  });
}

/**
 * Normalise a string for case/whitespace-insensitive comparison of names.
 * Used for agencies.normalized_name and agents.normalized_name uniqueness.
 */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
