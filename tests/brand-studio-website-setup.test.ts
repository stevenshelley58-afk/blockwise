import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");

test("Brand Studio explains the website-first setup path", () => {
  assert.match(source, /Enter your website\. We’ll build your brand kit\./);
  assert.match(source, /Build my brand kit/);
  assert.match(source, /Update from website/);
  assert.match(source, /htmlFor="brand-website"/);
  assert.match(source, /placeholder="e\.g\. youragency\.com\.au"/);
  assert.match(source, /type="submit"/);
});
