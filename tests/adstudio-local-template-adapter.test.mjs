import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MIN_AD_SYSTEM_LIKENESS,
  MIN_STANDALONE_AD_QUALITY,
  SUBJECT_INVARIANT_RUBRIC_VERSION,
  createLockedClonePacket,
  localAuditEvidence,
  validateLocalQaEvidence,
  verifyLockedClonePacket,
} from "../scripts/adstudio/local-template-adapter.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "adstudio-local-adapter-"));
  mkdirSync(join(root, "factory-private"));
  mkdirSync(join(root, "assets"));
  const source = join(root, "factory-private", "source.png");
  const photo = join(root, "assets", "photo.png");
  writeFileSync(source, "source-image");
  writeFileSync(photo, "replacement-photo");
  const template = {
    id: "meta-local-test",
    inputs: {
      images: [{ key: "property_photo", label: "Property photo", required: true }],
      text: [{ key: "headline", label: "Headline", required: true }],
    },
  };
  const packet = createLockedClonePacket({
    root,
    templateId: template.id,
    request: {
      prompt: "Clone the source.",
      negativePrompt: "No source identity.",
      aspectRatio: "4:5",
      seed: 4,
    },
    copy: { headline: "Request your appraisal" },
    referencePaths: [
      { key: "source", role: "source", path: source },
      { key: "property_photo", role: "replacement", path: photo },
    ],
    expectedOutput: join(root, "public", "sample.png"),
  });
  const qa = {
    schemaVersion: 1,
    templateId: template.id,
    requestHash: packet.requestHash,
    passed: true,
    fullSizeReviewed: true,
    contractReview: { passed: true },
    requestIntegrity: { passed: true },
    copyChecks: [{ key: "headline", expected: "Request your appraisal", exact: true }],
    assetChecks: [{ key: "property_photo", used: true, faithful: true }],
    identityLeakage: [],
    defects: [],
    correctionCount: 0,
    reviewedAt: "2026-07-15T00:00:00.000Z",
    outputHash: "f".repeat(64),
    visualReview: {
      rubricVersion: SUBJECT_INVARIANT_RUBRIC_VERSION,
      requestHash: packet.requestHash,
      candidateHash: "f".repeat(64),
      reviewer: { provider: "google", model: "gemini-2.5-flash" },
      adSystemLikenessScore: 9.6,
      standaloneAdQualityScore: 9.2,
      excludedContentInfluencedScore: false,
      includedRationale: "The reusable geometry, type treatment, effects, and anchors match.",
      qualityRationale: "The finished ad is clear, balanced, legible, and polished.",
      suggestedCorrection: "",
      reviewedAt: "2026-07-15T00:00:00.000Z",
    },
  };
  return { root, source, photo, template, packet, qa };
}

test("locks the clone request and contractual reference order", () => {
  const { root, packet } = fixture();
  assert.equal(packet.stage, "gallery_sample");
  assert.equal(packet.references[0].role, "source");
  assert.equal(packet.references[1].key, "property_photo");
  assert.doesNotThrow(() => verifyLockedClonePacket(packet, { root }));
});

test("accepts only declared packet transports", () => {
  const { root, source, template } = fixture();
  assert.throws(() => createLockedClonePacket({
    root,
    templateId: template.id,
    executionTransport: "untrusted_transport",
    request: { prompt: "Clone", aspectRatio: "4:5" },
    copy: {},
    referencePaths: [{ key: "source", role: "source", path: source }],
    expectedOutput: join(root, "public", "sample.png"),
  }), /execution transport is invalid/u);
});

test("locks customer fixtures to an approved-sample reference", () => {
  const { root, photo, template } = fixture();
  const sample = join(root, "public", "sample.png");
  mkdirSync(join(root, "public"), { recursive: true });
  writeFileSync(sample, "approved-sample");
  const packet = createLockedClonePacket({
    root,
    stage: "customer_fixture",
    templateId: template.id,
    request: { prompt: "Clone the approved sample.", aspectRatio: "4:5" },
    copy: { headline: "Different customer copy" },
    referencePaths: [
      { key: "approved_sample", role: "approved_sample", path: sample },
      { key: "property_photo", role: "replacement_asset", path: photo },
    ],
    expectedOutput: join(root, "artifacts", "customer.png"),
  });
  assert.equal(verifyLockedClonePacket(packet, { root }).stage, "customer_fixture");
  packet.references[0].role = "source";
  assert.throws(() => verifyLockedClonePacket(packet, { root }), /changed after export|approved public sample/u);
});

test("rejects a changed reference after export", () => {
  const { root, photo, packet } = fixture();
  writeFileSync(photo, "changed-photo");
  assert.throws(() => verifyLockedClonePacket(packet, { root }), /changed after export/u);
});

test("rejects incomplete local QA evidence", () => {
  const { template, packet, qa } = fixture();
  assert.doesNotThrow(() => validateLocalQaEvidence({ template, packet, qa, outputHash: "f".repeat(64) }));
  assert.throws(
    () => validateLocalQaEvidence({ template, packet, qa: { ...qa, fullSizeReviewed: false }, outputHash: "f".repeat(64) }),
    /full-size review/u,
  );
  assert.throws(
    () => validateLocalQaEvidence({ template, packet, qa, outputHash: "e".repeat(64) }),
    /reviewed output image/u,
  );
  assert.throws(
    () => validateLocalQaEvidence({
      template,
      packet,
      qa: { ...qa, visualReview: { ...qa.visualReview, adSystemLikenessScore: MIN_AD_SYSTEM_LIKENESS - 0.1 } },
      outputHash: "f".repeat(64),
    }),
    /likeness must be at least 9\.5/u,
  );
  assert.throws(
    () => validateLocalQaEvidence({
      template,
      packet,
      qa: { ...qa, visualReview: { ...qa.visualReview, standaloneAdQualityScore: MIN_STANDALONE_AD_QUALITY - 0.1 } },
      outputHash: "f".repeat(64),
    }),
    /quality must be at least 9/u,
  );
  assert.throws(
    () => validateLocalQaEvidence({
      template,
      packet,
      qa: { ...qa, visualReview: { ...qa.visualReview, candidateHash: "e".repeat(64) } },
      outputHash: "f".repeat(64),
    }),
    /not bound to this request and candidate/u,
  );
});

test("emits audit evidence without copying private image bytes", () => {
  const { source, template, packet, qa } = fixture();
  const evidence = localAuditEvidence({ template, packet, qa, outputHash: "f".repeat(64) });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.outputHash, "f".repeat(64));
  assert.equal(evidence.inputs[0].path, "factory-private/source.png");
  assert.equal(evidence.request.prompt, "Clone the source.");
  assert.equal(evidence.qa.visualReview.adSystemLikenessScore, 9.6);
  assert.equal(serialized.includes(readFileSync(source, "utf8")), false);
});
