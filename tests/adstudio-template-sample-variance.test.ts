import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CURATED_TEMPLATE_SAMPLE_STYLES } from "../src/lib/adstudio/template-sample-styles.generated.ts";

const seed = JSON.parse(readFileSync("ad-template-library/library-seed.json", "utf8")) as {
  templates: Array<{ template_key: string }>;
};
const curatedJson = JSON.parse(readFileSync("ad-template-library/sample-styles.json", "utf8")) as Record<
  string,
  { layout: string; people: string; visualStyle: string; copyDensity: string; propertyAge: string; priceFeel: string; prompt: string }
>;

test("every seed template has a curated sample style", () => {
  for (const template of seed.templates) {
    const style = curatedJson[template.template_key];
    assert.ok(style, `missing curated style for ${template.template_key}`);
    assert.ok(style.prompt && style.prompt.length > 20, `weak prompt for ${template.template_key}`);
    assert.ok(style.layout, `missing layout for ${template.template_key}`);
  }
});

test("curated gallery uses many distinct layouts (Canva-style variety)", () => {
  const layouts = new Set(Object.values(curatedJson).map((s) => s.layout));
  assert.ok(layouts.size >= 8, `expected >= 8 distinct layouts, got ${layouts.size}`);
});

test("generated TS sample-style map stays in sync with sample-styles.json", () => {
  const jsonKeys = Object.keys(curatedJson).sort();
  const tsKeys = Object.keys(CURATED_TEMPLATE_SAMPLE_STYLES).sort();
  assert.deepEqual(tsKeys, jsonKeys);
  for (const key of jsonKeys) {
    assert.equal(CURATED_TEMPLATE_SAMPLE_STYLES[key].layout, curatedJson[key].layout);
    assert.equal(CURATED_TEMPLATE_SAMPLE_STYLES[key].visualStyle, curatedJson[key].visualStyle);
    assert.equal(CURATED_TEMPLATE_SAMPLE_STYLES[key].people, curatedJson[key].people);
  }
});

test("renderer composites curated source images into layouts", () => {
  const renderer = readFileSync("scripts/adstudio-render-template-cards.py", "utf8");
  assert.match(renderer, /sample-sources/);
  assert.match(renderer, /LAYOUTS = \{/);
  assert.match(renderer, /def lay_data_card/);
  assert.match(renderer, /def lay_magazine_split/);
});
