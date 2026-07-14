import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("self-serve setup navigation exposes Brand Pack and one combined Settings entry", () => {
  const sidebar = readFileSync("src/components/sidebar-nav.tsx", "utf8");
  const selfServeBlock = sidebar.match(/const selfServeNavItems[\s\S]*?const monitorNavItems/)?.[0] ?? "";

  assert.match(selfServeBlock, /href: "\/ad-studio\/brand", label: "Brand Pack"/);
  assert.match(selfServeBlock, /href: "\/settings", label: "Settings"/);
  assert.doesNotMatch(selfServeBlock, /label: "Identity"/);
  assert.doesNotMatch(selfServeBlock, /label: "Integrations"/);
  assert.doesNotMatch(selfServeBlock, /label: "Workspace"/);
  assert.equal((selfServeBlock.match(/href: "\/settings(?:[#?][^"]*)?"/g) ?? []).length, 1);
});
