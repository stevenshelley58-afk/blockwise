import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "vps", "product-object-manifest.mjs");

test("object manifest binds metadata to downloaded bytes and rejects mismatches", () => {
  const scratch = mkdtempSync(join(tmpdir(), "blockwise-object-manifest-"));
  try {
    const source = join(scratch, "objects");
    mkdirSync(join(source, "workspace-artifacts", "folder"), { recursive: true });
    writeFileSync(join(source, "workspace-artifacts", "folder", "asset.txt"), "safe bytes");
    const metadata = join(scratch, "metadata.tsv");
    const out = join(scratch, "manifest.tsv");
    writeFileSync(metadata, "workspace-artifacts\tfolder/asset.txt\t10\ttext/plain\n");
    const good = spawnSync(process.execPath, [SCRIPT, "--metadata", metadata, "--source-root", source, "--out", out], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    assert.match(readFileSync(out, "utf8"), /^workspace-artifacts\tfolder\/asset\.txt\t[a-f0-9]{64}\t10\ttext\/plain\n$/u);

    writeFileSync(metadata, "workspace-artifacts\tfolder/asset.txt\t9\ttext/plain\n");
    const bad = spawnSync(process.execPath, [SCRIPT, "--metadata", metadata, "--source-root", source, "--out", out], { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /does not match metadata/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
