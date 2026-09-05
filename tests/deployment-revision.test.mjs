import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const revision = "a".repeat(40);

test("build config embeds only a full Git revision", () => {
  for (const [value, expected] of [[revision, revision], ["", ""], ["not-a-release", ""]]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      'import config from "./next.config.ts"; console.log(JSON.stringify(config.env));'], {
      encoding: "utf8", env: { ...process.env, BLOCKWISE_BUILD_REVISION: value },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).BLOCKWISE_BUILD_REVISION, expected);
  }
});

test("release health check rejects wrong, missing and degraded revisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "blockwise-release-check-"));
  try {
    const envFile = join(dir, "product.env");
    writeFileSync(envFile, [
      "BLOCKWISE_DB_USER=postgres", "BLOCKWISE_DB_NAME=postgres",
      "BLOCKWISE_DB_PASSWORD=fixture", "BLOCKWISE_DB_AUTHENTICATOR_PASSWORD=fixture",
      "BLOCKWISE_PUBLIC_URL=https://blockwise.test", "BLOCKWISE_ENABLE_PROVIDER_WRITES=false",
    ].join("\n"));
    writeFileSync(join(dir, "docker"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(dir, "curl"), "#!/usr/bin/env bash\nprintf '%s' \"$MOCK_HEALTH\" > \"${@: -1}\"\n", { mode: 0o755 });
    const run = (health, expected = revision) => spawnSync("bash", ["scripts/vps/product-health.sh", expected], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, BLOCKWISE_PRODUCT_ENV_FILE: envFile,
        BLOCKWISE_PUBLIC_URL: "https://blockwise.test", MOCK_HEALTH: JSON.stringify(health) },
    });
    const ready = { app: "blockwise", status: "ready", revision };
    assert.equal(run(ready).status, 0);
    assert.notEqual(run({ ...ready, revision: "b".repeat(40) }).status, 0);
    assert.notEqual(run({ app: "blockwise", status: "ready" }).status, 0);
    assert.notEqual(run({ ...ready, status: "degraded" }).status, 0);
    assert.notEqual(run({ ...ready, app: "other" }).status, 0);
    assert.notEqual(run(ready, "not-a-sha").status, 0);
    assert.equal(run({ app: "blockwise", status: "ready" }, "").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
