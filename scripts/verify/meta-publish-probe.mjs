#!/usr/bin/env node

// Meta publish probe (Track D, §9.2). NEVER in CI — needs live dev-account
// credentials and is gated entirely by env:
//
//   META_PROBE_AD_ACCOUNT_ID  act_… on the DEV ad account (required; absent → exits 2 with a message)
//   META_PROBE_ACCESS_TOKEN   system user or dev token with ads_management
//   META_PROBE_PAGE_ID        the dev page (required for --create)
//   META_ASSET_FEED_ENABLED   "true" to include the two-image asset_feed_spec in the probe payload
//
// Modes:
//   default   GET /act_{id}/generatepreviews with the full v26 creative spec
//             for every preview format (lead-ad + DOF all-OPT_OUT, plus the
//             asset_feed block when enabled). Reports which formats accept.
//   --create  Additionally creates a real PAUSED campaign/adset/lead form/
//             creative/ad on the dev account, prints every object id, then
//             deletes them (ads and ad set first). Evidence for the combined
//   lead-ad + asset_feed shape that Meta docs don't verify.

const AD_ACCOUNT = process.env.META_PROBE_AD_ACCOUNT_ID?.trim();
const TOKEN = process.env.META_PROBE_ACCESS_TOKEN?.trim();
const PAGE_ID = process.env.META_PROBE_PAGE_ID?.trim();
const ASSET_FEED = (process.env.META_ASSET_FEED_ENABLED?.trim() ?? "").toLowerCase() === "true";
const CREATE = process.argv.includes("--create");
const VERSION = process.env.META_GRAPH_API_VERSION ?? "v26.0";

if (!AD_ACCOUNT || !TOKEN) {
  console.error("meta-publish-probe: META_PROBE_AD_ACCOUNT_ID and META_PROBE_ACCESS_TOKEN are required. This probe never runs in CI.");
  process.exit(2);
}

const graph = (path) => `https://graph.facebook.com/${VERSION}${path}`;

async function call(path, body, method = "POST") {
  const response = await fetch(graph(path), {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({})));
  if (!response.ok) {
    return { ok: false, status: response.status, error: payload.error };
  }
  return { ok: true, status: response.status, payload };
}

// ── the full v2 creative spec (mirrors §9.2 of the rebuild plan) ────────────

const CREATIVE_FEATURE_KEYS = [
  "adapt_to_placement", "image_touchups", "image_templates", "inline_comment",
  "enhance_cta", "text_optimizations", "image_animation", "image_background_gen",
  "video_auto_crop", "translate_voiceover", "text_translation", "media_type_automation",
  "product_extensions",
];

function degreesOfFreedomSpec() {
  return {
    degrees_of_freedom_spec: {
      creative_features_spec: Object.fromEntries(CREATIVE_FEATURE_KEYS.map((key) => [key, { enroll_status: "OPT_OUT" }])),
    },
  };
}

function creativeSpec({ withAssetFeed, imageHash, storyHash, leadFormId }) {
  return {
    name: `bw-probe-${Date.now()}`,
    object_story_spec: {
      page_id: PAGE_ID ?? "0",
      link_data: {
        message: "Probe: deterministic render parity check.",
        name: "Probe headline",
        description: "Probe description",
        link: "https://fb.me/",
        ...(imageHash ? { image_hash: imageHash } : {}),
        ...(withAssetFeed && imageHash && storyHash ? {
          asset_feed_spec: {
            images: [
              { hash: imageHash, adlabels: [{ name: "feed_image" }] },
              { hash: storyHash, adlabels: [{ name: "story_image" }] },
            ],
            ad_formats: ["SINGLE_IMAGE"],
            optimization_type: "PLACEMENT",
            asset_customization_rules: [
              {
                customization_spec: {
                  publisher_platforms: ["facebook", "instagram"],
                  facebook_positions: ["feed", "marketplace", "video_feeds", "search"],
                  instagram_positions: ["stream", "explore", "explore_home", "profile_feed", "ig_search"],
                },
                image_label: { name: "feed_image" },
                priority: 1,
              },
              {
                customization_spec: {
                  publisher_platforms: ["facebook", "instagram"],
                  facebook_positions: ["story"],
                  instagram_positions: ["story"],
                },
                image_label: { name: "story_image" },
                priority: 2,
              },
            ],
          },
        } : {}),
        ...(leadFormId ? { call_to_action: { type: "LEARN_MORE", value: { lead_gen_form_id: leadFormId } } } : {}),
      },
    },
    ...degreesOfFreedomSpec(),
  };
}

const PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "FACEBOOK_STORY_MOBILE",
  "INSTAGRAM_REELS",
  "RIGHT_COLUMN_STANDARD",
];

// ── run ─────────────────────────────────────────────────────────────────────

console.log(`meta-publish-probe: account=${AD_ACCOUNT} version=${VERSION} assetFeed=${ASSET_FEED} create=${CREATE}`);

let imageHash = null;
let storyHash = null;

// Upload two tiny PNGs so the creative spec has real account-scoped hashes.
const PNG_1PX_FEED = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_1PX_STORY = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const upload = await call(`/${AD_ACCOUNT}/adimages`, { bytes: PNG_1PX_FEED });
if (upload.ok) {
  imageHash = Object.values(upload.payload.images ?? {})[0]?.hash ?? null;
} else {
  console.error("  adimages (feed) failed:", upload.error?.message ?? upload.status);
}
if (ASSET_FEED) {
  const story = await call(`/${AD_ACCOUNT}/adimages`, { bytes: PNG_1PX_STORY });
  if (story.ok) {
    storyHash = Object.values(story.payload.images ?? {})[0]?.hash ?? null;
  } else {
    console.error("  adimages (story) failed:", story.error?.message ?? story.status);
  }
}

const leadFormId = CREATE && PAGE_ID
  ? (await call(`/${PAGE_ID}/leadgen_forms`, {
      name: "bw-probe-form",
      locale: "en_AU",
      privacy_policy: { url: "https://blockwise.sale/privacy", link_text: "Privacy Policy" },
      questions: [{ type: "FIRST_NAME", key: "first_name" }, { type: "EMAIL", key: "email" }],
      thank_you_page: { title: "Thanks", body: "Probe done.", button_type: "VIEW_WEBSITE", website_url: "https://blockwise.sale" },
    })).payload?.id ?? null
  : null;

let created = [];

async function previews(label, spec) {
  let okCount = 0;
  for (const format of PREVIEW_FORMATS) {
    const params = new URLSearchParams({ creative: JSON.stringify(spec), ad_format: format });
    const response = await fetch(`${graph(`/${AD_ACCOUNT}/generatepreviews`)}?${params}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const payload = (await response.json().catch(() => ({})));
    const ok = response.ok && Array.isArray(payload.data) && payload.data.length > 0 && payload.data[0].body;
    console.log(`  ${ok ? "✔" : "✖"} ${format} ${ok ? "" : (payload.error?.message ?? `status ${response.status}`)}`);
    if (ok) okCount += 1;
  }
  console.log(`  ${label}: ${okCount}/${PREVIEW_FORMATS.length} preview formats OK`);
  return okCount;
}

const baseSpec = creativeSpec({ withAssetFeed: false, imageHash, storyHash: null, leadFormId });
await previews("single-image lead-ad", baseSpec);

if (ASSET_FEED) {
  const combined = creativeSpec({ withAssetFeed: true, imageHash, storyHash, leadFormId });
  const okCombined = await previews("combined lead-ad + asset_feed_spec", combined);

  if (CREATE) {
    if (!okCombined) {
      console.error("meta-publish-probe: combined shape rejected by generatepreviews — NOT creating objects. Documented fallback: two creatives per ad set or feed-image-everywhere.");
      process.exit(1);
    }
    const campaign = await call(`/${AD_ACCOUNT}/campaigns`, {
      name: "bw-probe-combined",
      objective: "OUTCOME_LEADS",
      special_ad_categories: ["HOUSING"],
      special_ad_category_country: ["AU"],
      status: "PAUSED",
      daily_budget: 500,
    });
    if (!campaign.ok) {
      console.error("  campaign create failed:", campaign.error?.message);
      process.exit(1);
    }
    const campaignId = campaign.payload.id;
    const adSet = await call(`/${AD_ACCOUNT}/adsets`, {
      name: "bw-probe-combined",
      campaign_id: campaignId,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      destination_type: "ON_AD",
      promoted_object: { page_id: PAGE_ID },
      status: "PAUSED",
      daily_budget: 500,
      targeting: {
        geo_locations: { countries: ["AU"], location_types: ["home", "recent"] },
        publisher_platforms: ["facebook", "instagram"],
        facebook_positions: ["feed", "marketplace", "video_feeds", "search", "story"],
        instagram_positions: ["stream", "explore", "explore_home", "profile_feed", "ig_search", "story"],
      },
    });
    if (!adSet.ok) {
      console.error("  adset create failed:", adSet.error?.message);
      process.exit(1);
    }
    const adSetId = adSet.payload.id;
    const creative = await call(`/${AD_ACCOUNT}/adcreatives`, creativeSpec({ withAssetFeed: true, imageHash, storyHash, leadFormId }));
    if (!creative.ok) {
      console.error("  creative create failed:", creative.error?.message);
      process.exit(1);
    }
    const creativeId = creative.payload.id;
    const ad = await call(`/${AD_ACCOUNT}/ads`, {
      name: "bw-probe-combined",
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      status: "PAUSED",
    });
    if (!ad.ok) {
      console.error("  ad create failed:", ad.error?.message);
      process.exit(1);
    }
    created = [{ type: "ad", id: ad.payload.id }, { type: "adset", id: adSetId }, { type: "creative", id: creativeId }, { type: "campaign", id: campaignId }];
    console.log(`  ✔ PAUSED create chain OK: campaign=${campaignId} adset=${adSetId} creative=${creativeId} ad=${ad.payload.id}`);

    // Delete (PAUSED-only objects, newest first).
    for (const object of created) {
      const del = await call(`/${object.id}`, {}, "DELETE");
      console.log(`  delete ${object.type} ${object.id}: ${del.ok ? "ok" : del.error?.message ?? del.status}`);
    }
    console.log("meta-publish-probe: COMBINED SHAPE VERIFIED on the dev account. Safe to propose META_ASSET_FEED_ENABLED=true.");
  }
} else if (CREATE) {
  console.log("meta-publish-probe: --create only creates for the combined shape; set META_ASSET_FEED_ENABLED=true to probe it.");
}
