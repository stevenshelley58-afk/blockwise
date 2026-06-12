import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approvals page exposes human approve and reject actions", () => {
  const page = readFileSync("src/app/(customer)/approvals/page.tsx", "utf8");
  const actions = readFileSync("src/components/approvals/approval-actions.tsx", "utf8");
  const liveData = readFileSync("src/lib/product/live-data.ts", "utf8");
  const sidebar = readFileSync("src/components/sidebar-nav.tsx", "utf8");
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");

  assert.match(page, /ApprovalActions/);
  assert.match(page, /<th>Actions<\/th>/);
  assert.match(page, /access\.isOperator \? undefined : access\.workspaceId/);
  assert.match(page, /status: "requested"/);
  assert.match(page, /workspaceId=\{item\.workspaceId\}/);
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
  const execution = readFileSync("src/lib/providers/meta-execution.ts", "utf8");
  const destinationTypesLine = settings.match(/const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \[[^\n]+\];/)?.[0] ?? "";

  assert.match(settings, /type MetaLeadDestinationType = "webhook" \| "crm" \| "manual"/);
  assert.match(settings, /META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType\[\] = \["manual", "webhook", "crm"\]/);
  assert.doesNotMatch(destinationTypesLine, /"email"/);
  assert.match(execution, /type: "webhook" \| "crm" \| "manual"/);
  assert.match(execution, /normalizeMetaLeadDestinationType/);
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
  assert.doesNotMatch(adstudio, /AI generated/);
  assert.doesNotMatch(adstudio, /AI helps/);
  assert.doesNotMatch(adstudio, /Create your own/);
  assert.doesNotMatch(adstudio, /Export pack/);
  assert.doesNotMatch(adstudio, /Engine: OpenAI/);
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
