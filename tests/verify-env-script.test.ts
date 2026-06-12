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

test("verify-env has an explicit first-tester mode for launch-critical services", () => {
  const script = readFileSync("scripts/verify-env.mjs", "utf8");
  const pkg = readFileSync("package.json", "utf8");

  assert.match(pkg, /"verify-env:first-tester": "node scripts\/verify-env\.mjs --first-tester"/);
  assert.match(script, /process\.argv\.includes\("--first-tester"\)/);
  assert.match(script, /Invalid or missing first-tester environment variables/);
  assert.match(script, /readiness\.firstTester\.invalid\.join\(", "\)/);
  assert.match(script, /All first-tester Blockwise environment variables are present and non-placeholder/);
});
