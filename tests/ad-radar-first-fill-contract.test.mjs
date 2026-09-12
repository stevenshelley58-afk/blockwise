import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../hermes/tools/research-runtime/bin/supabase-supervisor.mjs", import.meta.url), "utf8");

test("first-fill-only worker excludes maintenance jobs", () => {
  assert.match(source, /if \(firstFillOnly && !initialFill && !firstFillChild\) return false;/u);
  assert.match(source, /input\.scanMode === "initial_fill"/u);
  assert.match(source, /HERMES_AD_RADAR_FIRST_FILL_ONLY/u);
});

test("partial or non-exhausted captures fail the page check", () => {
  assert.match(source, /if \(!coverageComplete \|\| !paginationExhausted\) \{/u);
  assert.match(source, /markAdvertiserPageCheckFailed\(payload\.advertiserPageId\)/u);
});
