import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { extractBrandKitFromWebsite, generateAdStudioCampaignPack } from "../src/lib/adstudio/index.ts";

// Ad Studio reset contract guards:
// so the "template in → template out" flow cannot silently regress:
//   (a) Create returns custom composite tiles.
//   (b) the old template prep route fails closed.
//   (c) end users never see model/prompt controls.
//   (d) the generative route returns options and does not place creative layers.
//   (e) template photo-prep service code is not importable.

function approvedBrandKit() {
  const sampleHtml = `
    <html><head><title>Northstar Realty</title>
      <meta property="og:site_name" content="Northstar Realty">
      <style>:root { --brand: #087f7a; } body { font-family: Inter, sans-serif; color: #18201f; }</style>
    </head><body><img src="/logo.svg" alt="Northstar Realty logo"></body></html>`;
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_demo",
      websiteUrl: "https://northstar.example",
      marketCountry: "AU",
      htmlByUrl: { "https://northstar.example": sampleHtml },
    }),
    reviewStatus: "approved" as const,
  };
}

test("(a) Create returns custom composite tiles", () => {
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: approvedBrandKit(),
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    creativeFormats: ["4:5", "1:1", "9:16", "1.91:1"],
    variantCount: 3,
  });
  assert.ok(pack.creatives.length > 0);
  for (const creative of pack.creatives) {
    assert.equal(creative.source, "custom_composite", `creative ${creative.format} not tagged custom_composite`);
  }
});

test("(b) the template photo prep route fails closed", () => {
  const route = readFileSync("src/app/api/adstudio/template-photo-prep/route.ts", "utf8");
  assert.match(route, /status:\s*410/);
  assert.doesNotMatch(route, /preparePhotoAssetsForTemplate|loadCachedPhotoAssetsForTemplate|fallbackPhotoAssetsForTemplate/);
});

test("(c) the end-user settings panel exposes no model/prompt control", () => {
  const source = readFileSync("src/components/adstudio/panels/settings-panel.tsx", "utf8");
  for (const forbidden of [
    "ModelControlPanel",
    "PromptControlPanel",
    "model-control-config",
    "prompt-control-panel",
    "resolveRuntimeModelProfile",
    "prompt-registry",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `settings-panel must not reference ${forbidden}`);
  }
  assert.doesNotMatch(source, /\bmodel\b/i, "settings-panel must not mention models");
  assert.doesNotMatch(source, /\bprompt\b/i, "settings-panel must not mention prompts");
});

test("(d) the generative options route never composites — only the chokepoint places images", () => {
  const source = readFileSync("src/app/api/adstudio/generate-options/route.ts", "utf8");
  for (const forbidden of [
    "buildArchetypeCreative",
    "buildTemplateImageObjects",
    "compositionToCreative",
    "layout-archetypes",
    "composition-to-creative",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `generate-options must not composite (${forbidden})`);
  }
  // It returns image options (additive); it does not return placed creatives.
  assert.match(source, /options/);
});

test("(e) template photo-prep service code is not importable", () => {
  assert.equal(existsSync("src/lib/adstudio/" + "photo-prep-" + "service.ts"), false);
  assert.equal(existsSync("src/lib/adstudio/" + "template-photo-prep-" + "job.ts"), false);
  assert.equal(existsSync("src/lib/adstudio/" + "template-photo-prep-" + "queue.ts"), false);
});
