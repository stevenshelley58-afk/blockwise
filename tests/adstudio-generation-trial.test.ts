import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAdStudioFallbackBrandKit,
  resolveAdStudioGenerationBrandKit,
} from "../src/lib/adstudio/trial-brand-kit.ts";

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

test("generation enqueue response returns the durable job without a trial block", () => {
  const source = read(campaignsRoute);

  assert.match(source, /NextResponse\.json\(\{ jobId: creativeJobId \}, \{ status: 202 \}\)/);
  assert.doesNotMatch(source, /campaignPack:\s*liveResult\.data/);
  assert.doesNotMatch(source, /\btrial\s*:/);
});

test("real campaign generation route guards duplicate in-flight requests", () => {
  const source = read(campaignsRoute);

  assert.match(source, /const inFlightGenerations = new Map<string, number>\(\)/);
  assert.match(source, /generationRequestFingerprint\(body\)/);
  assert.match(source, /generationDedupKey\(context\.access\.workspaceId,\s*body\)/);
  assert.match(source, /clientMutationId.*dedupKey/s);
  assert.match(source, /adstudio-generation:\$\{workspaceId\}:\$\{clientMutationId\}:\$\{dedupKey\}/);
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
  const worker = read("worker/index.ts");

  assert.match(pipeline, /:settle:4x5/);
  assert.match(pipeline, /:settle:9x16/);
  assert.match(pipeline, /credits:\s*1[\s\S]*:refund:9x16/);
  assert.match(pipeline, /story_render_failed/);
  assert.match(worker, /refundOutstandingWorkspaceCredits/);
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

test("brand kit fallback is available to every workspace and stays advisory", () => {
  const source = read(trialBrandKitHelper);
  const draftIndex = source.indexOf("const draftBrandKit = await loadDraftBrandKit");
  const fallbackIndex = source.indexOf("buildAdStudioFallbackBrandKit");

  assert.ok(draftIndex > -1);
  assert.ok(fallbackIndex > -1);
  assert.ok(draftIndex < fallbackIndex);
  assert.doesNotMatch(source, /Approved brandKit is required/);
  assert.doesNotMatch(source, /if \(!input\.isTrialWorkspace\)/);
  assert.match(source, /workspaceName/);
  assert.match(source, /region/);
});

test("fallback brand kit is a warning-state draft derived from workspace metadata", () => {
  const brandKit = buildAdStudioFallbackBrandKit({
    workspaceId: "workspace_trial",
    workspaceName: "  Northstar Realty   Perth  ",
    region: "WA",
  });

  assert.equal(brandKit.workspaceId, "workspace_trial");
  assert.equal(brandKit.identity.businessName, "Northstar Realty Perth");
  assert.equal(brandKit.identity.marketRegion, "WA");
  assert.equal(brandKit.reviewStatus, "pending_user_review");
  assert.deepEqual(brandKit.lockedFields, ["starter_brand"]);
});

test("generation persists and uses a warning-state fallback when no Brand Pack exists", async () => {
  const writes: Record<string, unknown>[] = [];
  const supabase = {
    from() {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        neq() {
          return query;
        },
        order() {
          return query;
        },
        async limit() {
          return { data: [], error: null };
        },
        async upsert(row: Record<string, unknown>) {
          writes.push(row);
          return { data: [row], error: null };
        },
      };
      return query;
    },
  };

  const result = await resolveAdStudioGenerationBrandKit({
    supabase: supabase as never,
    workspaceId: "workspace_without_brand",
    workspaceName: "No Brand Yet",
    region: "WA",
    userId: "user_123",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.brandKit.reviewStatus, "pending_user_review");
  assert.equal(result.brandKit.identity.businessName, "No Brand Yet");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.review_status, "pending_user_review");
});
