// AdStudio v2 rollout flags (§11 of the rebuild plan).
//
// Env flags are the WHOLE mechanism — no per-workspace flag system. Off by
// default so the v1 path stays fully intact until cutover; flipping them on
// a Vercel Preview deploy is how v2 gets tested without touching production.

function flagEnabled(rawValue: string | undefined): boolean {
  const value = rawValue?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Gallery serves v2 `ready` templates; generation and edit routes accept v2
 * docs. Off → customers see the v1 gallery and pipeline.
 */
export function adstudioTemplatesV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return flagEnabled(env.ADSTUDIO_TEMPLATES_V2);
}

/**
 * Two-image asset_feed_spec creative path (feed + story placement routing).
 * Must stay off until the meta-publish-probe has evidence on the dev ad
 * account — the combined lead-ad + asset_feed shape is unverified in docs.
 */
export function metaAssetFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return flagEnabled(env.META_ASSET_FEED_ENABLED);
}
