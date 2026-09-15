import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const live = "1".repeat(40);
const rollback = "2".repeat(40);
const mounted = "3".repeat(40);
const unused = "4".repeat(40);
const missing = "5".repeat(40);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "blockwise-prune-releases-"));
  const releases = join(root, "releases");
  const source = join(root, "source");
  const bin = join(root, "bin");
  const envFile = join(root, "product.env");
  mkdirSync(releases);
  mkdirSync(source);
  mkdirSync(bin);
  for (const sha of [live, rollback, mounted, unused]) mkdirSync(join(releases, sha));
  const old = new Date(Date.now() - 86_400_000);
  utimesSync(join(releases, unused), old, old);
  writeFileSync(envFile, `BLOCKWISE_GIT_SHA=${live}\nBLOCKWISE_APP_IMAGE=blockwise-app:${rollback}\n`);

  const original = readFileSync("scripts/vps/prune-releases.sh", "utf8");
  const script = original
    .replace(/^readonly CANONICAL_SOURCE=.*$/m, `readonly CANONICAL_SOURCE=${source}`)
    .replace(/^readonly RELEASES=.*$/m, `readonly RELEASES=${releases}`)
    .replace(/^readonly ENV=.*$/m, `readonly ENV=${envFile}`);
  const scriptPath = join(root, "prune-releases.sh");
  writeFileSync(scriptPath, script, { mode: 0o755 });

  writeFileSync(join(bin, "git"), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ " $* " == *" worktree list --porcelain "* ]]; then exit 0; fi
echo "unexpected git invocation: $*" >&2
exit 1
`, { mode: 0o755 });
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == inspect && "$2" == blockwise-product-product-app-1 ]]; then exit 1; fi
if [[ "$1" == ps && "$2" == -aq ]]; then printf 'running-container\\nstopped-container\\n'; exit 0; fi
if [[ "\${MOCK_INSPECT_FAIL:-}" == true && "$1" == inspect && "$2" == --format ]]; then exit 1; fi
if [[ "$1" == inspect && "$2" == --format ]]; then printf '%s\\n' "$MOCK_MOUNT"; exit 0; fi
if [[ "$1" == image && "$2" == ls ]]; then exit 0; fi
echo "unexpected docker invocation: $*" >&2
exit 1
`, { mode: 0o755 });

  const run = (mountSha, inspectFail = false) => spawnSync("bash", [scriptPath, "--keep", "1"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MOCK_MOUNT: join(releases, mountSha, "infra/product/Caddyfile"),
      MOCK_INSPECT_FAIL: String(inspectFail),
    },
  });
  return { root, run };
}

test("release pruning retains container-mounted release source", () => {
  const { root, run } = fixture();
  try {
    const result = run(mounted);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`would remove ${unused.slice(0, 12)}`));
    assert.doesNotMatch(result.stdout, new RegExp(`would remove ${mounted.slice(0, 12)}`));
    assert.match(result.stdout, /1 container-mounted release\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release pruning fails closed when a container mount source is already missing", () => {
  const { root, run } = fixture();
  try {
    const result = run(missing);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`container references missing release ${missing}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release pruning fails closed when Docker cannot inspect every container", () => {
  const { root, run } = fixture();
  try {
    const result = run(mounted, true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not inspect every Docker container; refusing to prune/);
    assert.doesNotMatch(result.stdout, /would remove/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
