// Template Studio contracts (Track C, §5.2): operator-only API, dev-only
// writes, and the approve law (human confirmation + full gate).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const detail = readFileSync(join("src", "app", "api", "operator", "template-studio", "[id]", "route.ts"), "utf8");
const queue = readFileSync(join("src", "app", "api", "operator", "template-studio", "route.ts"), "utf8");
const source = readFileSync(join("src", "app", "api", "operator", "template-studio", "source", "route.ts"), "utf8");
const studioLib = readFileSync(join("src", "lib", "adstudio", "v2", "studio.ts"), "utf8");
const screen = readFileSync(join("src", "components", "operator", "template-studio-client.tsx"), "utf8");

test("studio API is operator-gated and dev-only for writes", () => {
  for (const file of [detail, queue, source]) {
    assert.match(file, /requireOperator\(\)/);
  }
  assert.match(detail, /studioWritesAllowed\(\)/);
  assert.match(studioLib, /NODE_ENV !== "production"/);
});

test("approve enforces the human sign-off and the full gate", () => {
  assert.match(studioLib, /confirmation checkbox required/);
  assert.match(studioLib, /story layout required/);
  assert.match(studioLib, /restyle evidence trivial \(D5\)/);
  assert.match(studioLib, /exceeds/);
  assert.match(studioLib, /qaBy,/);
  assert.match(studioLib, /qaAt: new Date\(\)\.toISOString\(\)/);
});

test("the studio screen wires diff, check, and the required confirmation", () => {
  assert.match(screen, /mix-blend-difference/);
  assert.match(screen, /action=check/);
  assert.match(screen, /action=approve/);
  assert.match(screen, /Inspected at 100% zoom; a designer would ship this\./);
  // Approve is disabled until the human ticks the box.
  assert.match(screen, /disabled=\{!confirm \|\| checking \|\| saving\}/);
});
