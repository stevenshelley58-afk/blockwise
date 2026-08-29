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
  const promptPreviewRoute = readFileSync("src/app/api/operator/prompts/[key]/test/route.ts", "utf8");

  assert.match(promptPanel, /Run preview/);
  assert.match(promptPanel, /Preview Result/);
  assert.match(promptPreviewRoute, /Provider execution is disabled for prompt previews/);
  assert.doesNotMatch(`${promptPanel}\n${promptPreviewRoute}`, /Phase 1|PR 1|Run test|Test Result/);
});

test("operator sidebar does not hardcode Hermes runtime health", () => {
  const appShell = readFileSync("src/components/app-shell.tsx", "utf8");

  assert.match(appShell, /Hermes Engine/);
  assert.match(appShell, /Open runtime workspace/);
  assert.doesNotMatch(appShell, /Operational/);
});
