import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("portable release publication", () => {
  it("publishes only the signed pack/assets tree under the canonical Frank URL", () => {
    const source = readFileSync(join(ROOT, "scripts/adstudio/v2/pack-release.mjs"), "utf8");
    assert.match(source, /FRANK_PUBLIC_RELEASE_ROOT/);
    assert.match(source, /https:\/\/frank\.fail\/releases\/ad-template-generator/);
    assert.match(source, /pack-v2/);
    assert.match(source, /copyFileSync\(join\(releaseDir, artifact\.packFile\)/);
    assert.doesNotMatch(source, /copyFileSync\(join\(templatesDir/);
    assert.match(source, /join\(REPO_ROOT, "public", "adstudio-samples", "photos", "int-bedroom\.png"\)/);
    assert.doesNotMatch(source, /join\(REPO_ROOT, "tests", "fixtures", "adstudio-v2", "public", "slots", "photo-portrait\.png"\)/);
  });

  it("pins the default release customer-photo fixture to the committed safe real photo", () => {
    const builder = readFileSync(join(ROOT, "scripts/adstudio/v2/variant-pack.mjs"), "utf8");
    const release = readFileSync(join(ROOT, "scripts/adstudio/v2/pack-release.mjs"), "utf8");
    const safePhoto = join(ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png");
    assert.ok(sha256(readFileSync(safePhoto)).length === 64);
    assert.match(builder, /join\(REPO_ROOT, "public", "adstudio-samples", "photos", "int-bedroom\.png"\)/);
    assert.match(release, /join\(REPO_ROOT, "public", "adstudio-samples", "photos", "int-bedroom\.png"\)/);
  });
});
