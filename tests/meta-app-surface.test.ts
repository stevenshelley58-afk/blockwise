import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approvals page exposes human approve and reject actions", () => {
  const page = readFileSync("src/app/(customer)/approvals/page.tsx", "utf8");
  const actions = readFileSync("src/components/approvals/approval-actions.tsx", "utf8");
  const liveData = readFileSync("src/lib/operator/overview.ts", "utf8");
  const sidebar = readFileSync("src/components/sidebar-nav.tsx", "utf8");
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");

  assert.match(page, /ApprovalActions/);
  assert.match(page, /<th>Actions<\/th>/);
  assert.match(page, /access\.isOperator \? undefined : access\.workspaceId/);
  assert.match(page, /status: "requested"/);
  assert.match(page, /workspaceId=\{item\.workspaceId\}/);
  assert.match(page, /approvalTone\(item\.status\)/);
  assert.match(page, /status === "approved"[\s\S]*return "green"/);
  assert.match(page, /status === "rejected" \|\| status === "cancelled"[\s\S]*return "rose"/);
  assert.match(liveData, /workspace_id,target_type,target_id,status,risk_summary,workspaces\(name\)/);
  assert.match(liveData, /if \(workspaceId\)/);
  assert.match(liveData, /if \(options\.status\)/);
  assert.match(sidebar, /\{ href: "\/approvals", label: "Approvals", icon: ClipboardCheck \}/);
  assert.match(sidebar, /showApprovals \|\| item\.href !== "\/approvals"/);
  assert.match(appShell, /primaryMembership\?\.role === "owner" \|\| primaryMembership\?\.role === "admin"/);
  assert.match(actions, /PATCH/);
  assert.match(actions, /\/api\/approvals\/\$\{approvalId\}/);
  assert.match(actions, /Approve/);
  assert.match(actions, /Reject/);
});

test("publish review state is not treated as a hard publish error", () => {
  const readinessRoute = readFileSync("src/app/api/adstudio/publish-readiness/route.ts", "utf8");
  const panel = readFileSync("src/components/adstudio/panels/publish-panel.tsx", "utf8");

  assert.match(readinessRoute, /review: true/);
  assert.match(readinessRoute, /Submitted for review/);
  assert.match(panel, /!item\.met && \(!item\.review \|\| item\.blocked\)/);
  assert.match(panel, /needsApprovalReview/);
  assert.match(panel, /Send for review/);
  assert.match(panel, /Submitted for review - your campaign will be queued once approved/);
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
  const settings = readFileSync("src/app/(customer)/settings/settings-view.tsx", "utf8");
  const splitSettings = readFileSync("src/app/(customer)/settings/connections-section.tsx", "utf8");
  const execution = readFileSync("src/lib/providers/meta-execution.ts", "utf8");
  const destinationTypesLine = settings.match(/const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \[[^\n]+\];/)?.[0] ?? "";
  const splitDestinationTypesLine = splitSettings.match(/const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \[[^\n]+\];/)?.[0] ?? "";

  assert.match(settings, /type MetaLeadDestinationType = "webhook" \| "crm" \| "manual"/);
  assert.match(splitSettings, /type MetaLeadDestinationType = "webhook" \| "crm" \| "manual"/);
  assert.match(settings, /META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \["manual", "webhook", "crm"\]/);
  assert.match(splitSettings, /META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \["manual", "webhook", "crm"\]/);
  assert.doesNotMatch(destinationTypesLine, /"email"/);
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
  assert.match(adstudio, /Generate variants/);
  assert.match(adstudio, /Campaign readiness/);
  assert.match(adstudio, /Export creatives/);
  assert.match(adstudio, /const NAV_ITEMS:[\s\S]*id: "home"[\s\S]*id: "templates"[\s\S]*id: "media"[\s\S]*id: "editor"[\s\S]*id: "publish"[\s\S]*id: "settings"/);
  const mobileNav = adstudio.match(/const MOBILE_NAV:[\s\S]*?\];/)?.[0] ?? "";
  assert.match(mobileNav, /id: "home"[\s\S]*id: "templates"[\s\S]*id: "media"[\s\S]*id: "editor"[\s\S]*id: "publish"[\s\S]*id: "settings"/);
  assert.doesNotMatch(mobileNav, /id: "campaign"/);
  assert.doesNotMatch(mobileNav, /id: "design"/);
  assert.doesNotMatch(adstudio, /const ADVANCED_NAV_ITEMS/);
  assert.doesNotMatch(adstudio, /label: "Ad"/);
  assert.doesNotMatch(adstudio, /label: "Brand"/);
  assert.doesNotMatch(adstudio, /label: "Design"/);
  assert.match(adstudio, /studio-home-shell/);
  assert.match(adstudio, /templatePickerOpen/);
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
