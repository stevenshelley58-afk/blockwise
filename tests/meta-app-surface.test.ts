import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approval workflow stays contextual instead of exposing a standalone section", () => {
  const sidebar = readFileSync("src/components/sidebar-nav.tsx", "utf8");
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
  const mobileNav = readFileSync("src/components/app/mobile-bottom-nav.tsx", "utf8");
  // The approval call lives in the inline ad/campaign controls. It used to be
  // asserted against CampaignsManagement.tsx, which was deleted as dead code
  // (zero importers); AdManagementControls is the live owner.
  const campaignControls = readFileSync("src/components/monitor/AdManagementControls.tsx", "utf8");
  const approvalRoute = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");

  assert.doesNotMatch(sidebar, /\/approvals|Approvals|ClipboardCheck/);
  assert.doesNotMatch(appShell, /showApprovals/);
  assert.doesNotMatch(mobileNav, /\/approvals|showApprovals/);
  assert.match(campaignControls, /\/api\/approvals\/\$\{approvalId\}/);
  assert.match(approvalRoute, /PATCH/);
  assert.match(approvalRoute, /approved|rejected/);
});

test("publish review state skips approval and submits directly", () => {
  const readinessRoute = readFileSync("src/app/api/adstudio/publish-readiness/route.ts", "utf8");
  const panel = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");

  assert.doesNotMatch(readinessRoute, /approval_ready/);
  assert.doesNotMatch(readinessRoute, /Submitted for review/);
  assert.doesNotMatch(readinessRoute, /Submit campaign for review/);
  assert.doesNotMatch(panel, /needsApprovalReview/);
  assert.doesNotMatch(panel, /Send for review/);
  assert.doesNotMatch(panel, /requestApproval: true/);
  assert.match(panel, /Create paused Meta campaign/);
  assert.match(panel, /It does not start spend/);
});

test("publish submit shares one readiness gate and advances only after server acceptance", () => {
  const panel = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");
  const statusRoute = readFileSync("src/app/api/integrations/meta/publish-plans/[id]/route.ts", "utf8");
  assert.match(panel, /const ready = serverReadiness\?\.ready === true && brandApproved/);
  assert.match(panel, /isHttpsUrl\(destinationUrl\)/);
  assert.match(panel, /isHttpsUrl\(privacyUrl\)/);
  assert.match(panel, /hasFinishedPlacement\(campaignPack, "4:5"\)/);
  assert.match(panel, /hasFinishedPlacement\(campaignPack, "9:16"\)/);
  assert.match(panel, /normalizedQuestions\.length <= 5/);
  assert.match(panel, /if \(!ready\) return/);
  assert.match(panel, /body\.queueJobId \|\| body\.activePublishJob/);
  assert.match(panel, /body\.metaPublishPlan\?\.status !== "paused_ready"/);
  assert.match(panel, /\/publish-plans\/\$\{planId\}\/readiness/);
  assert.match(panel, /planToken: planReadiness\.planToken/);
  assert.match(panel, /confirmSpend: true/);
  assert.match(panel, /dailyBudgetMinorUnits: planReadiness\.budget\.dailyMinorUnits/);
  assert.match(panel, /currency: planReadiness\.budget\.currency/);
  assert.match(statusRoute, /queueStatus: queue\?\.status/);
  assert.match(statusRoute, /queueError: queue\?\.lastError/);
  assert.match(panel, /setPublished\(true\)/);
});

test("publish uses an explicit editable budget and a bounded paused schedule", () => {
  const panel = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");
  assert.match(panel, /useState\(20\)/);
  assert.match(panel, /Daily budget \(AUD\)/);
  assert.match(panel, /end\.setDate\(end\.getDate\(\) \+ 7\)/);
  assert.match(panel, /Create paused Meta campaign/);
});

test("Meta setup API captures concrete lead delivery endpoint config", () => {
  const setupRoute = readFileSync("src/app/api/integrations/meta/setup/route.ts", "utf8");

  assert.match(setupRoute, /PATCH/);
  assert.match(setupRoute, /leadDestination/);
  assert.match(setupRoute, /current\.leadDestination\.config/);
  assert.match(setupRoute, /patch\.leadDestination\?\.config/);
  assert.match(setupRoute, /validateMetaConnectionSetup\(nextSetup\)/);
});

test("Meta settings offers only real lead delivery destinations", () => {
  // The settings view is a thin composer; the Meta setup form (and its
  // destination types) lives in the connections section.
  const splitSettings = readFileSync("src/app/(customer)/settings/connections-section.tsx", "utf8");
  const execution = readFileSync("src/lib/providers/meta-execution.ts", "utf8");
  const splitDestinationTypesLine = splitSettings.match(/const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \[[^\n]+\];/)?.[0] ?? "";

  assert.match(splitSettings, /type MetaLeadDestinationType = "webhook" \| "crm" \| "manual"/);
  assert.match(splitSettings, /META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \["manual", "webhook", "crm"\]/);
  assert.doesNotMatch(splitDestinationTypesLine, /"email"/);
  assert.match(execution, /type: "webhook" \| "crm" \| "manual"/);
  assert.match(execution, /normalizeMetaLeadDestinationType/);
});

test("Meta Graph fallback version is shared with disconnect", () => {
  const version = readFileSync("src/lib/providers/meta-graph-version.ts", "utf8");
  const disconnectRoute = readFileSync("src/app/api/integrations/meta/disconnect/route.ts", "utf8");

  assert.match(version, /DEFAULT_META_GRAPH_VERSION/);
  assert.match(version, /"v26\.0"/);
  assert.match(disconnectRoute, /DEFAULT_META_GRAPH_VERSION/);
  assert.doesNotMatch(disconnectRoute, /"v19\.0"/);
});

test("operator prompt preview surfaces avoid stale Phase 1 test copy", () => {
  const promptPanel = readFileSync("src/components/prompt-control-panel.tsx", "utf8");
  const contentEditor = readFileSync("src/components/operator/content-runs/content-prompt-editor.tsx", "utf8");
  const contentPreviewRoute = readFileSync("src/app/api/operator/content-prompts/[id]/test/route.ts", "utf8");
  const promptPreviewRoute = readFileSync("src/app/api/operator/prompts/[key]/test/route.ts", "utf8");

  assert.match(promptPanel, /Run preview/);
  assert.match(promptPanel, /Preview Result/);
  assert.match(contentEditor, /Preview/);
  assert.match(contentPreviewRoute, /Prompt preview renders/);
  assert.match(promptPreviewRoute, /Provider execution is disabled for prompt previews/);
  assert.doesNotMatch(`${promptPanel}\n${contentEditor}\n${contentPreviewRoute}\n${promptPreviewRoute}`, /Phase 1|PR 1|Run test|Test Result/);
});

test("Ad Studio UI presents the constrained campaign workspace", () => {
  const adstudio = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");
  assert.match(adstudio, /type Stage = "create" \| "edit" \| "publish"/);
  assert.match(adstudio, /12 quality-checked designs/);
  assert.match(adstudio, /<CompactCreativeEditor/);
  assert.match(adstudio, /<CompactPublish/);
  assert.doesNotMatch(adstudio, />Provider<|>Model<|layer controls|Google Ads/);
});

test("Vercel Cron paginates provider work into the VPS queue", () => {
  const maintenance = readFileSync("src/lib/providers/scheduled-maintenance.ts", "utf8");
  const worker = readFileSync("worker/index.ts", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");

  assert.match(maintenance, /queueScheduledMetaLeadSyncs/);
  assert.match(maintenance, /queueScheduledPerformanceReadModels/);
  assert.match(maintenance, /check\.meta\.token-health/);
  assert.match(maintenance, /scanScheduledRowsById/);
  assert.match(maintenance, /\.gt\("id", afterId\)/);
  assert.doesNotMatch(maintenance, /\.limit\(100\)/);
  assert.match(worker, /case "sync\.meta\.leads"/);
  assert.match(worker, /case "check\.meta\.token-health"/);
  assert.match(worker, /case "reconcile\.customer\.activation"/);
  assert.match(vercel, /\/api\/cron\/meta-leads/);
  assert.match(vercel, /\/api\/cron\/provider-maintenance/);
  assert.match(vercel, /\/api\/cron\/performance-read-models/);
});

test("operator sidebar does not hardcode Hermes runtime health", () => {
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");

  assert.match(appShell, /Hermes Engine/);
  assert.match(appShell, /Open runtime workspace/);
  assert.doesNotMatch(appShell, /Operational/);
});
