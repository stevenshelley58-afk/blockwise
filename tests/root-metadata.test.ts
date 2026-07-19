import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("root metadata publishes the configured Meta app ID", () => {
  const layoutSource = readFileSync(resolve("src/app/layout.tsx"), "utf8");

  assert.match(layoutSource, /const META_APP_ID = process\.env\.META_APP_ID;/);
  assert.match(
    layoutSource,
    /facebook:\s*META_APP_ID\s*\?\s*\{\s*appId:\s*META_APP_ID\s*\}\s*:\s*undefined/,
  );
});
