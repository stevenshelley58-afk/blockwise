import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// HARD RULE (Ad Studio): end users NEVER see prompts or model names. All model
// and prompt control lives in the operator surfaces. This guard fails loudly if
// any model/prompt control ever leaks into the customer-facing Settings panel.
const SETTINGS_PANEL = "src/components/adstudio/panels/settings-panel.tsx";

test("the end-user settings panel imports no operator model/prompt control", () => {
  const source = readFileSync(SETTINGS_PANEL, "utf8");

  for (const forbidden of [
    "ModelControlPanel",
    "PromptControlPanel",
    "model-control-config",
    "model-control-panel",
    "prompt-control-panel",
    "getModelControlViewData",
    "CURATED_OPENROUTER_OPTIONS",
    "model_profile",
    "model-profiles",
    "resolveRuntimeModelProfile",
    "prompt-registry",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `settings-panel must not reference ${forbidden}`,
    );
  }
});

test("the end-user settings panel exposes no model/prompt picker affordances", () => {
  const source = readFileSync(SETTINGS_PANEL, "utf8");
  // No mention of choosing models/prompts; case-insensitive so renamed labels still trip it.
  assert.doesNotMatch(source, /\bmodel\b/i, "settings-panel must not mention models");
  assert.doesNotMatch(source, /\bprompt\b/i, "settings-panel must not mention prompts");
  // Sanity: it is still the Settings panel.
  assert.match(source, /PanelHeader/);
  assert.match(source, /title="Settings"/);
});
