import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The deterministic QA linter (tokens, locale coherence, CTA<->category,
// stat uniqueness, text artifacts) must pass for every shipped sample card.
test("all sample cards pass the deterministic QA linter", () => {
  const python = process.env.PYTHON ?? "python3";
  const result = spawnSync(python, ["scripts/adstudio_card_qa.py", "--lint-only"], { encoding: "utf8" });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    // Python unavailable in this environment - skip rather than fail the suite.
    return;
  }
  assert.equal(result.status, 0, `QA lint reported issues:\n${result.stdout}\n${result.stderr}`);
});
