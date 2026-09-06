import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * `file:` dependencies that point at a missing directory do not fail `npm install` —
 * npm creates a dangling symlink and the package only fails later at import time.
 * Frank shipped two such phantom deps against renamed packages, so assert every
 * declared local link resolves to a real package of the right name.
 */
const manifests = [
  "frank/template-factory/package.json",
  "packages/ad-template-renderer/package.json",
];

test("local file: dependencies resolve to real packages", async () => {
  for (const manifest of manifests) {
    const manifestPath = resolve(root, manifest);
    const pkg = JSON.parse(await readFile(manifestPath, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const links = Object.entries(deps).filter(([, spec]) => spec.startsWith("file:"));
    assert.ok(links.length > 0, `${manifest} declares no file: dependencies`);

    for (const [name, spec] of links) {
      const target = resolve(dirname(manifestPath), spec.slice("file:".length));
      assert.ok(existsSync(target), `${manifest}: ${name} -> ${spec} (missing directory)`);
      const linked = JSON.parse(await readFile(resolve(target, "package.json"), "utf8"));
      assert.equal(linked.name, name, `${manifest}: ${spec} declares name ${linked.name}`);
    }
  }
});
