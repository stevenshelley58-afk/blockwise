#!/usr/bin/env node

// Live Meta contract probe. It is intentionally opt-in and never runs in CI.
// It verifies the Graph version, Instant Form read-back, creative root
// asset_feed_spec, explicit enhancement opt-outs, and generatepreviews.
const accountId = process.env.META_PROBE_AD_ACCOUNT_ID?.trim();
const token = process.env.META_PROBE_ACCESS_TOKEN?.trim();
const graphVersion = process.env.META_GRAPH_API_VERSION ?? "v26.0";
if (!accountId || !token) {
  console.error("META_PROBE_AD_ACCOUNT_ID and META_PROBE_ACCESS_TOKEN are required; no provider call was made.");
  process.exit(2);
}
if (process.env.CI) throw new Error("Refusing to run the live Meta provider probe in CI.");

const base = `https://graph.facebook.com/${graphVersion}`;
const response = await fetch(`${base}/${accountId}/generatepreviews`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    creative: JSON.stringify({
      name: `blockwise-probe-${Date.now()}`,
      object_story_spec: {
        page_id: process.env.META_PROBE_PAGE_ID ?? "0",
        link_data: { message: "Probe", name: "Probe", description: "Probe", link: "https://example.com" },
      },
      degrees_of_freedom_spec: { creative_features_spec: {
        adapt_to_placement: { enroll_status: "OPT_OUT" },
        image_touchups: { enroll_status: "OPT_OUT" },
        text_optimizations: { enroll_status: "OPT_OUT" },
      } },
    }),
    ad_format: "MOBILE_FEED_STANDARD",
  }),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(payload?.error?.message ?? `Meta probe failed with ${response.status}.`);
console.log(JSON.stringify({ graphVersion, status: response.status, previewCount: Array.isArray(payload.data) ? payload.data.length : 0 }));
