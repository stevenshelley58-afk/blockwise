import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
} from "../src/lib/adstudio/index.ts";
import {
  applyBrandAssetRows,
  mediaUrlForStoragePath,
} from "../src/lib/adstudio/assets.ts";
import { cloneCampaignPack } from "../src/lib/adstudio/campaign-clone.ts";
import { mergeDraftResponsePack } from "../src/lib/adstudio/client-pack.ts";
import { normalizeAndValidateExtractionUrl } from "../src/lib/adstudio/extraction-url.ts";
import { dataUrlToUploadBytes } from "../src/lib/adstudio/generated-media.ts";
import { buildReadinessItems } from "../src/lib/adstudio/readiness.ts";
import { renderCreativeSvg } from "../src/lib/adstudio/creative-svg.ts";

const html = `
  <html>
    <head>
      <title>Realty Plus</title>
      <meta property="og:site_name" content="Realty Plus">
      <link rel="icon" href="/favicon.ico">
      <style>body{font-family:Inter,sans-serif}.btn{background:#123E75}</style>
    </head>
    <body>
      <img src="/logo.svg" alt="Realty Plus logo">
      <img src="/listing.jpg" alt="Scarborough listing">
      <a href="tel:0891234567">(08) 9123 4567</a>
      <p>Information is general only. Speak with a licensed local agent.</p>
    </body>
  </html>
`;

function approvedKit() {
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_real",
      websiteUrl: "https://realtyplus.example.com",
      marketCountry: "AU",
      htmlByUrl: { "https://realtyplus.example.com": html },
    }),
    reviewStatus: "approved" as const,
  };
}

function pack() {
  return generateAdStudioCampaignPack({
    workspaceId: "workspace_real",
    brandKit: approvedKit(),
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 3,
    sourceImageDataUrl: "/api/adstudio/media?path=workspace_real%2Fadstudio%2Fkit%2Flisting.jpg",
  });
}

test("mergeDraftResponsePack keeps local creatives when the draft response is compacted", () => {
  const current = pack();
  const selectedVariantId = current.variants[0]?.variantId;
  assert.ok(selectedVariantId);
  const compactResponse = {
    ...current,
    creatives: current.creatives.filter((creative) => creative.variantId === selectedVariantId),
  };

  const merged = mergeDraftResponsePack(current, compactResponse);

  assert.equal(merged.creatives.length, current.creatives.length);
  assert.deepEqual(
    new Set(merged.creatives.map((creative) => creative.creativeId)),
    new Set(current.creatives.map((creative) => creative.creativeId)),
  );
});

test("applyBrandAssetRows maps workspace asset rows into brand kit assets and logo URLs", () => {
  const kit = approvedKit();
  const withAssets = applyBrandAssetRows(kit, [
    {
      asset_type: "logo",
      storage_path: "workspace_real/brand/kit/logo.svg",
      source_url: null,
    },
    {
      asset_type: "listing_image",
      storage_path: "workspace_real/adstudio/kit/listing.jpg",
      source_url: null,
    },
    {
      asset_type: "headshot",
      storage_path: null,
      source_url: "https://cdn.example.com/agent.jpg",
    },
  ]);

  assert.equal(withAssets.logos.primaryLogoUrl, "/api/adstudio/media?path=workspace_real%2Fbrand%2Fkit%2Flogo.svg");
  assert.ok(withAssets.assets.listingImages.includes("/api/adstudio/media?path=workspace_real%2Fadstudio%2Fkit%2Flisting.jpg"));
  assert.deepEqual(withAssets.assets.headshots, ["https://cdn.example.com/agent.jpg"]);
});

test("mediaUrlForStoragePath rejects paths outside the active workspace", () => {
  assert.equal(
    mediaUrlForStoragePath("workspace_real", "workspace_real/adstudio/kit/listing.jpg"),
    "/api/adstudio/media?path=workspace_real%2Fadstudio%2Fkit%2Flisting.jpg",
  );
  assert.equal(mediaUrlForStoragePath("workspace_real", "other/adstudio/kit/listing.jpg"), null);
  assert.equal(mediaUrlForStoragePath("workspace_real", "workspace_real/../secret.jpg"), null);
});

test("buildReadinessItems does not mark needs-review compliance as done and maps CTA labels to Meta enums", () => {
  const current = pack();
  const items = buildReadinessItems({
    campaignGoal: "Generate vendor leads",
    offerLabel: "Seller checklist",
    market: "Scarborough, WA",
    propertyType: "Houses",
    destinationUrl: "https://realtyplus.example.com/checklist",
    primaryImage: "/api/adstudio/media?path=workspace_real%2Fadstudio%2Fkit%2Flisting.jpg",
    copy: {
      primaryText: "Thinking about selling in Scarborough?",
      headline: "What is your home worth?",
      description: "Free appraisal. No pressure.",
      cta: "Learn more",
    },
    pack: {
      ...current,
      compliance: { ...current.compliance, status: "needs_review" },
    },
  });

  assert.equal(items.find((item) => item.label === "Call to action")?.state, "done");
  assert.equal(items.find((item) => item.label === "Compliance")?.state, "warn");
});

test("normalizeAndValidateExtractionUrl rejects local, private, non-http, and demo URLs", () => {
  assert.equal(normalizeAndValidateExtractionUrl("realtyplus.com.au").ok, true);
  for (const value of ["ftp://realtyplus.com.au", "localhost:3000", "127.0.0.1", "10.0.0.5", "northstar.example"]) {
    const result = normalizeAndValidateExtractionUrl(value);
    assert.equal(result.ok, false, value);
  }
});

test("dataUrlToUploadBytes decodes generated image payloads for storage upload", () => {
  const decoded = dataUrlToUploadBytes("data:image/png;base64,SGVsbG8=");

  assert.equal(decoded.contentType, "image/png");
  assert.equal(new TextDecoder().decode(decoded.bytes), "Hello");
});

test("cloneCampaignPack creates a persisted duplicate shape without reusing child ids", () => {
  const original = pack();
  const cloned = cloneCampaignPack(original, {
    campaignId: "campaign_clone",
    now: "2026-06-08T00:00:00.000Z",
  });

  assert.equal(cloned.campaign.campaignId, "campaign_clone");
  assert.equal(cloned.campaign.name, `${original.campaign.name} copy`);
  assert.notEqual(cloned.variants[0]?.variantId, original.variants[0]?.variantId);
  assert.notEqual(cloned.creatives[0]?.creativeId, original.creatives[0]?.creativeId);
  assert.equal(cloned.creatives[0]?.campaignId, "campaign_clone");
  assert.equal(cloned.copyPacks[0]?.campaignId, "campaign_clone");
});

test("renderCreativeSvg renders the real logo image or brand name, not a BRAND placeholder", () => {
  const current = pack();
  const creative = current.creatives[0];
  assert.ok(creative);

  const svg = renderCreativeSvg(creative, current.brandKit);

  assert.match(svg, /<image[^>]+href=/);
  assert.doesNotMatch(svg, />BRAND</);
});

test("campaign creation uses shared copy enrichment without changing copy route response shape", () => {
  const copyRoute = readFileSync("src/app/api/adstudio/copy/route.ts", "utf8");
  const createRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const enrichment = readFileSync("src/lib/adstudio/campaign-copy-enrichment.ts", "utf8");

  assert.match(copyRoute, /generateAdStudioCopy/);
  assert.match(copyRoute, /NextResponse\.json\(result\)/);
  assert.match(createRoute, /runTemplateCampaignGeneration/);
  for (const term of [
    "loadCachedPhotoAssets" + "ForTemplate",
    "fallbackPhotoAssets" + "ForTemplate",
    "queueAdStudioTemplate" + "PhotoPrep",
    "preparePhotoAssets" + "ForTemplate",
    "preparedPhotoUrls" + "ByFormat",
  ]) {
    assert.equal(createRoute.includes(term), false, `campaign route must not contain ${term}`);
  }
  assert.doesNotMatch(createRoute, /\/api\/adstudio\/repair-image|\/api\/adstudio\/generate-image/);
  // A0: variants enrich in parallel; zero-success still surfaces a real failure
  // instead of silently shipping the unwritten template copy.
  assert.match(enrichment, /Promise\.allSettled/);
  assert.match(enrichment, /let firstError: unknown = null/);
  assert.match(enrichment, /if \(firstError\) throw firstError/);
  assert.match(enrichment, /return input\.pack/);
});

test("publish readiness hides internal provider-write env wording from customer labels", () => {
  const source = readFileSync("src/app/api/adstudio/publish-readiness/route.ts", "utf8");
  const labelBlock = source.slice(source.indexOf('id: "provider_writes"'), source.indexOf("automatic: true", source.indexOf('id: "provider_writes"')));

  assert.match(labelBlock, /Live publishing is in final platform review/);
  assert.match(source, /blocked: !writesEnabled/);
  assert.doesNotMatch(labelBlock, /BLOCKWISE_ENABLE_PROVIDER_WRITES/);
});

test("publish flow reports real Meta plan progress without fake queued statuses", () => {
  const panel = readFileSync("src/components/adstudio/panels/publish-panel.tsx", "utf8");
  const publishRoute = readFileSync("src/app/api/adstudio/export-packages/[id]/publish/route.ts", "utf8");
  const statusRoute = readFileSync("src/app/api/integrations/meta/publish-plans/[id]/route.ts", "utf8");
  const connections = readFileSync("src/lib/providers/provider-connections.ts", "utf8");

  assert.match(connections, /\.order\("updated_at", \{ ascending: false \}\)/);
  assert.match(publishRoute, /connection\.status === "connected" \|\| connection\.status === "needs_attention"/);
  assert.doesNotMatch(panel, /body\.status === "published"|body\.status === "queued"/);
  assert.match(panel, /\/api\/integrations\/meta\/publish-plans\/\$\{encodeURIComponent\(planId\)\}/);
  assert.match(panel, /Submitted for review - your campaign will be queued once approved/);
  assert.match(panel, /Queued - creating your paused Meta campaign/);
  assert.match(statusRoute, /requireWorkspaceAccess/);
  assert.match(statusRoute, /loadMetaPublishPlan/);
  assert.match(statusRoute, /reconciledObjects/);
});

test("production repair script is dry-run first and repairs by campaign variant instead of assuming Story creatives", () => {
  const source = readFileSync("scripts/adstudio-repair-production-data.mjs", "utf8");

  assert.match(source, /process\.argv\.includes\("--execute"\)/);
  assert.match(source, /Dry run only/);
  assert.match(source, /variant_id/);
  assert.doesNotMatch(source, /format === "9:16"/);
});

test("campaign and brand-kit PATCH routes keep explicit allowlists", () => {
  const brandKitRoute = readFileSync("src/app/api/adstudio/brand-kits/[id]/route.ts", "utf8");
  const campaignRoute = readFileSync("src/app/api/adstudio/campaigns/[id]/route.ts", "utf8");

  assert.match(brandKitRoute, /function brandKitPatch/);
  assert.match(brandKitRoute, /const allowed = \[/);
  assert.match(brandKitRoute, /logos_json/);
  assert.doesNotMatch(brandKitRoute, /Object\.fromEntries\(Object\.entries\(body\)/);
  assert.match(campaignRoute, /function campaignPatch/);
  assert.match(campaignRoute, /const allowed = \[/);
  assert.match(campaignRoute, /status/);
  assert.doesNotMatch(campaignRoute, /Object\.fromEntries\(Object\.entries\(body\)/);
});

test("fresh brand workspaces do not fall back to Northstar demo branding", () => {
  const brandPage = readFileSync("src/app/(customer)/ad-studio/brand/page.tsx", "utf8");
  const brandStudio = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");
  const useBrandKit = readFileSync("src/components/adstudio/use-brand-kit.ts", "utf8");
  const preview = readFileSync("src/components/adstudio/preview.tsx", "utf8");
  const brandKitRoute = readFileSync("src/app/api/adstudio/brand-kits/[id]/route.ts", "utf8");

  assert.doesNotMatch(brandPage, /getAdStudioDemoBundle/);
  assert.match(brandPage, /liveBundle\?\.brandKit \?\? draftBrandKit/);
  assert.match(brandStudio, /brandKit: AdStudioBrandKit \| null/);
  assert.match(brandStudio, /Scan your website/);
  assert.doesNotMatch(useBrandKit, /Northstar Realty|northstarrealty\.com\.au|Northstar Agent/);
  assert.match(useBrandKit, /"Your agency"/);
  assert.match(preview, /domain \? <small>\{domain\}<\/small> : null/);
  assert.match(brandKitRoute, /if \(!data\) return NextResponse\.json\(\{ error: "Brand kit not found\." \}, \{ status: 404 \}\)/);
});

test("dead Ad Studio stub endpoints stay deleted", () => {
  for (const path of [
    "src/app/api/adstudio/bulk-generate/route.ts",
    "src/app/api/adstudio/campaigns/[id]/generate/route.ts",
    "src/app/api/adstudio/campaigns/[id]/regenerate/route.ts",
    "src/app/api/adstudio/campaigns/[id]/variants/route.ts",
    "src/app/api/adstudio/compliance/check/route.ts",
    "src/app/api/adstudio/compliance/fix/route.ts",
    "src/app/api/adstudio/compliance/reports/[id]/route.ts",
    "src/app/api/adstudio/creatives/route.ts",
    "src/app/api/adstudio/creatives/[id]/route.ts",
    "src/app/api/adstudio/variants/[id]/score/route.ts",
    "src/app/api/adstudio/creatives/[id]/export/route.ts",
    "src/app/api/adstudio/creatives/[id]/regenerate-background/route.ts",
    "src/app/api/adstudio/export-packages/[id]/route.ts",
    "src/app/api/adstudio/export-packages/route.ts",
    "src/app/api/adstudio/jobs/route.ts",
    "src/app/api/adstudio/provider-runs/route.ts",
    "src/app/api/adstudio/variants/[id]/route.ts",
    "src/app/api/adstudio/variants/[id]/approve/route.ts",
    "src/app/api/adstudio/brand-kits/route.ts",
    "src/app/api/adstudio/brand-kits/[id]/rescan/route.ts",
    "src/app/api/adstudio/creatives/[id]/render/route.ts",
    "src/app/api/adstudio/bulk-drafts/route.ts",
    "src/app/api/adstudio/repair-image/route.ts",
    "src/app/api/adstudio/generate-image/route.ts",
    "src/lib/adstudio/image-repair.ts",
    "src/lib/adstudio/layout-brief.ts",
    "src/lib/adstudio/skeleton-to-prompt.ts",
  ]) {
    assert.equal(existsSync(path), false, path);
  }

  const useBrandKit = readFileSync("src/components/adstudio/use-brand-kit.ts", "utf8");
  assert.doesNotMatch(useBrandKit, /rescanKit|\/rescan/);
});

test("Ad Radar remains research-only and cannot bypass the sample clone path", () => {
  const actions = readFileSync("src/components/research/ad-card-actions.tsx", "utf8");
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  const types = readFileSync("src/lib/adstudio/types.ts", "utf8");

  assert.doesNotMatch(actions, /send-to-adstudio|newAd=radar|Use in Ad Studio|Opening Ad Studio/);
  assert.equal(existsSync("src/app/api/research/swipe-file/[id]/send-to-adstudio/route.ts"), false);
  assert.match(workbench, /openSamplePicker/);
  assert.match(workbench, /searchParams\.get\("template"\)/);
  assert.match(workbench, /linkedSamplePromptedRef/);
  assert.match(workbench, /openSamplePicker\(linkedTemplate\.id\)/);
  assert.match(workbench, /<NewAdDialog/);
  const firstAdInput = types.slice(types.indexOf("export type FirstAdInput"), types.indexOf("export type AdStudioBrandKit"));
  assert.match(firstAdInput, /source: "gallery"/);
  assert.doesNotMatch(firstAdInput, /"ad_radar"|"saved_ad"|savedAdId|referenceCta|referenceAdType|referenceIntent/);
  assert.match(firstAdInput, /templateId: string/);
});

test("New Ad generation progress cannot reset the completed template form", () => {
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");

  assert.match(workbench, /const mediaAssets = useMemo\(/);
  assert.match(dialog, /const latestMediaAssetsRef = useRef\(mediaAssets\)/);
  assert.match(dialog, /setDialogMediaAssets\(dedupeImageLibraryAssets\(latestMediaAssetsRef\.current\)\)/);
  assert.doesNotMatch(dialog, /\}, \[open, initialTemplateId, mediaAssets\]\);/);
  assert.match(dialog, /aria-busy=\{submitting\}/);
  assert.match(dialog, /Creating your ad\. This can take a few minutes\./);
  assert.match(dialog, /setError\(caught instanceof Error \? caught\.message : "Could not generate the ad\."\)/);
});

test("draft compaction deduplicates only the same image source, not feed and story clones", () => {
  const source = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  assert.match(source, /keptByVariantAndSource/);
  assert.match(source, /`\$\{creative\.variantId\}:\$\{imageSource\}`/);
  assert.doesNotMatch(source, /assetId:\s*undefined/);
});

test("Ad Studio uses one local sample gallery and one clone request", () => {
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  const templates = readFileSync("src/lib/adstudio/templates.ts", "utf8");
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const createRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const generator = readFileSync("src/lib/adstudio/generator.ts", "utf8");

  assert.match(workbench, /builtInAdStudioTemplates/);
  assert.match(templates, /RAW_ADSTUDIO_GALLERY_TEMPLATES\.map\(validateGalleryTemplate\)/);
  assert.match(templates, /sample: AdStudioTemplateSample/);
  assert.match(templates, /inputs:/);
  assert.doesNotMatch(templates, /^\s*(canvas|fabricJson|templateKey|promptHint)[?:]/m);
  assert.match(templates, /RESOLVABLE_AD_STUDIO_TEMPLATES[\s\S]*status === "approved"/);
  assert.match(templates, /resolveAdStudioTemplate[\s\S]*template\.id === templateId/);
  assert.match(dialog, /templateId: selectedTemplate\.id/);
  assert.doesNotMatch(dialog, /mode: "template"|template_library|templateKey/);
  assert.match(createRoute, /runTemplateCampaignGeneration/);
  assert.doesNotMatch(createRoute, /generateAdStudioCampaignPack\(\{/);
  assert.doesNotMatch(generator, /resolvedTemplate\?: AdStudioTemplate \| null/);
  assert.match(generator, /function resolveTemplateForGeneration/);
  assert.match(generator, /Selected template was not found\./);
  assert.match(generator, /templateSnapshot/);
  assert.doesNotMatch(generator, /input\.firstAd\?\.source === "ad_radar"/);
  assert.match(generator, /must be cloned before it can be opened or edited/);
});

test("Ad Radar longest-running sort reaches the authenticated search route", () => {
  const panel = readFileSync("src/components/research/ad-radar-search-panel.tsx", "utf8");
  const route = readFileSync("src/app/api/research/ads/search/route.ts", "utf8");
  const search = readFileSync("src/lib/research/ad-radar-card-search.ts", "utf8");

  assert.match(panel, /if \(activeSort !== "recent"\) params\.set\("sort", activeSort\)/);
  assert.match(panel, /doSearch\(initialQuery, initialSort, initialIncludeSurrounding\)/);
  assert.match(route, /searchParams\.get\("sort"\) === "longest"/);
  assert.match(route, /searchCustomerMetaAdLibraryCards/);
  assert.match(search, /ad_delivery_started_at/);
  assert.match(search, /adRunningMs/);
});

test("every new ad starts from a sample", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");

  // No blank affordance and no isBlank branching anywhere in the dialog.
  assert.equal(dialog.includes("Start blank"), false, "dialog must not offer Start blank");
  assert.equal(dialog.includes("isBlank"), false, "dialog must not branch on isBlank");
  assert.equal(dialog.includes('chooseTemplate("")'), false, "dialog must not select an empty template id");
  assert.doesNotMatch(dialog, /mode: "custom"|mode: "template"|templateKey/);
  assert.match(dialog, /templateId: selectedTemplate\.id/);
  assert.match(dialog, /source: "gallery"/);
  assert.doesNotMatch(dialog, /templateForRadarAd|chooseRadar|chooseReuse|Previous|Ad Radar/);
  const createRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  assert.match(createRoute, /if \(!firstAd\.templateId\?\.trim\(\)\)/);
  assert.doesNotMatch(createRoute, /firstAd\.mode|templateKey/);
});

test("generation uses only the supported Story and Feed formats", () => {
  const generator = readFileSync("src/lib/adstudio/generator.ts", "utf8");
  const preview = readFileSync("src/components/adstudio/preview.tsx", "utf8");
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");

  assert.match(generator, /const FALLBACK_FORMATS: AdStudioFormat\[\] = \["4:5", "9:16"\];/);
  assert.match(preview, /export type PreviewFormat = "story" \| "feed";/);
  assert.doesNotMatch(workbench, /landscape: "1\.91:1"/);
  assert.doesNotMatch(workbench, /square: "1:1"/);
});
