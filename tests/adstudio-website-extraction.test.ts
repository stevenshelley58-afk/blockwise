import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../src/app/api/adstudio/brand-kits/extract/route.ts", import.meta.url),
  "utf8",
);

test("website extraction requests HTML with a browser-compatible identity", () => {
  assert.match(routeSource, /"User-Agent":\s*"Mozilla\/5\.0/);
  assert.match(routeSource, /Accept:\s*"text\/html,application\/xhtml\+xml/);
  assert.match(routeSource, /"Accept-Language":\s*"en-AU,en;q=0\.9"/);
});
