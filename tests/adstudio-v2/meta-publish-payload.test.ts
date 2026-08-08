// Payload snapshot tests for the v26 publish changes (Track D, plan §9.2).
//
// Four cases, asserted as the exact JSON the marketing_api adapter sends:
//   1. flag off (and story absent) → single-image link_data, NO asset_feed,
//      DOF spec present and all-OPT_OUT;
//   2. flag on + story render     → two /adimages uploads, asset_feed_spec
//      with two labelled images + two customization rules, ad set targeting
//      a superset of every rule position;
//   3. flag on, story absent      → falls back to the single-image path;
//   4. legacy CONTACT_US pack     → payload carries LEARN_MORE (remap at
//      build), never the undocumented enum.

import assert from "node:assert/strict";
import test from "node:test";

import { buildCloneTestPack } from "../adstudio-clone-fixture.ts";
import {
  buildMetaPublishPlan,
  createMetaExecutionAdapter,
  META_CREATIVE_FEATURE_KEYS,
  type MetaPublishControls,
  type MetaPublishPlan,
} from "../../src/lib/providers/meta-execution.ts";

const setup = {
  metaAdAccountId: "act_123",
  pageId: "page_123",
  instagramActorId: "ig_123",
  pixelId: "pixel_123",
  leadDestination: { type: "webhook", label: "CRM", config: { endpoint: "https://crm.example/leads" } },
  privacyPolicyUrl: "https://northstar.example/privacy",
  currency: "AUD",
  timezone: "Australia/Perth",
} as const;

const controls: MetaPublishControls = {
  dailyBudgetMinorUnits: 7500,
  geo: { type: "country", country: "AU" },
  placements: {
    publisherPlatforms: ["facebook", "instagram"],
    facebookPositions: ["feed"],
    instagramPositions: ["stream"],
  },
};

function buildPackWithLegacyCta() {
  const pack = buildCloneTestPack("workspace_demo");
  for (const copy of pack.copyPacks) {
    // Legacy packs stored CONTACT_US pre-Track-D; the build must remap it.
    (copy.meta as { cta: string }).cta = "CONTACT_US";
  }
  return pack;
}

function buildV2PublishPack() {
  const pack = buildCloneTestPack("workspace_demo");
  const base = pack.creatives[0];
  const renders = {
    feed: "workspace_demo/adstudio/renders/v2-feed.png",
    story: "workspace_demo/adstudio/renders/v2-story.png",
  };
  const instance = {
    schema: "adstudio.instance.v2" as const,
    templateId: "meta-publish-fixture",
    templateHash: "a".repeat(64),
    format: "4:5" as const,
    values: { images: {}, text: {} },
    overrides: [],
    renders,
  };
  pack.creatives = [
    { ...base, creativeId: "creative-v2-feed", format: "4:5", canvas: instance as never },
    { ...base, creativeId: "creative-v2-story", format: "9:16", canvas: { ...instance, format: "9:16" } as never },
  ];
  pack.campaign.templateSnapshot = {
    schema: "adstudio.template.v2",
    id: "meta-publish-fixture",
    templateHash: "a".repeat(64),
    publish: {
      cta: "DOWNLOAD",
      leadForm: {
        headline: "Snapshot lead form",
        questions: ["Which suburb are you considering?"],
        thankYou: { title: "Snapshot received", body: "We will call shortly." },
      },
      placements: {
        publisherPlatforms: ["instagram"],
        facebookPositions: [],
        instagramPositions: ["story"],
      },
      formatRouting: { feed: "4:5", story: "9:16" },
      creativeFeatures: {
        ...Object.fromEntries(META_CREATIVE_FEATURE_KEYS.map((key) => [key, "OPT_OUT"])),
        adapt_to_placement: "OPT_IN",
        image_touchups: "OPT_IN",
      },
    },
  };
  // v2 publish must use the immutable validated snapshot, not mutable pack
  // copy values that happen to be persisted beside it.
  pack.copyPacks[0].meta.cta = "LEARN_MORE";
  pack.copyPacks[0].meta.leadForm.headline = "Mutable lead form";
  return pack;
}

function inlineAsset(filename: string) {
  return { type: "image", source: "inline", mimeType: "image/png", filename, bytesBase64: "iVBORw0KGgo=" } as const;
}

type Captured = { url: string; body: Record<string, unknown> };

function capturingFetch(captured: Captured[], hashes: Record<string, string>) {
  let nextId = 1;
  return async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    captured.push({ url: String(url), body });

    const urlString = String(url);
    if (urlString.includes("/adimages")) {
      const filename = Object.keys(hashes)[0] ?? "img.png";
      const sent = typeof body.bytes === "string" ? "x" : "";
      void sent;
      // Return one hash per call, in order of insertion.
      const name = captured.filter((c) => c.url.includes("/adimages")).length === 1
        ? Object.keys(hashes)[0]
        : Object.keys(hashes)[1];
      return new Response(JSON.stringify({ images: { [name ?? filename]: { hash: hashes[name ?? filename] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: `meta_${nextId++}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function publishAndCapture(plan: MetaPublishPlan, hashes: Record<string, string>) {
  const captured: Captured[] = [];
  const result = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved" },
    { accessToken: "token", fetchImpl: capturingFetch(captured, hashes) },
  );
  assert.equal(result.status, "paused_live");
  return captured;
}

function creativeBodies(captured: Captured[]): Array<Record<string, unknown>> {
  return captured
    .filter((c) => c.url.includes("/adcreatives"))
    .map((c) => c.body);
}

test("v2 publish plan uses canonical feed/story renders and its publish snapshot", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildV2PublishPack(),
    connectionId: "connection_123",
    setup,
  });

  const creative = plan.creatives[0];
  assert.equal(creative.asset?.storagePath, "workspace_demo/adstudio/renders/v2-feed.png");
  assert.equal(creative.formatAssets?.feed?.storagePath, "workspace_demo/adstudio/renders/v2-feed.png");
  assert.equal(creative.formatAssets?.story?.storagePath, "workspace_demo/adstudio/renders/v2-story.png");
  assert.equal(creative.cta, "DOWNLOAD");
  assert.equal(plan.leadForms[0].headline, "Snapshot lead form");
  assert.deepEqual(plan.controls.placements, {
    publisherPlatforms: ["instagram"],
    facebookPositions: [],
    instagramPositions: ["story"],
  });
  assert.equal(plan.creativeFeatures?.adapt_to_placement, "OPT_IN");
  assert.equal(plan.creativeFeatures?.image_touchups, "OPT_IN");
});

test("v2 format routing can exclude a story asset without touching the feed render", () => {
  const pack = buildV2PublishPack();
  const snapshot = pack.campaign.templateSnapshot as { publish: { formatRouting: { story: "9:16" | null } } };
  snapshot.publish.formatRouting.story = null;

  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
  });

  assert.equal(plan.creatives[0].asset?.storagePath, "workspace_demo/adstudio/renders/v2-feed.png");
  assert.equal(plan.creatives[0].formatAssets?.feed?.storagePath, "workspace_demo/adstudio/renders/v2-feed.png");
  assert.equal(plan.creatives[0].formatAssets?.story, null);
});

test("v2 publishing fails closed when the immutable enhancement controls are incomplete", () => {
  const pack = buildV2PublishPack();
  const snapshot = pack.campaign.templateSnapshot as { publish: { creativeFeatures: Record<string, string> } };
  delete snapshot.publish.creativeFeatures.image_background_gen;

  assert.throws(
    () => buildMetaPublishPlan({ workspaceId: "workspace_demo", campaignPack: pack, connectionId: "connection_123", setup }),
    /invalid template publish snapshot/,
  );
});

test("v1 canvas publishing remains on its legacy image path", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildCloneTestPack("workspace_demo"),
    connectionId: "connection_123",
    setup,
  });

  assert.equal(plan.creatives[0].asset?.source, "inline");
  assert.equal(plan.creatives[0].asset?.bytesBase64, "ZmVlZA==");
  assert.equal(plan.creatives[0].formatAssets, null);
});

test("payload snapshot: flag off → single image, no asset_feed, all enhancements OPT_OUT", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPackWithLegacyCta(),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_d1",
  });
  assert.equal(plan.assetFeedEnabled, false);

  const captured = await publishAndCapture(plan, {});
  const bodies = creativeBodies(captured);
  assert.ok(bodies.length >= 1);

  const first = bodies[0];
  const linkData = (first.object_story_spec as { link_data: Record<string, unknown> }).link_data;
  assert.equal("asset_feed_spec" in linkData, false, "flag off must never send asset_feed_spec");

  // Legacy CONTACT_US remapped at payload-plan time.
  const cta = (linkData.call_to_action as { type: string }).type;
  assert.equal(cta, "LEARN_MORE", "CONTACT_US must remap to LEARN_MORE, never reach Meta");

  // DOF spec: every known key present, all OPT_OUT.
  const dof = first.degrees_of_freedom_spec as { creative_features_spec: Record<string, { enroll_status: string }> };
  for (const key of META_CREATIVE_FEATURE_KEYS) {
    assert.equal(dof.creative_features_spec[key]?.enroll_status, "OPT_OUT", `feature ${key}`);
  }
  // No adimages upload happened for stories (fixture feed clone images do
  // upload once per creative); no asset_feed, no second upload.
  assert.equal(captured.filter((c) => c.url.includes("/adimages")).length, plan.creatives.length);
});

test("payload snapshot: flag on + story render → asset_feed_spec with two rules, targeting superset", async () => {
  const pack = buildCloneTestPack("workspace_demo");
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_d2",
  });

  // Flag snapshot lives on the plan (build-time), not read at execution.
  plan.assetFeedEnabled = true;
  for (const creative of plan.creatives) {
    creative.formatAssets = { feed: inlineAsset("feed.png"), story: inlineAsset("story.png") };
  }

  // Ad set targeting must already cover every rule position from build time.
  // (Here we force the flag after build, so targeting union is asserted in the
  // build-time test below; execution only needs the payloads.)
  const captured = await publishAndCapture(plan, { "feed.png": "hash_feed", "story.png": "hash_story" });

  // Two image uploads per creative: feed + story.
  const uploads = captured.filter((c) => c.url.includes("/adimages"));
  assert.equal(uploads.length, plan.creatives.length * 2, "two /adimages uploads per creative when asset feed is on");

  const bodies = creativeBodies(captured);
  const first = bodies[0];
  const linkData = (first.object_story_spec as { link_data: Record<string, unknown> }).link_data;
  const feedSpec = linkData.asset_feed_spec as {
    images: Array<{ hash: string; adlabels: Array<{ name: string }> }>;
    ad_formats: string[];
    optimization_type: string;
    asset_customization_rules: Array<{ image_label: { name: string }; priority: number; customization_spec: Record<string, unknown> }>;
  };
  assert.deepEqual(feedSpec.images.map((i) => i.hash), ["hash_feed", "hash_story"]);
  assert.deepEqual(feedSpec.ad_formats, ["SINGLE_IMAGE"]);
  assert.equal(feedSpec.optimization_type, "PLACEMENT");
  assert.equal(feedSpec.asset_customization_rules.length, 2);
  assert.deepEqual(feedSpec.asset_customization_rules.map((r) => r.image_label.name), ["feed_image", "story_image"]);
  assert.deepEqual(feedSpec.asset_customization_rules.map((r) => r.priority), [1, 2]);

  // Feed rule covers the documented positions exactly.
  const feedRule = feedSpec.asset_customization_rules[0].customization_spec as {
    facebook_positions: string[];
    instagram_positions: string[];
  };
  assert.deepEqual(feedRule.facebook_positions, ["feed", "marketplace", "video_feeds", "search"]);
  assert.ok(feedRule.instagram_positions.includes("stream"));
});

test("plan build: flag on + story assets → assetFeedEnabled true and targeting unioned at build", () => {
  process.env.META_ASSET_FEED_ENABLED = "true";
  try {
    const pack = buildCloneTestPack("workspace_demo");
    // Give creatives canonical renders so buildFormatAssets picks them up.
    for (const creative of pack.creatives) {
      (creative.canvas as { renders?: Record<string, string> }).renders = {
        feed: `workspace_demo/adstudio/renders/${creative.creativeId}-feed.png`,
        story: `workspace_demo/adstudio/renders/${creative.creativeId}-story.png`,
      };
    }
    const plan = buildMetaPublishPlan({
      workspaceId: "workspace_demo",
      campaignPack: pack,
      connectionId: "connection_123",
      setup,
      controls,
      approvalRequestId: "approval_d3",
    });
    assert.equal(plan.assetFeedEnabled, true);
    assert.ok(plan.creatives.every((c) => c.formatAssets?.feed && c.formatAssets?.story));

    const targeting = plan.adSets[0].targeting as { facebook_positions: string[]; instagram_positions: string[] };
    // Superset of both rules' positions.
    for (const position of ["feed", "marketplace", "video_feeds", "search", "story"]) {
      assert.ok(targeting.facebook_positions.includes(position), `facebook_positions covers ${position}`);
    }
    for (const position of ["stream", "explore", "story"]) {
      assert.ok(targeting.instagram_positions.includes(position), `instagram_positions covers ${position}`);
    }
  } finally {
    delete process.env.META_ASSET_FEED_ENABLED;
  }
});

test("payload snapshot: flag on but story absent → falls back to single-image path", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildCloneTestPack("workspace_demo"),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_d4",
  });
  plan.assetFeedEnabled = true;
  for (const creative of plan.creatives) {
    creative.formatAssets = { feed: inlineAsset("feed.png"), story: null };
  }

  const captured = await publishAndCapture(plan, { "feed.png": "hash_feed" });
  const bodies = creativeBodies(captured);
  const linkData = (bodies[0].object_story_spec as { link_data: Record<string, unknown> }).link_data;
  assert.equal("asset_feed_spec" in linkData, false, "no story render → no asset_feed_spec");
  assert.equal(captured.filter((c) => c.url.includes("/adimages")).length, plan.creatives.length);
});

test("unknown Advantage+ feature keys from the template are dropped, not fatal", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildCloneTestPack("workspace_demo"),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_d5",
  });
  plan.creativeFeatures = { image_touchups: "OPT_IN", retired_meta_key_xyz: "OPT_IN" };

  const captured = await publishAndCapture(plan, {});
  const first = creativeBodies(captured)[0];
  const dof = first.degrees_of_freedom_spec as { creative_features_spec: Record<string, { enroll_status: string }> };
  assert.equal(dof.creative_features_spec.image_touchups?.enroll_status, "OPT_IN", "declared opt-in survives");
  assert.equal("retired_meta_key_xyz" in dof.creative_features_spec, false, "unknown key dropped");
});
