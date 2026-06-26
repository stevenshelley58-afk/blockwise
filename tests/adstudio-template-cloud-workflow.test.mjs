import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync(".github/workflows/adstudio-template-cloud-orchestrator.yml", "utf8");

test("template cloud orchestrator runs one Codex canary before dispatching batch fanout", () => {
  const canaryIndex = orchestrator.indexOf("Run Codex quota canary");
  const dispatchIndex = orchestrator.indexOf("Dispatch cloud template batches");

  assert.ok(canaryIndex > 0, "orchestrator should include a Codex quota canary step");
  assert.ok(dispatchIndex > canaryIndex, "batch dispatch should happen after the quota canary");
  assert.match(orchestrator, /uses:\s+openai\/codex-action@v1/u);
  assert.match(orchestrator, /CODEX_TEMPLATE_BATCH_CANARY_READY/u);
  assert.match(orchestrator, /if:\s+steps\.codex_secret\.outputs\.ready == 'true' && inputs\.dry_run == false/u);
});

test("template cloud orchestrator still allows dry-run dispatch without consuming Codex quota", () => {
  assert.match(orchestrator, /dry_run:/u);
  assert.match(orchestrator, /if:\s+steps\.codex_secret\.outputs\.ready == 'true' \|\| inputs\.dry_run == true/u);
  assert.match(orchestrator, /args\+=\(--dry-run\)/u);
});
