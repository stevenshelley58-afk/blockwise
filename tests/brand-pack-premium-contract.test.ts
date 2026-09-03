import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");

test("Brand Pack uses the shared Premium v2 vocabulary", () => {
  assert.match(source, /from "@\/components\/ui\/button"/);
  assert.match(source, /from "@\/components\/ui\/card"/);
  assert.match(source, /from "@\/components\/ui\/input"/);
  assert.match(source, /from "@\/components\/ui\/label"/);
  assert.match(source, /Brand Pack/);
  assert.match(source, /shadow-card/);
  assert.match(source, /md:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(source, /md:sticky md:top-5/);
  assert.doesNotMatch(source, /--ui-/);
  assert.doesNotMatch(source, /BRAND_STYLES|bs-/);
  assert.doesNotMatch(source, /<style/);
});

test("Brand Pack keeps honest first-run and save states", () => {
  assert.match(source, /aria-busy=\{busy\}/);
  assert.match(source, /role=\{notice\?\.tone === "err" \? "alert"/);
  assert.match(source, /Save changes/);
  assert.match(source, /busy === "approve"/);
  assert.match(source, /busy === "scan"/);
});

test("colour picker stays open for in-picker clicks and supports Escape dismissal", () => {
  assert.match(source, /data-brand-swatch/);
  assert.match(source, /target\.closest\("\[data-brand-swatch\]"\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /aria-expanded=\{open\}/);
});

test("the removed parallel Brand Pack visual system is absent", () => {
  assert.equal(existsSync("src/components/adstudio/brand-studio-styles.ts"), false);
  assert.equal(existsSync("src/components/adstudio/brand-preview.tsx"), false);
  assert.equal(existsSync("src/components/adstudio/brand-details-cards.tsx"), false);
  assert.equal(existsSync("src/components/adstudio/brand-color-swatch.tsx"), false);
  assert.equal(existsSync("src/components/adstudio/brand-voice-card.tsx"), false);
});
