import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const campaignsRoute = "src/app/api/adstudio/campaigns/route.ts";
const creditHelper = "src/lib/adstudio/generation-credits.ts";
const creditDomain = "src/lib/credits/workspace-credits.ts";
const trialBrandKitHelper = "src/lib/adstudio/trial-brand-kit.ts";
const persistence = "src/lib/adstudio/persistence.ts";
const adStudioPage = "src/app/(customer)/ad-studio/page.tsx";
const liveBundle = "src/lib/adstudio/load-live-bundle.ts";
const draftRoute = "src/app/api/adstudio/campaigns/[id]/draft/route.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("campaign generation route uses the shared render-credit reservation", () => {
  const source = read(campaignsRoute);

  assert.match(source, /@\/lib\/adstudio\/generation-credits/);
  assert.match(source, /reserveAdStudioGenerationCredits/);
  assert.match(source, /refundOutstandingWorkspaceCredits/);
  assert.match(source, /clientMutationId \?\? request\.headers\.get\("idempotency-key"\)/);
  assert.match(read("src/lib/adstudio/generate-template-campaign.ts"), /resolveAdStudioGenerationBrandKit/);
});

test("generation success response keeps the existing fields without a trial block", () => {
  const source = read(campaignsRoute);

  assert.match(source, /campaignPack:\s*liveResult\.data/);
  assert.match(source, /data:\s*liveResult\.data/);
  assert.match(source, /persistence:\s*liveResult\.persistence/);
  assert.doesNotMatch(source, /\btrial\s*:/);
});

test("real campaign generation route guards duplicate in-flight requests", () => {
  const source = read(campaignsRoute);

  assert.match(source, /const inFlightGenerations = new Map<string, number>\(\)/);
  assert.match(source, /generationDedupKey\(context\.access\.workspaceId,\s*body\)/);
  assert.match(source, /status:\s*409/);
  assert.match(source, /inFlightGenerations\.delete\(dedupKey\)/);
});

test("generation helper checks confirmed identity before the shared reserve RPC", () => {
  const source = read(creditHelper);
  const emailCheckIndex = source.indexOf("hasConfirmedEmail(user)");
  const reserveIndex = source.indexOf("await reserveWorkspaceCredits");

  assert.ok(emailCheckIndex > -1);
  assert.ok(reserveIndex > -1);
  assert.ok(emailCheckIndex < reserveIndex);
  assert.match(source, /credits:\s*2/);
  assert.match(source, /adstudio\.feed_story_pack/);
  assert.match(source, /status:\s*403/);
  assert.match(source, /WorkspaceCreditError/);
  assert.match(source, /status:\s*402/);
  assert.match(read(creditDomain), /reserve_workspace_credits/);
  assert.match(read(creditDomain), /settle_workspace_credit_reservation/);
  assert.match(read(creditDomain), /refund_workspace_credit_reservation/);
});

test("Feed and Story settle independently and Story failure refunds only its render", () => {
  const pipeline = read("src/lib/adstudio/generate-template-campaign.ts");
  const trigger = read("trigger/adstudio-generate.ts");

  assert.match(pipeline, /:settle:4x5/);
  assert.match(pipeline, /:settle:9x16/);
  assert.match(pipeline, /credits:\s*1[\s\S]*:refund:9x16/);
  assert.match(pipeline, /story_render_failed/);
  assert.match(trigger, /refundOutstandingWorkspaceCredits/);
});

test("campaign-pack persistence is transactional and surfaces errors", () => {
  const source = read(persistence);

  // One RPC writes the whole pack; any table failure rolls everything back.
  assert.match(source, /supabase\.rpc\("adstudio_persist_campaign_pack"/);
  assert.match(source, /error: result\.error \? \{ message: result\.error\.message \} : null/);
  // Demo kits still refuse to persist before any write happens.
  assert.match(source, /Demo brand kits cannot be used for saved campaigns\./);
});

test("first-session state stays empty and unpersisted until a sample is cloned", () => {
  const page = read(adStudioPage);
  const loader = read(liveBundle);

  assert.match(page, /createEmptyAdStudioCampaignPack/);
  assert.doesNotMatch(page, /persistAdStudioCampaignPack/);
  assert.doesNotMatch(page, /reserveAdStudioGenerationCredit/);
  assert.match(loader, /createEmptyAdStudioCampaignPack/);
  assert.doesNotMatch(loader, /persistAdStudioCampaignPack/);
});

test("draft route self-heals missing seeded campaigns instead of returning 404", () => {
  const source = read(draftRoute);

  assert.doesNotMatch(source, /Campaign not found\./);
  assert.match(source, /existingPack \? mergeCampaignPack\(existingPack,\s*submittedPack\) : submittedPack/);
  assert.match(source, /persistAdStudioCampaignPack\(access\.supabase,\s*campaignPack,\s*access\.access\.userId\)/);
});

test("trial brand kit fallback is only available for trial workspaces", () => {
  const source = read(trialBrandKitHelper);
  const nonTrialBranch = source.indexOf("if (!input.isTrialWorkspace)");
  const draftIndex = source.indexOf("const draftBrandKit = await loadDraftBrandKit");
  const fallbackIndex = source.indexOf("buildTrialFallbackBrandKit");

  assert.ok(nonTrialBranch > -1);
  assert.ok(draftIndex > -1);
  assert.ok(fallbackIndex > -1);
  assert.ok(nonTrialBranch < fallbackIndex);
  assert.ok(draftIndex < fallbackIndex);
  assert.match(source, /workspaceName/);
  assert.match(source, /region/);
});

test("fallback trial brand kit is approved and derived from workspace metadata", () => {
  const brandKit = buildTrialFallbackBrandKit({
    workspaceId: "workspace_trial",
    workspaceName: "  Northstar Realty   Perth  ",
    region: "WA",
  });

  assert.equal(brandKit.workspaceId, "workspace_trial");
  assert.equal(brandKit.identity.businessName, "Northstar Realty Perth");
  assert.equal(brandKit.identity.marketRegion, "WA");
  assert.equal(brandKit.reviewStatus, "approved");
  assert.ok(brandKit.lockedFields.includes("identity.businessName"));
});
