import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Self-serve nav labels and order live in the white-label niche config; the
// sidebar component only supplies icons. Assert against the config source.
test("self-serve setup navigation exposes Brand Pack and one combined Settings entry", () => {
  const config = readFileSync("src/config/niche/blockwise.ts", "utf8");
  const navBlock = config.match(/items: \[[\s\S]*?\]/)?.[0] ?? "";

  assert.match(navBlock, /href: "\/ad-studio\/brand", label: "Brand Pack"/);
  assert.match(navBlock, /href: "\/settings", label: "Settings"/);
  assert.doesNotMatch(navBlock, /label: "Identity"/);
  assert.doesNotMatch(navBlock, /label: "Integrations"/);
  assert.doesNotMatch(navBlock, /label: "Workspace"/);
  assert.equal((navBlock.match(/href: "\/settings(?:[#?][^"]*)?"/g) ?? []).length, 1);
});

test("sidebar renders self-serve nav from the niche config", () => {
  const sidebar = readFileSync("src/components/sidebar-nav.tsx", "utf8");

  assert.match(sidebar, /from "@\/config\/niche"/);
  assert.match(sidebar, /niche\.nav\.items/);
  // Feature-flagged routes must respect the config flags.
  assert.match(sidebar, /niche\.features\[item\.feature\]/);
});
