import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const REPO = join(import.meta.dirname, "..", "..");
const TSC = join(REPO, "node_modules", ".bin", "tsc");
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", timeout: 180000, ...opts });

function findBuildInfo(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      out.push(...findBuildInfo(full));
    } else if (name.endsWith(".tsbuildinfo")) {
      out.push(full);
    }
  }
  return out;
}

describe("release hard-reset + typecheck contracts", () => {
  it("hard-reset static verification passes on the committed tree (fixture corpus is not legacy)", () => {
    const gate = run("node", ["scripts/verify/hard-reset-static.mjs"], { cwd: REPO });
    assert.equal(gate.status, 0, gate.stdout + gate.stderr);
    assert.match(gate.stdout, /Hard-reset static verification passed/);
  });

  it("the canonical typecheck is non-writing: tsc --noEmit --incremental false passes on an unwritable workspace and creates no build-info file", { skip: process.platform === "win32" ? "Windows does not enforce chmod-based unwritable-directory semantics; covered on Linux/VPS." : false }, () => {
    const work = mkdtempSync(join(os.tmpdir(), "adstudio-typecheck-"));
    try {
      writeFileSync(
        join(work, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, noEmit: true, incremental: true }, include: ["a.ts"] }),
      );
      writeFileSync(join(work, "a.ts"), 'export const ok: number = 1;\n');
      // make the whole workspace unwritable — the stale contract (incremental)
      // would try to write tsconfig.tsbuildinfo here and fail
      chmodSync(work, 0o555);
      chmodSync(join(work, "tsconfig.json"), 0o444);
      chmodSync(join(work, "a.ts"), 0o444);
      try {
        // stale contract reproduces the release blocker: incremental tsc tries
        // to write the build-info file into the unwritable workspace
        const unprivileged = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
        const stale = run(TSC, ["--noEmit", "-p", work], { cwd: REPO, ...unprivileged });
        assert.equal(stale.error, undefined, String(stale.error));
        assert.notEqual(stale.status, 0, "stale incremental typecheck must fail on an unwritable workspace");
        assert.match(stale.stderr + stale.stdout, /EACCES|permission denied|tsbuildinfo/i);

        const fixed = run(TSC, ["--noEmit", "--incremental", "false", "-p", work], { cwd: REPO, ...unprivileged });
        assert.equal(fixed.error, undefined, String(fixed.error));
        assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
        assert.deepEqual(findBuildInfo(work), [], "non-incremental typecheck must not create build-info files");
      } finally {
        chmodSync(work, 0o755);
        chmodSync(join(work, "tsconfig.json"), 0o644);
        chmodSync(join(work, "a.ts"), 0o644);
      }
    } finally {
      try {
        chmodSync(work, 0o755);
      } catch { /* already gone */ }
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("the repository pins the non-writing contract (package.json script + tsconfig)", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    assert.equal(pkg.scripts.typecheck, "tsc --noEmit --incremental false");
    const tsconfig = readFileSync(join(REPO, "tsconfig.json"), "utf8");
    assert.match(tsconfig, /"incremental":\s*false/);
  });
});
