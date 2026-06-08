import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const campaignsRoute = "src/app/api/adstudio/campaigns/route.ts";
const regenerateRoute = "src/app/api/adstudio/campaigns/[id]/generate/route.ts";
const trialHelper = "src/lib/adstudio/generation-trial.ts";
const trialBrandKitHelper = "src/lib/adstudio/trial-brand-kit.ts";
const persistence = "src/lib/adstudio/persistence.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("campaign generation routes use the trial reservation helper", () => {
  for (const path of [campaignsRoute, regenerateRoute]) {
    const source = read(path);

    assert.match(source, /@\/lib\/adstudio\/generation-trial/);
    assert.match(source, /reserveAdStudioGenerationCredit/);
    assert.match(source, /refundReservedTrialCredit/);
    assert.match(source, /resolveAdStudioGenerationBrandKit/);
  }
});

test("generation success responses keep the existing fields without a trial block", () => {
  for (const path of [campaignsRoute, regenerateRoute]) {
    const source = read(path);

    assert.match(source, /campaignPack:\s*liveResult\.data/);
    assert.match(source, /data:\s*liveResult\.data/);
    assert.match(source, /persistence:\s*liveResult\.persistence/);
    assert.doesNotMatch(source, /\btrial\s*:/);
  }
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

test("trial brand kit fallback is only available for trial workspaces", () => {
  const source = read(trialBrandKitHelper);
  const nonTrialBranch = source.indexOf("if (!input.isTrialWorkspace)");
  const fallbackIndex = source.indexOf("buildTrialFallbackBrandKit");

  assert.ok(nonTrialBranch > -1);
  assert.ok(fallbackIndex > -1);
  assert.ok(nonTrialBranch < fallbackIndex);
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
