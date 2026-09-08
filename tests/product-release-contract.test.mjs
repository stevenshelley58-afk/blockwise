import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const suite of ["product-release-preflight.test.sh", "product-release.test.sh"]) {
  test(`single-authority release contract: ${suite}`, { skip: process.platform === "win32" ? "VPS Bash release contract" : false }, () => {
    const result = spawnSync("bash", [`tests/${suite}`], { cwd: root, encoding: "utf8", timeout: 60_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
