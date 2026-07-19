import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCuratedModelOptionsForProfile } from "../src/lib/ai/model-control-config.ts";

test("Model Control live tests use the production direct adapters", () => {
  const source = readFileSync("src/lib/ai/direct-model-test.ts", "utf8");
  assert.match(source, /createTextProviderForCandidate/);
  assert.match(source, /createImageProviderForCandidate/);
  assert.doesNotMatch(source, /fetch\(/);
});

test("image profile tests are recognizable as live billable requests", () => {
  const options = getCuratedModelOptionsForProfile("image_final");
  assert.ok(options.every((option) => option.supportsImageOutput));
  const panel = readFileSync("src/components/model-control-panel.tsx", "utf8");
  assert.match(panel, /live, billable generation request/);
});
