import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

test("template extraction comparison runner renders fixture outputs without provider credentials", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "adstudio-template-extract-"));
  const source = path.join(dir, "source.png");
  const sample = path.join(dir, "sample.png");
  const outDir = path.join(dir, "out");
  writeFileSync(source, ONE_PIXEL_PNG);
  writeFileSync(sample, ONE_PIXEL_PNG);

  execFileSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "scripts/adstudio-compare-template-extraction.mjs",
      "--fixture",
      "--source",
      source,
      "--sample-photo",
      sample,
      "--out-dir",
      outDir,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );

  assert.equal(existsSync(path.join(outDir, "cheap.design.json")), true);
  assert.equal(existsSync(path.join(outDir, "frontier.design.json")), true);
  assert.equal(existsSync(path.join(outDir, "cheap.render.png")), true);
  assert.equal(existsSync(path.join(outDir, "frontier.render.png")), true);
  assert.equal(existsSync(path.join(outDir, "comparison.png")), true);

  const report = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8"));
  assert.equal(report.fixture, true);
  assert.equal(report.results.length, 2);
  assert.deepEqual(report.results.map((result) => result.id), ["cheap", "frontier"]);
  assert.equal(report.results.every((result) => result.ok), true);
  assert.equal(report.results.every((result) => result.report.dimensionsOk), true);
  assert.equal(report.results.every((result) => result.report.imageSlotCount >= 1), true);
});
