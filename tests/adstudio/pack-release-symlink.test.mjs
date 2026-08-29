import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..", "..");

describe("pack-release direct invocation", () => {
  it("executes through the /opt-style symlink instead of silently succeeding", () => {
    const temp = mkdtempSync(join(os.tmpdir(), "adstudio-pack-release-link-"));
    try {
      const linkedRoot = join(temp, "builder");
      symlinkSync(ROOT, linkedRoot, process.platform === "win32" ? "junction" : "dir");
      const script = join(linkedRoot, "scripts", "adstudio", "v2", "pack-release.mjs");
      const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
      assert.notEqual(result.status, 0, `packager unexpectedly succeeded: ${result.stdout}`);
      assert.match(`${result.stderr}\n${result.stdout}`, /--candidate is required|--approval is required/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
