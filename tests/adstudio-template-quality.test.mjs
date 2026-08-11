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
  const root = mkdtempSync(join(tmpdir(), "adstudio-customer-quality-"));
  for (const path of ["public/samples", "assets", "out"]) mkdirSync(join(root, path), { recursive: true });
  const sample = join(root, "public/samples/sample.png");
  const photo = join(root, "assets/photo.png");
  const candidate = join(root, "out/candidate.png");
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#1d1" } }).png().toFile(sample);
  await sharp({ create: { width: 30, height: 30, channels: 3, background: "#11d" } }).png().toFile(photo);
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#ddd" } }).png().toFile(candidate);
  const template = {
    id: "one-template",
    dimensions: { width: 100, height: 125 },
    sample: { imageSrc: "/samples/sample.png", contentHash: hash(readFileSync(sample)) },
    sourceAd: { creativeId: "frank-attested-source", contentHash: hash("frank-attested-source") },
    inputs: { images: [{ key: "photo" }], text: [{ key: "headline" }] },
  };
  const templatePath = join(root, "template.json");
  writeFileSync(templatePath, JSON.stringify(template));
  const request = createLockedClonePacket({
    root,
    templateId: template.id,
    request: { prompt: "clone approved sample", aspectRatio: "4:5" },
    copy: { headline: "Customer copy" },
    referencePaths: [
      { key: "approved_sample", role: "approved_sample", path: sample },
      { key: "photo", role: "replacement_asset", path: photo },
    ],
    expectedOutput: candidate,
  });
  const packetPath = join(root, "request.json");
  writeFileSync(packetPath, JSON.stringify(request));
  return { root, templatePath, packetPath, candidate, out: join(root, "quality"), template, request };
}

function review(packet, candidateHash, changes = {}) {
  return { schemaVersion: 1, rubricVersion: "adstudio-subject-invariant-clone-v1", templateId: "one-template", requestHash: packet.requestHash, candidateHash, reviewer: { provider: "test", model: "vision" }, adSystemLikenessScore: 9.5, standaloneAdQualityScore: 9, excludedContentInfluencedScore: false, copyChecks: [{ key: "headline", expected: "Customer copy", observed: "Customer copy", exact: true }], assetChecks: [{ key: "photo", used: true, faithful: true, notes: "used" }], identityLeakage: [], defects: [], includedRationale: "same reusable system", qualityRationale: "polished", suggestedCorrection: "", reviewedAt: "2026-08-09T00:00:00.000Z", ...changes };
}

test("prepares a customer-fixture review against the approved public sample", async () => {
  const item = await fixture();
  const prior = process.cwd(); process.chdir(item.root);
  try {
    const manifest = await prepareReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, out: item.out });
    assert.equal(manifest.stage, "customer_fixture");
    assert.match(manifest.reviewPrompt, /approved public sample/u);
    assert.doesNotMatch(JSON.stringify(manifest), /frank-attested-source|data:|base64/u);
    assert.ok(readFileSync(join(item.out, "sample-vs-customer-candidate.png")).length > 0);
  } finally { process.chdir(prior); }
});

test("requires the candidate named by the locked customer packet", async () => {
  const item = await fixture();
  const other = join(item.root, "out/other.png");
  await sharp({ create: { width: 100, height: 125, channels: 3, background: "#333" } }).png().toFile(other);
  const prior = process.cwd(); process.chdir(item.root);
  try {
    await assert.rejects(() => prepareReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: other, out: item.out }), /expectedOutput/u);
  } finally { process.chdir(prior); }
});

test("records only immutable customer-fixture reviews", async () => {
  const item = await fixture();
  const candidateHash = hash(readFileSync(item.candidate));
  const reviewPath = join(item.root, "review.json");
  writeFileSync(reviewPath, JSON.stringify(review(item.request, candidateHash)));
  const prior = process.cwd(); process.chdir(item.root);
  try {
    const status = await recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out });
    assert.equal(status.passed, true);
    const qa = JSON.parse(readFileSync(join(item.out, "qa.json"), "utf8"));
    assert.equal(qa.stage, "customer_fixture");
    writeFileSync(reviewPath, JSON.stringify(review(item.request, candidateHash, { adSystemLikenessScore: 9.7 })));
    await assert.rejects(() => recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out }), /immutable/u);
  } finally { process.chdir(prior); }
});

test("fails closed when review binding or quality evidence is not exact", async () => {
  const item = await fixture();
  const candidateHash = hash(readFileSync(item.candidate));
  const reviewPath = join(item.root, "review.json");
  const prior = process.cwd(); process.chdir(item.root);
  try {
    writeFileSync(reviewPath, JSON.stringify(review(item.request, "0".repeat(64))));
    await assert.rejects(() => recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: item.out }), /not bound/u);

    for (const [name, changes] of Object.entries({
      copy: { copyChecks: [{ key: "headline", expected: "Customer copy", observed: "Wrong", exact: false }] },
      asset: { assetChecks: [{ key: "photo", used: true, faithful: false, notes: "wrong subject" }] },
      leakage: { identityLeakage: ["identity"] },
      defect: { defects: ["warped text"] },
    })) {
      writeFileSync(reviewPath, JSON.stringify(review(item.request, candidateHash, changes)));
      const status = await recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: join(item.root, `quality-${name}`) });
      assert.equal(status.passed, false, name);
    }

    writeFileSync(reviewPath, JSON.stringify(review(item.request, candidateHash, { excludedContentInfluencedScore: true })));
    await assert.rejects(() => recordReview({ templatePath: item.templatePath, packetPath: item.packetPath, candidatePath: item.candidate, review: reviewPath, out: join(item.root, "quality-excluded") }), /improperly used/u);
  } finally { process.chdir(prior); }
});

test("offers no quality-lock publishing command", () => {
  const source = readFileSync("scripts/adstudio/template-quality.mjs", "utf8");
  const retiredFactoryStage = ["gallery", "sample"].join("_");
  assert.doesNotMatch(source, new RegExp(`publish-lock|publishQualityLock|${retiredFactoryStage}`, "u"));
});
