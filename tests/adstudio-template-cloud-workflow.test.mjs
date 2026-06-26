import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync(".github/workflows/adstudio-template-cloud-orchestrator.yml", "utf8");
const buildWorkflow = readFileSync(".github/workflows/adstudio-template-cloud-build.yml", "utf8");

test("template cloud orchestrator runs one Codex canary before dispatching batch fanout", () => {
  const canaryIndex = orchestrator.indexOf("Run Codex quota canary");
  const dispatchIndex = orchestrator.indexOf("Dispatch cloud template batches");

  assert.ok(canaryIndex > 0, "orchestrator should include a Codex quota canary step");
  assert.ok(dispatchIndex > canaryIndex, "batch dispatch should happen after the quota canary");
  assert.match(orchestrator, /uses:\s+openai\/codex-action@v1/u);
  assert.match(orchestrator, /CODEX_TEMPLATE_BATCH_CANARY_READY/u);
  assert.match(orchestrator, /codex_provider:/u);
  assert.match(orchestrator, /OPENROUTER_API_KEY/u);
  assert.match(orchestrator, /responses-api-endpoint:\s+\$\{\{ inputs\.codex_provider == 'openrouter' && 'https:\/\/openrouter\.ai\/api\/v1\/responses' \|\| '' \}\}/u);
  assert.match(orchestrator, /--codex-provider "\$\{\{ inputs\.codex_provider \}\}"/u);
  assert.match(orchestrator, /codex_model:/u);
  assert.match(orchestrator, /model:\s+\$\{\{ inputs\.codex_model \}\}/u);
  assert.match(orchestrator, /--codex-model "\$\{\{ inputs\.codex_model \}\}"/u);
  assert.match(orchestrator, /if:\s+steps\.codex_secret\.outputs\.ready == 'true' && inputs\.dry_run == false/u);
});

test("template cloud orchestrator still allows dry-run dispatch without consuming Codex quota", () => {
  assert.match(orchestrator, /dry_run:/u);
  assert.match(orchestrator, /if:\s+steps\.codex_secret\.outputs\.ready == 'true' \|\| inputs\.dry_run == true/u);
  assert.match(orchestrator, /args\+=\(--dry-run\)/u);
});

test("template cloud build pins worker and integrator Codex runs to the requested model", () => {
  assert.match(buildWorkflow, /codex_provider:/u);
  assert.match(buildWorkflow, /OPENROUTER_API_KEY/u);
  assert.match(buildWorkflow, /responses-api-endpoint:\s+\$\{\{ github\.event\.inputs\.codex_provider == 'openrouter' && 'https:\/\/openrouter\.ai\/api\/v1\/responses' \|\| '' \}\}/u);
  assert.match(buildWorkflow, /codex_model:/u);
  assert.match(buildWorkflow, /model:\s+\$\{\{ github\.event\.inputs\.codex_model \}\}/u);
});
