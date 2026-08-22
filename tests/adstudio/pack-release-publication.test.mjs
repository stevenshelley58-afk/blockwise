import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("portable release publication", () => {
  it("publishes only the signed pack/assets tree under the canonical Frank URL", () => {
    const source = readFileSync(join(ROOT, "scripts/adstudio/v2/pack-release.mjs"), "utf8");
    assert.match(source, /FRANK_PUBLIC_RELEASE_ROOT/);
    assert.match(source, /https:\/\/frank\.fail\/releases\/ad-template-generator/);
    assert.match(source, /pack-v2/);
    assert.match(source, /copyFileSync\(join\(releaseDir, artifact\.packFile\)/);
    assert.doesNotMatch(source, /copyFileSync\(join\(templatesDir/);
  });
});
