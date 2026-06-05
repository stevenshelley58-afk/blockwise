import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operator prompt controls expose trace fields without enabling provider test execution", () => {
  const apiRoute = readFileSync("src/app/api/operator/prompts/route.ts", "utf8");
  const panel = readFileSync("src/components/prompt-control-panel.tsx", "utf8");
  const detailPage = readFileSync("src/app/(workforce)/model-control/runs/[id]/page.tsx", "utf8");

  assert.match(apiRoute, /task_type, model_profile, correlation_id, user_id, ai_run_id, ai_usage_ledger_id/);
  assert.match(apiRoute, /cost_estimate/);
  assert.match(panel, /Assemble-only/);
  assert.match(panel, /formatCost\(run\.cost_estimate\)/);
  assert.match(panel, /shortTrace\(run\.correlation_id\)/);
  assert.match(panel, /href=\{`\/model-control\/runs\/\$\{run\.id\}`\}/);
  assert.doesNotMatch(panel, /runProvider:\s*true/);
  assert.match(detailPage, /requirePageSurfaceAccess\("model_control"\)/);
  assert.match(detailPage, /\.eq\("workspace_id", access\.workspaceId\)/);
  assert.match(detailPage, /Provider Response/);
  assert.match(detailPage, /Artifacts And Approvals/);
  assert.match(detailPage, /Lead Result Trace/);
  assert.doesNotMatch(detailPage, /recordAdStudioProviderRun/);
});
