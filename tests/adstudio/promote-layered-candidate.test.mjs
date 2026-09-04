import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { assertLayeredEvidence, sourceFreeSampleEvidence } from "../../scripts/adstudio/v2/promote-layered-candidate.mjs";
import { appendGeneration, createGenerationTrace } from "../../scripts/adstudio/v2/generation-trace.mjs";
import { fidelityTemplateHash } from "../../src/lib/adstudio/v2/fidelity-stress.ts";
import { hashCanonicalJson } from "../../src/lib/adstudio/v2/template-hash.ts";

const sha = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const sample = Buffer.from("feed-sample");
  const story = Buffer.from("story-sample");
  const doc = {
    exactness: { status: "qa", bakedTextKeys: [], residuals: {} },
    provenance: {
      sourceAd: { contentHash: "a".repeat(64) },
      sample: { contentHash: sha(sample) },
      storySample: { contentHash: sha(story) },
    },
  };
  const trace = appendGeneration(createGenerationTrace({ templateId: "meta-feed-006", sourceSha256: doc.provenance.sourceAd.contentHash }), {
    feedSha256: doc.provenance.sample.contentHash,
    storySha256: doc.provenance.storySample.contentHash,
    renderSetSha256: "d".repeat(64),
    primaryReviewer: "primary:v2",
    strictReviewer: "strict:v2",
    primaryScore: 9.8,
    strictScore: 9.6,
    revisionReason: "Both independent reviewers accepted the current renders",
  });
  return {
    doc,
    evidence: { templateSha256: hashCanonicalJson(doc), restyle: { sourceFree: true, noWholeAdImageModel: true } },
    trace,
    subjectInvariance: { schema: "adstudio.subject-invariance.evidence.v1", templateId: "meta-feed-006", templateHash: hashCanonicalJson(doc), templateIdentityHash: fidelityTemplateHash(doc), gate: { passed: true } },
    approval: { decision: "approved", receipt_ref: "hermes://receipts/approved-test" },
    reviewerRef: "frank-hermes-review",
    templateBytes: Buffer.from(JSON.stringify(doc)),
    sampleBytes: sample,
    storySampleBytes: story,
  };
}

describe("source-free layered candidate promotion", () => {
  it("executes through the builder symlink and fails closed without a candidate", () => {
    const root = mkdtempSync(join(os.tmpdir(), "adstudio-promote-link-test-"));
    const linkedDir = join(root, "v2");
    const sourceDir = fileURLToPath(new URL("../../scripts/adstudio/v2/", import.meta.url));
    symlinkSync(sourceDir, linkedDir, process.platform === "win32" ? "junction" : "dir");
    try {
      const result = spawnSync(process.execPath, [join(linkedDir, "promote-layered-candidate.mjs")], {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--candidate is required/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only current dual-review, subject-invariance, and sample-bound evidence", () => {
    const result = assertLayeredEvidence({ templateId: "meta-feed-006", ...fixture() });
    assert.equal(result.templateHash, fidelityTemplateHash(fixture().doc));
  });

  it("fails closed when the accepted generation is not bound to both samples", () => {
    const input = fixture();
    input.trace = { ...input.trace, status: "active" };
    assert.throws(() => assertLayeredEvidence({ templateId: "meta-feed-006", ...input }), /trace status|accepted generation trace/);
  });

  it("replaces private source copy with an exact public sample manifest", () => {
    const doc = { inputs: { text: [
      { key: "headline", sample: "Find your next home" },
      { key: "cta", sample: "Book a viewing" },
    ] } };
    const result = sourceFreeSampleEvidence(doc, {
      sourceValues: { headline: "PRIVATE OCR", cta: "PRIVATE CTA" },
      restyle: { sourceFree: true },
    });
    assert.deepEqual(result.sampleValues, { headline: "Find your next home", cta: "Book a viewing" });
    assert.equal(Object.hasOwn(result.safeEvidence, "sourceValues"), false);
    assert.deepEqual(result.safeEvidence.restyle, { sourceFree: true });
  });
});
