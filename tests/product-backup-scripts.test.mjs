import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const helper = new URL("../scripts/vps/product-backup-retention.sh", import.meta.url).pathname;

function oldDir(root, name) {
  const path = join(root, name);
  mkdirSync(path);
  const old = new Date(Date.now() - 100 * 86400 * 1000);
  utimesSync(path, old, old);
  return path;
}

test("backup retention prunes only timestamped direct children", () => {
  const root = mkdtempSync(join(tmpdir(), "blockwise-backup-"));
  try {
    const old = oldDir(root, "20260101T000000Z");
    const unrelated = oldDir(root, "not-a-backup");
    const nestedRoot = join(root, "20260102T000000Z");
    mkdirSync(nestedRoot);
    mkdirSync(join(nestedRoot, "20260103T000000Z"));
    const deleted = execFileSync("bash", [helper, root, "90"], { encoding: "utf8" });
    assert.equal(deleted, "1");
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(unrelated), true);
    assert.equal(existsSync(join(nestedRoot, "20260103T000000Z")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed preceding backup command propagates and does not prune", () => {
  const root = mkdtempSync(join(tmpdir(), "blockwise-backup-"));
  try {
    const old = oldDir(root, "20260101T000000Z");
    const result = (() => {
      try {
        execFileSync("bash", ["-Eeuo", "pipefail", "-c", `false; "${helper}" "${root}" 90`], { encoding: "utf8" });
        return 0;
      } catch (error) {
        return error.status;
      }
    })();
    assert.notEqual(result, 0);
    assert.equal(existsSync(old), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retention rejects an invalid target or day count", () => {
  assert.throws(() => execFileSync("bash", [helper, "/tmp", "0"]));
  assert.throws(() => execFileSync("bash", [helper, "/tmp/missing-blockwise-root", "90"]));
});
