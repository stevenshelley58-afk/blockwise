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
  const panel = readFileSync("src/components/adstudio/panels/publish-panel.tsx", "utf8");

  assert.doesNotMatch(readinessRoute, /approval_ready/);
  assert.doesNotMatch(readinessRoute, /Submitted for review/);
  assert.doesNotMatch(readinessRoute, /Submit campaign for review/);
  assert.doesNotMatch(panel, /needsApprovalReview/);
  assert.doesNotMatch(panel, /Send for review/);
  assert.doesNotMatch(panel, /requestApproval: true/);
  assert.match(panel, /Submit & go live/);
  assert.match(panel, /studio-review-creatives/);
});

test("publish budget supports presets, custom dates, and campaigns without an end date", () => {
  const panel = readFileSync("src/components/adstudio/panels/publish-panel.tsx", "utf8");

  assert.match(panel, /const BUDGET_PRESETS = \[10, 20, 50\]/);
  assert.match(panel, /const DURATION_PRESETS = \[7, 14, 30\]/);
  assert.match(panel, /Enter amount/);
  assert.match(panel, /Custom dates/);
  assert.match(panel, /Run until stopped/);
  assert.match(panel, /scheduleMode === "ongoing"[\s\S]*?null/);
  assert.match(panel, /End date must be after the start date/);
  assert.match(panel, /end\.setDate\(end\.getDate\(\) \+ 6\)/);
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
  assert.match(version, /"v23\.0"/);
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
  const adstudio = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");

  assert.match(adstudio, /\/api\/adstudio\/campaigns/);
  assert.match(adstudio, /\/api\/adstudio\/campaigns\/\$\{currentPack\.campaign\.campaignId\}\/draft/);
  assert.match(adstudio, /\/api\/adstudio\/export-packages\/\$\{currentPack\.campaign\.campaignId\}\/download/);
  assert.match(adstudio, /platforms:\s*\["meta"\]/);
  assert.match(adstudio, /Create from the selected template/);
  assert.match(adstudio, /Campaign readiness/);
  assert.match(adstudio, /Export creatives/);
  assert.match(adstudio, /const NAV_ITEMS:[\s\S]*id: "home"[\s\S]*id: "samples"[\s\S]*id: "library"[\s\S]*id: "text"[\s\S]*id: "publish"[\s\S]*id: "brand"[\s\S]*id: "settings"/);
  const navItems = adstudio.match(/const NAV_ITEMS:[\s\S]*?\];/)?.[0] ?? "";
  const mobileNavIds = adstudio.match(/const MOBILE_NAV_IDS[\s\S]*?\);/)?.[0] ?? "";
  assert.match(mobileNavIds, /"home", "samples", "library", "text", "publish"/);
  assert.doesNotMatch(mobileNavIds, /"brand"|"settings"|"campaign"|"design"/);
  assert.match(navItems, /id: "samples", label: "Create"/);
  assert.match(navItems, /id: "publish", label: "Publish"/);
  assert.match(adstudio, /const MOBILE_NAV = NAV_ITEMS\.filter/);
  assert.doesNotMatch(adstudio, /label: "Review"/);
  assert.doesNotMatch(adstudio, /const ADVANCED_NAV_ITEMS/);
  assert.doesNotMatch(adstudio, /label: "Ad"/);
  assert.match(adstudio, /label: "Brand Pack"/);
  assert.doesNotMatch(navItems, /label: "Brand"[,}]/);
  assert.doesNotMatch(navItems, /label: "Design"/);
  assert.match(adstudio, /studio-home-shell/);
  assert.match(adstudio, /aria-label="Ad progress"/);
  assert.match(adstudio, /Create an ad/);
  assert.match(adstudio, /samplePickerOpen/);
  assert.match(adstudio, /<NewAdDialog/);
  assert.match(adstudio, /showBrandSetupPrompt/);
  assert.doesNotMatch(adstudio, /Create your own/);
  assert.doesNotMatch(adstudio, /Export pack/);
  assert.doesNotMatch(adstudio, /Engine: GPT/);
  assert.doesNotMatch(adstudio, /setPlatform\("google"\)/);
});

test("Trigger includes scheduled Meta lead sync and token health checks", () => {
  const trigger = readFileSync("trigger/meta-publish.ts", "utf8");

  assert.match(trigger, /schedules\.task/);
  assert.match(trigger, /sync\.meta\.leads\.scheduled/);
  assert.match(trigger, /check\.meta\.token-health\.scheduled/);
  assert.match(trigger, /runScheduledMetaLeadSyncs/);
  assert.match(trigger, /runScheduledMetaTokenHealthChecks/);
});

test("operator sidebar does not hardcode Hermes runtime health", () => {
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");

  assert.match(appShell, /Hermes Engine/);
  assert.match(appShell, /Open runtime workspace/);
  assert.doesNotMatch(appShell, /Operational/);
});
