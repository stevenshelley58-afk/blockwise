import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildRestyleSampleRenderInput, RestyleSampleAssetError } from "../../src/lib/adstudio/v2/restyle-assets.ts";
import { snapshotTemplateBeforeWrite } from "../../src/lib/adstudio/v2/template-history.ts";
import { hashTemplateDoc } from "../../src/lib/adstudio/v2/template-hash.ts";

const fixtureRoot = join(resolve(process.cwd()), "tests", "fixtures", "adstudio-v2");
const fixtureTemplatePath = join(fixtureRoot, "meta-fixture-story", "template.json");
const smokePrep = readFileSync(join(resolve(process.cwd()), "scripts", "adstudio", "v2", "smoke-prep.mjs"), "utf8");
const ingest = readFileSync(join(resolve(process.cwd()), "scripts", "adstudio", "v2", "ingest.mjs"), "utf8");

function fixtureDoc() {
  return JSON.parse(readFileSync(fixtureTemplatePath, "utf8"));
}

test("safe restyle sample binds verified bytes to every declared image input and requires caller copy", () => {
  const temp = mkdtempSync(join(tmpdir(), "adstudio-restyle-assets-"));
  try {
    const doc = fixtureDoc();
    const safeBytes = Buffer.from("generic-safe-photo");
    const safeHash = createHash("sha256").update(safeBytes).digest("hex");
    mkdirSync(join(temp, "public", "safe"), { recursive: true });
    writeFileSync(join(temp, "public", "safe", "photo.png"), safeBytes);
    doc.restyle.safeReplacementAssets = [{ inputKey: "photo", src: "/safe/photo.png", sha256: safeHash }];

    const prepared = buildRestyleSampleRenderInput({
      doc,
      format: "4:5",
      text: { headline: "A generic safe headline" },
      repoRoot: temp,
    });
    assert.deepEqual(prepared.slotBytes.get("photo"), safeBytes);
    assert.deepEqual(prepared.instance.values.images.photo, {
      src: "/safe/photo.png", focal: { x: 0.5, y: 0.5 }, zoom: 1,
    });
    assert.equal(prepared.instance.values.text.headline, "A generic safe headline");

    assert.throws(
      () => buildRestyleSampleRenderInput({ doc, format: "4:5", text: {}, repoRoot: temp }),
      (error: unknown) => error instanceof RestyleSampleAssetError && /caller must provide safe sample copy/.test(error.message),
    );
    doc.restyle.safeReplacementAssets[0].sha256 = "0".repeat(64);
    assert.throws(
      () => buildRestyleSampleRenderInput({ doc, format: "4:5", text: { headline: "Safe" }, repoRoot: temp }),
      (error: unknown) => error instanceof RestyleSampleAssetError && /hash mismatch/.test(error.message),
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("template history snapshots the old canonical document once and never overwrites it", () => {
  const temp = mkdtempSync(join(tmpdir(), "adstudio-template-history-write-"));
  try {
    const previous = fixtureDoc();
    const next = structuredClone(previous);
    next.name = "Changed by a later QA pass";
    writeFileSync(join(temp, "template.json"), `${JSON.stringify(previous, null, 2)}\n`);
    const previousHash = hashTemplateDoc(previous);

    const first = snapshotTemplateBeforeWrite(temp, next);
    assert.deepEqual(first, {
      previousHash,
      path: join(temp, "history", `${previousHash}.json`),
      created: true,
    });
    assert.equal(existsSync(first.path), true);
    assert.equal(hashTemplateDoc(JSON.parse(readFileSync(first.path, "utf8"))), previousHash);

    const second = snapshotTemplateBeforeWrite(temp, next);
    assert.equal(second?.created, false);
    assert.equal(hashTemplateDoc(JSON.parse(readFileSync(first.path, "utf8"))), previousHash, "an existing snapshot remains immutable");
    assert.equal(snapshotTemplateBeforeWrite(temp, previous), null, "same canonical doc does not create a history entry");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("batch helpers cannot manufacture QA or a restyled sample", () => {
  assert.doesNotMatch(smokePrep, /approveTemplate|runBake|runRestyle|writeFileSync/);
  assert.match(smokePrep, /no files changed/);
  assert.doesNotMatch(ingest, /async function restyle/);
  assert.match(ingest, /restyle is intentionally disabled/);
});
