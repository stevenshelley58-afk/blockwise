import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const campaignsRoute = "src/app/api/adstudio/campaigns/route.ts";
const trialHelper = "src/lib/adstudio/generation-trial.ts";
const trialBrandKitHelper = "src/lib/adstudio/trial-brand-kit.ts";
const persistence = "src/lib/adstudio/persistence.ts";
const adStudioPage = "src/app/(customer)/ad-studio/page.tsx";
const liveBundle = "src/lib/adstudio/load-live-bundle.ts";
const draftRoute = "src/app/api/adstudio/campaigns/[id]/draft/route.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("campaign generation route uses the trial reservation helper", () => {
  const source = read(campaignsRoute);

  assert.match(source, /@\/lib\/adstudio\/generation-trial/);
  assert.match(source, /reserveAdStudioGenerationCredit/);
  assert.match(source, /refundReservedTrialCredit/);
  assert.match(source, /resolveAdStudioGenerationBrandKit/);
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

test("trial helper checks confirmed email only for trial workspaces before the reserve RPC", () => {
  const source = read(trialHelper);
  const planCheckIndex = source.indexOf("loadWorkspacePlanKey");
  const emailCheckIndex = source.indexOf("hasConfirmedEmail(user)");
  const reserveIndex = source.indexOf("reserve_trial_ad_pack_credit");

  assert.ok(planCheckIndex > -1);
  assert.ok(emailCheckIndex > -1);
  assert.ok(reserveIndex > -1);
  assert.ok(planCheckIndex < emailCheckIndex);
  assert.ok(emailCheckIndex < reserveIndex);
  assert.match(source, /workspacePlan\.planKey !== "trial"/);
  assert.match(source, /reason:\s*"not_trial"/);
  assert.match(source, /select\("workspace_plans\(key\)"\)/);
  assert.match(source, /status:\s*403/);
  assert.match(source, /trial_expired/);
  assert.match(source, /credit_limit_reached/);
  assert.match(source, /status:\s*trialCreditErrorStatus\(reason\)/);
  assert.match(source, /refund_trial_ad_pack_credit/);
});

test("campaign-pack persistence returns brand-kit persistence errors", () => {
  const source = read(persistence);

  assert.match(source, /const brandKitResult = await persistAdStudioBrandKit/);
  assert.match(source, /if \(brandKitResult\.error\) \{\s*return brandKitResult;\s*\}/);
});

test("first-session seeded campaign packs are persisted without reserving trial credits", () => {
  const page = read(adStudioPage);
  const loader = read(liveBundle);

  assert.match(page, /persistAdStudioCampaignPack/);
  assert.match(page, /buildStarterBundle\(\{[\s\S]*userId:\s*access\.userId/);
  assert.match(page, /await persistAdStudioCampaignPack\(input\.supabase,\s*campaignPack,\s*input\.userId\)/);
  assert.match(page, /buildDraftBrandBundle\(supabase,\s*access\.workspaceId,\s*access\.userId\)/);
  assert.match(page, /await persistAdStudioCampaignPack\(supabase,\s*campaignPack,\s*userId\)/);
  assert.doesNotMatch(page, /reserveAdStudioGenerationCredit/);
  assert.match(loader, /persistAdStudioCampaignPack/);
  assert.match(loader, /userId\?:\s*string/);
  assert.match(loader, /await persistAdStudioCampaignPack\(supabase,\s*campaignPack,\s*userId\)/);
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
