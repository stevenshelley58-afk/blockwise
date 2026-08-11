import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

import { createLockedClonePacket } from "../scripts/adstudio/local-template-adapter.mjs";
import { prepareReview, recordReview } from "../scripts/adstudio/template-quality.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "adstudio-quality-"));
  for (const path of ["factory-private", "public/samples", "assets", "out"]) mkdirSync(join(root, path), { recursive: true });
  const source = join(root, "factory-private/source.png");
  const sample = join(root, "public/samples/sample.png");
  const photo = join(root, "assets/photo.png");
  const candidate = join(root, "out/candidate.png");
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#d11" } }).png().toFile(source);
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#1d1" } }).png().toFile(sample);
  await sharp({ create: { width: 30, height: 30, channels: 3, background: "#11d" } }).png().toFile(photo);
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#ddd" } }).png().toFile(candidate);
  const template = { id: "one-template", dimensions: { width: 100, height: 125 }, sample: { imageSrc: "/samples/sample.png", contentHash: hash(readFileSync(sample)) }, sourceAd: { file: "source.png", contentHash: hash(readFileSync(source)) }, inputs: { images: [], text: [] } };
  const templatePath = join(root, "template.json"); writeFileSync(templatePath, JSON.stringify(template));
  const packet = createLockedClonePacket({ root, templateId: template.id, request: { prompt: "clone", aspectRatio: "4:5" }, copy: {}, referencePaths: [{ key: "source", role: "source", path: source }, { key: "photo", role: "replacement_asset", path: photo }], expectedOutput: candidate });
  const packetPath = join(root, "request.json"); writeFileSync(packetPath, JSON.stringify(packet));
  return { root, templatePath, packetPath, candidate, out: join(root, "quality"), sample, photo, template };
}

function review(packet, candidateHash, changes = {}) {
  return { schemaVersion: 1, rubricVersion: "adstudio-subject-invariant-clone-v1", templateId: "one-template", requestHash: packet.requestHash, candidateHash, reviewer: { provider: "test", model: "vision" }, adSystemLikenessScore: 9.5, standaloneAdQualityScore: 9, excludedContentInfluencedScore: false, copyChecks: [], assetChecks: [{ key: "photo", used: true, faithful: true, notes: "used" }], identityLeakage: [], defects: [], includedRationale: "same reusable system", qualityRationale: "polished", suggestedCorrection: "", reviewedAt: "2026-08-09T00:00:00.000Z", ...changes };
}

test("prepares one locked template review packet and contact sheet", async () => {
  const item = await fixture();
  const prior = process.cwd(); process.chdir(item.root);
  try {
    const manifest = await prepareReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, out: item.out });
    assert.equal(manifest.templateId, "one-template");
    assert.match(manifest.reviewPrompt, /replaceable customer subject/u);
    assert.ok(readFileSync(join(item.out, "source-vs-candidate.png")).length > 0);
  } finally { process.chdir(prior); }
});

test("prepares a customer-fixture review against the approved public sample", async () => {
  const item = await fixture();
  const packet = createLockedClonePacket({
    root: item.root,
    stage: "customer_fixture",
    templateId: item.template.id,
    request: { prompt: "clone approved sample", aspectRatio: "4:5" },
    copy: {},
    referencePaths: [
      { key: "approved_sample", role: "approved_sample", path: item.sample },
      { key: "photo", role: "replacement_asset", path: item.photo },
    ],
    expectedOutput: item.candidate,
  });
  writeFileSync(item.packetPath, JSON.stringify(packet));
  const prior = process.cwd(); process.chdir(item.root);
  try {
    const manifest = await prepareReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, out: item.out });
    assert.equal(manifest.stage, "customer_fixture");
    assert.match(manifest.reviewPrompt, /approved public sample/u);
    assert.equal(manifest.paths.source, null);
    assert.ok(readFileSync(join(item.out, "sample-vs-customer-candidate.png")).length > 0);
  } finally { process.chdir(prior); }
});

test("requires the candidate named by the locked packet", async () => {
  const item = await fixture();
  const other = join(item.root, "out/other.png");
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#333" } }).png().toFile(other);
  const prior = process.cwd(); process.chdir(item.root);
  try {
    await assert.rejects(() => prepareReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: other, out: item.out }), /expectedOutput/u);
  } finally { process.chdir(prior); }
});

test("records only immutable, passing reviews", async () => {
  const item = await fixture(); const packet = JSON.parse(readFileSync(item.packetPath)); const candidateHash = hash(readFileSync(item.candidate));
  const reviewPath = join(item.root, "review.json"); writeFileSync(reviewPath, JSON.stringify(review(packet, candidateHash)));
  const prior = process.cwd(); process.chdir(item.root);
  try {
    const status = await recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out });
    assert.equal(status.passed, true);
    const qa = JSON.parse(readFileSync(join(item.out, "qa.json"), "utf8"));
    assert.equal(qa.visualReview.candidateHash, candidateHash);
    assert.equal(qa.assetChecks[0].key, "photo");
    writeFileSync(reviewPath, JSON.stringify(review(packet, candidateHash, { adSystemLikenessScore: 9.7 })));
    await assert.rejects(() => recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out }), /immutable/u);
  } finally { process.chdir(prior); }
});

test("rejects excluded-content scoring and retains a failing correction", async () => {
  const item = await fixture(); const packet = JSON.parse(readFileSync(item.packetPath)); const candidateHash = hash(readFileSync(item.candidate)); const reviewPath = join(item.root, "review.json");
  const prior = process.cwd(); process.chdir(item.root);
  try {
    writeFileSync(reviewPath, JSON.stringify(review(packet, candidateHash, { excludedContentInfluencedScore: true })));
    await assert.rejects(() => recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out }), /excluded content/u);
    writeFileSync(reviewPath, JSON.stringify(review(packet, candidateHash, { adSystemLikenessScore: 9.4, suggestedCorrection: "Match the CTA geometry." })));
    const status = await recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out });
    assert.equal(status.passed, false); assert.equal(status.suggestedCorrection, "Match the CTA geometry.");
  } finally { process.chdir(prior); }
});

test("preserves failed copy and asset findings as iteration evidence", async () => {
  const item = await fixture(); const packet = JSON.parse(readFileSync(item.packetPath)); const candidateHash = hash(readFileSync(item.candidate)); const reviewPath = join(item.root, "review.json");
  writeFileSync(reviewPath, JSON.stringify(review(packet, candidateHash, {
    copyChecks: [{ key: "headline", expected: "Expected", observed: "Wrong", exact: false }],
    assetChecks: [{ key: "photo", used: true, faithful: false, notes: "cropped incorrectly" }],
    suggestedCorrection: "Fix the copy and crop.",
  })));
  const prior = process.cwd(); process.chdir(item.root);
  try {
    const status = await recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out });
    assert.equal(status.passed, false);
    const qa = JSON.parse(readFileSync(join(item.out, "qa.json"), "utf8"));
    assert.equal(qa.copyChecks[0].exact, false);
    assert.equal(qa.assetChecks[0].faithful, false);
  } finally { process.chdir(prior); }
});
