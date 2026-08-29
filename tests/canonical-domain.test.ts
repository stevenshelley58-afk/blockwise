import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const nextConfig = readFileSync("next.config.ts", "utf8");

test("alternate Vercel domain redirects permanently to the canonical domain", () => {
  assert.match(nextConfig, /has:\s*\[\{\s*type:\s*"host",\s*value:\s*"blockwise-tan\.vercel\.app"\s*\}\]/);
  assert.match(nextConfig, /destination:\s*"https:\/\/blockwise\.sale\/:path\*"/);
  assert.match(nextConfig, /permanent:\s*true/);
});
