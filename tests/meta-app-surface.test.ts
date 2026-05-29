import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approvals page exposes human approve and reject actions", () => {
  const page = readFileSync("src/app/(operator)/approvals/page.tsx", "utf8");
  const actions = readFileSync("src/components/approvals/approval-actions.tsx", "utf8");

  assert.match(page, /ApprovalActions/);
  assert.match(page, /<th>Actions<\/th>/);
  assert.match(actions, /PATCH/);
  assert.match(actions, /\/api\/approvals\/\$\{approvalId\}/);
  assert.match(actions, /Approve/);
  assert.match(actions, /Reject/);
});

test("Meta setup UI captures concrete lead delivery endpoint config", () => {
  const monitor = readFileSync("src/components/monitor/monitor-dashboard.tsx", "utf8");

  assert.match(monitor, /Destination endpoint/);
  assert.match(monitor, /leadDestination\.config\.endpoint/);
  assert.match(monitor, /https:\/\/crm\.example\.com\/leads/);
});

test("Ad Studio UI can create approval requests for live Meta mutations", () => {
  const adstudio = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");

  assert.match(adstudio, /requestMetaPlanMutation/);
  assert.match(adstudio, /\/api\/integrations\/meta\/publish-plans\/\$\{lastMetaPlanId\}\/mutations/);
  assert.match(adstudio, /Request activation/);
  assert.match(adstudio, /Request pause/);
  assert.match(adstudio, /Request budget/);
});

test("Trigger includes scheduled Meta lead sync and token health checks", () => {
  const trigger = readFileSync("trigger/meta-publish.ts", "utf8");

  assert.match(trigger, /schedules\.task/);
  assert.match(trigger, /sync\.meta\.leads\.scheduled/);
  assert.match(trigger, /check\.meta\.token-health\.scheduled/);
  assert.match(trigger, /runScheduledMetaLeadSyncs/);
  assert.match(trigger, /runScheduledMetaTokenHealthChecks/);
});
