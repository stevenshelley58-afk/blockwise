import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../hermes/tools/research-runtime/bin/supabase-supervisor.mjs", import.meta.url), "utf8");

test("carousel cards feed hosted creative media extraction", () => {
  assert.match(source, /collectStrings\(snapshot\.images, snapshot\.cards\)/u);
  assert.match(source, /collectStrings\(snapshot\.videos, snapshot\.cards\)/u);
  assert.match(source, /collectStrings\(snapshot\.thumbnails, snapshot\.cards\)/u);
  assert.match(source, /carousel_cards.*carouselCards/u);
});

test("nested media arrays are traversed instead of stringifying cards", () => {
  assert.match(source, /if \(Array\.isArray\(item\)\) \{/u);
  assert.match(source, /for \(const nested of collectStrings\(item\)\)/u);
});
