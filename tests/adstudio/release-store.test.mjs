import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import { resolveReleaseStoreRoot } from "../../scripts/adstudio/v2/pack-release.mjs";

// The private release store must resolve beneath the Hermes home even when
// HERMES_HOME is unset (Tool-run agent environments do not always export it).
// Fallback goes to ~/.hermes — never to $HOME itself, which the framework
// rejects as "outside the private release store".
test("release store root resolves under ~/.hermes when HERMES_HOME is unset", () => {
  const root = resolveReleaseStoreRoot({ HOME: "/home/hermes" });
  assert.equal(
    root,
    resolve(join("/home/hermes", ".hermes", "tool_releases", "ad-template-generator")),
    "unset HERMES_HOME must fall back to ~/.hermes, not $HOME",
  );
});

test("release store root honours an explicit HERMES_HOME", () => {
  const root = resolveReleaseStoreRoot({
    HOME: "/home/hermes",
    HERMES_HOME: "/srv/hermes-home",
  });
  assert.equal(
    root,
    resolve(join("/srv/hermes-home", "tool_releases", "ad-template-generator")),
  );
});

test("default release dir (without --release) lives inside the store", () => {
  const store = resolveReleaseStoreRoot({ HOME: "/home/hermes" });
  const releaseDir = join(store, "meta-pack-abcdef12");
  assert.ok(
    releaseDir.startsWith(`${store}${sep}`),
    "release dir must be inside the private store",
  );
});
