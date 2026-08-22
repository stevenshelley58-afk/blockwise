import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  FIXTURE_CORPUS_VERSION,
  SUBJECT_INVARIANCE_RUBRIC_VERSION,
  buildProceduralFixture,
  computeAlignedLeakageMetrics,
  computeDifferenceMetrics,
  computeNeutralAnalyticMetrics,
  runSubjectInvariance,
} from "../../scripts/adstudio/v2/subject-invariance.mjs";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const galleryRoot = join(repoRoot, "src/lib/adstudio/template-gallery-v2");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bindingFromReport(templateBytes, doc, report) {
  return {
    templateSha256: sha256(templateBytes),
    sourceSha256: report.source.sha256,
    sampleSha256: doc.provenance.sample.contentHash,
    staticAssets: Object.fromEntries(Object.entries(doc.formats).map(([format, layout]) => [
      format,
      [
        { id: "plate", sha256: layout.plate.sha256 },
        ...layout.layers
          .filter((layer) => layer.type === "overlay_patch")
          .map((layer) => ({ id: layer.id, sha256: layer.sha256 })),
      ],
    ])),
    fixtureCorpus: report.fixtureCorpus.fixtures.map((fixture) => ({
      id: fixture.id,
      sourceByteHash: fixture.sourceByteHash,
      canonicalPixelHash: fixture.canonicalPixelHash,
    })),
    sourcePixelIsolation: report.adSystemLikeness.sourcePixelIsolation.assetReports.map((asset) => ({
      layout: asset.layout,
      assetId: asset.assetId,
      sha256: asset.sha256,
      status: asset.status,
      hardFail: asset.hardFail,
    })),
    fixtureDifferenceEvidence: report.adSystemLikeness.fixtureDifferenceEvidence.map((entry) => ({
      layout: entry.layout,
      firstFixture: entry.firstFixture,
      secondFixture: entry.secondFixture,
      changedOutsideBoxes: entry.changedOutsideBoxes,
      outsideDependencyPassed: entry.outsideDependencyPassed,
    })),
    gatePassed: report.gate.passed,
  };
}

function rgba(width, height, rgb) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    pixels[offset] = rgb[0];
    pixels[offset + 1] = rgb[1];
    pixels[offset + 2] = rgb[2];
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function detailedSource(width, height) {
  const pixels = rgba(width, height, [240, 240, 240]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = (x * 29 + y * 47 + ((x + y) % 7) * 31) % 256;
      pixels[offset] = value;
      pixels[offset + 1] = (value * 3) % 256;
      pixels[offset + 2] = (255 - value);
    }
  }
  return pixels;
}

test("subject-invariance fixtures are deterministic raw pixels", () => {
  for (const id of ["mid-grey", "grid-gradient", "neutral-logo"]) {
    const first = buildProceduralFixture(id);
    const second = buildProceduralFixture(id);
    assert.equal(first.width, second.width);
    assert.equal(first.height, second.height);
    assert.ok(first.data.equals(second.data), `${id} changed between builds`);
  }
});

test("source leakage detector fails an aligned source-derived asset", () => {
  const width = 80;
  const height = 60;
  const source = detailedSource(width, height);
  const metrics = computeAlignedLeakageMetrics(source, Buffer.from(source), width, height, [
    { left: 2, top: 2, right: 78, bottom: 58 },
  ], { requiredEdgeSamples: 100 });
  assert.equal(metrics.hardFail, true);
  assert.equal(metrics.matchingEdgeFraction, 1);
  assert.ok(metrics.exactSourcePixels > 4_000);
});

test("source leakage detector ignores a neutral source-independent asset", () => {
  const width = 80;
  const height = 60;
  const source = detailedSource(width, height);
  const neutral = rgba(width, height, [128, 128, 128]);
  const metrics = computeAlignedLeakageMetrics(source, neutral, width, height, [
    { left: 2, top: 2, right: 78, bottom: 58 },
  ], { requiredEdgeSamples: 100 });
  assert.equal(metrics.hardFail, false);
  assert.equal(metrics.matchingEdges, 0);
});

test("neutral/analytic fallback rejects photo-like static pixels", () => {
  const width = 80;
  const height = 60;
  const photoLike = detailedSource(width, height);
  const metrics = computeNeutralAnalyticMetrics(photoLike, width, height, [
    { left: 2, top: 2, right: 78, bottom: 58 },
  ]);
  assert.equal(metrics.hardFail, true);
  assert.ok(metrics.highChromaFraction > metrics.thresholds.maxHighChromaFraction);
});

test("neutral/analytic fallback accepts a source-independent white field", () => {
  const width = 80;
  const height = 60;
  const neutral = rgba(width, height, [250, 250, 250]);
  const metrics = computeNeutralAnalyticMetrics(neutral, width, height, [
    { left: 2, top: 2, right: 78, bottom: 58 },
  ]);
  assert.equal(metrics.hardFail, false);
  assert.equal(metrics.highChromaPixels, 0);
  assert.equal(metrics.highDetailPixels, 0);
  assert.equal(metrics.luminanceStdDev, 0);
});

test("fixture differences are split into live-slot and outside-slot evidence", () => {
  const width = 20;
  const height = 10;
  const first = rgba(width, height, [0, 0, 0]);
  const second = Buffer.from(first);
  const change = (x, y) => {
    const offset = (y * width + x) * 4;
    second[offset] = 255;
  };
  change(3, 3);
  change(4, 3);
  change(18, 8);
  const metrics = computeDifferenceMetrics(first, second, width, height, [
    { left: 2, top: 2, right: 8, bottom: 7 },
  ]);
  assert.equal(metrics.changedPixels, 3);
  assert.equal(metrics.changedInsideBoxes, 2);
  assert.equal(metrics.changedOutsideBoxes, 1);
  assert.deepEqual(metrics.bounds, { left: 3, top: 3, right: 19, bottom: 9 });
  assert.deepEqual(metrics.outsideBounds, { left: 18, top: 8, right: 19, bottom: 9 });
});

test("committed subject-invariance bindings match fresh renders or fail closed without private sources", async () => {
  const entries = await readdir(galleryRoot, { withFileTypes: true });
  let checked = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templateId = entry.name;
    const templatePath = join(galleryRoot, templateId, "template.json");
    const evidencePath = join(galleryRoot, templateId, "evidence.json");
    let templateBytes;
    let evidence;
    try {
      [templateBytes, evidence] = await Promise.all([
        readFile(templatePath),
        readFile(evidencePath, "utf8").then(JSON.parse),
      ]);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!evidence.subjectInvariance?.binding) continue;
    checked += 1;
    const doc = JSON.parse(templateBytes.toString("utf8"));
    const outputDir = await mkdtemp(join(tmpdir(), `adstudio-subject-invariance-${templateId}-`));
    try {
      const sourceFile = doc.provenance?.sourceAd?.file;
      if (sourceFile && !existsSync(resolve(repoRoot, sourceFile))) {
        await assert.rejects(
          runSubjectInvariance({ repoRoot, templateId, outDir: outputDir }),
          (error) => error?.code === "ENOENT",
          `${templateId}: missing private source must fail closed`,
        );
        continue;
      }
      const { report } = await runSubjectInvariance({ repoRoot, templateId, outDir: outputDir });
      assert.equal(report.gate.passed, true, `${templateId}: ${report.gate.blockers.join("; ")}`);
      assert.equal(evidence.subjectInvariance.rubricVersion, SUBJECT_INVARIANCE_RUBRIC_VERSION);
      assert.equal(evidence.subjectInvariance.fixtureCorpusVersion, FIXTURE_CORPUS_VERSION);
      assert.deepEqual(
        evidence.subjectInvariance.binding,
        bindingFromReport(templateBytes, doc, report),
        `${templateId}: committed subject-invariance binding is stale`,
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
  assert.ok(checked > 0, "no template has committed subject-invariance evidence");
});
