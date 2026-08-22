import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { verifyPinnedFixtureCorpus, FIXTURE_CORPUS_VERSION } from "../../scripts/adstudio/v2/subject-invariance.mjs";

// ---------------------------------------------------------------------------
// Clean-checkout regression for the subject-invariance fixture corpus.
//
// The real-photo QA fixture is a DURABLE, VERSIONED dependency of the builder:
// the committed file public/adstudio-samples/photos/int-bedroom.png must exist
// as a regular file (never a symlink) with the exact pinned byte + pixel
// hashes, so every clean checkout can run the gate at full strength. Candidate
// builds COPY the corpus in; a checkout that is missing the fixture, or a
// candidate root that symlinked it, must fail loudly — not be skipped.
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMITTED_FIXTURE = join(ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png");

function makeRepoCopy() {
  const dir = mkdtempSync(join(os.tmpdir(), "adstudio-fixture-test-"));
  const dest = join(dir, "public", "adstudio-samples", "photos");
  mkdirSync(dest, { recursive: true });
  cpSync(COMMITTED_FIXTURE, join(dest, "int-bedroom.png"));
  return dir;
}

describe("subject-invariance fixture corpus (clean checkout)", () => {
  it("the committed fixture exists as a regular file (not a symlink)", () => {
    const stat = statSync(COMMITTED_FIXTURE);
    assert.ok(stat.isFile(), "fixture must be a regular file");
    assert.ok(!stat.isSymbolicLink(), "fixture must never be a symlink");
  });

  it("verifyPinnedFixtureCorpus resolves the committed corpus at full strength", async () => {
    const result = await verifyPinnedFixtureCorpus(ROOT);
    assert.equal(result.version, FIXTURE_CORPUS_VERSION);
    assert.equal(result.realPhoto.byteSha256.length, 64);
    assert.equal(result.realPhoto.canonicalPixelHash.length, 64);
    assert.equal(result.procedural.length, 3);
    for (const fixture of result.procedural) {
      assert.equal(fixture.canonicalPixelHash.length, 64, `${fixture.id} must have a pinned pixel hash`);
    }
  });

  it("a candidate-style copy (regular files, no symlink) verifies", async () => {
    const dir = makeRepoCopy();
    try {
      const result = await verifyPinnedFixtureCorpus(dir);
      assert.equal(result.realPhoto.path, "public/adstudio-samples/photos/int-bedroom.png");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a checkout MISSING the fixture fails loudly (no weakening)", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "adstudio-fixture-missing-"));
    try {
      await assert.rejects(() => verifyPinnedFixtureCorpus(dir), /ENOENT|fixture/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a tampered fixture fails the byte-hash pin", async () => {
    const dir = makeRepoCopy();
    try {
      const path = join(dir, "public", "adstudio-samples", "photos", "int-bedroom.png");
      const bytes = readFileSync(path);
      writeFileSync(path, bytes.subarray(0, Math.floor(bytes.length / 2)));
      await assert.rejects(() => verifyPinnedFixtureCorpus(dir), /fixture hash mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
