import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractBrandKitFromWebsite, generateAdStudioCampaignPack } from "../src/lib/adstudio/index.ts";
import { PROMPT_FALLBACKS } from "../src/lib/operator/prompts/prompt-registry.ts";

// Ad Studio overhaul contract guards (Phase 0). These lock the product contract
// so the "template in → template out" flow cannot silently regress:
//   (a) Create returns composite tiles tagged source = "template_composite".
//   (b) the framing prompt only prepares the photo — it never makes "an ad".
//   (c) end users never see model/prompt controls.
//   (d) only the composite chokepoint places images; the generative route swaps
//       a photo, it does not composite.
//   (e) the framing prompt is loaded from the operator registry, not a literal.

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

test("(a) Create returns composite tiles tagged source=template_composite", () => {
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
    assert.equal(creative.source, "template_composite", `creative ${creative.format} not tagged template_composite`);
  }
});

test("(b) the framing prompt prepares only the photo and never makes an ad", () => {
  const framing = PROMPT_FALLBACKS["adstudio.image.prepare_template_frame.v1"];
  assert.ok(framing, "framing prompt fallback must exist");
  assert.doesNotMatch(framing, /make an ad/i, "framing prompt must not ask the model to make an ad");
  assert.doesNotMatch(framing, /make a finished advertisement/i);
  assert.match(framing, /do not add text/i, "framing prompt must forbid rendered text");
  assert.match(framing, /do not add logos/i, "framing prompt must forbid logos");
  assert.match(framing, /return only the edited photo asset/i);
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

test("(e) the framing prompt is loaded from the registry, not a string literal", () => {
  const service = readFileSync("src/lib/adstudio/photo-prep-service.ts", "utf8");
  assert.match(service, /getActivePromptBundle/, "photo prep must load prompts from the registry");
  assert.match(service, /adstudio\.image\.prepare_template_frame\.v1/, "photo prep must reference the registry framing key");
  assert.doesNotMatch(
    service,
    /buildPreparePhotoForTemplateFramePrompt/,
    "photo prep must not assemble the framing prompt from the inline string literal",
  );
});
