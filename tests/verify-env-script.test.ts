import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("verify-env warns on incomplete Vercel Preview env but remains fail-closed elsewhere", () => {
  const script = readFileSync("scripts/verify-env.mjs", "utf8");

  assert.match(script, /env\.VERCEL === "1" && env\.VERCEL_ENV === "preview"/);
  assert.match(script, /Preview environment incomplete/);
  assert.match(script, /console\.warn\(`Preview environment incomplete: \$\{message\}`\)/);
  assert.match(script, /console\.error\(message\)/);
  assert.match(script, /process\.exit\(1\)/);
});
