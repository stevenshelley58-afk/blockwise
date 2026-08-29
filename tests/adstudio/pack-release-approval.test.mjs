import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import { assertCandidateEvidence, readApprovalReceipt } from "../../scripts/adstudio/v2/pack-release.mjs";
import { hashCanonicalJson } from "../../src/lib/adstudio/v2/template-hash.ts";
import { appendGeneration, createGenerationTrace } from "../../scripts/adstudio/v2/generation-trace.mjs";

describe("layered TemplatePack release approval", () => {
  it("refuses a missing or pending approval receipt", () => {
    assert.throws(() => readApprovalReceipt(null), /--approval is required/);

    const root = mkdtempSync(join(os.tmpdir(), "adstudio-approval-test-"));
    try {
      const pending = join(root, "pending.json");
      writeFileSync(pending, JSON.stringify({
        decision: "pending",
        gate: "native-pixel-human-approval",
        receipt_ref: "hermes://receipts/pending",
        decided_at: "2026-08-29T00:00:00.000Z",
      }));
      assert.throws(() => readApprovalReceipt(pending), /decision must be approved/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns only the sanitized native-pixel approval envelope", () => {
    const root = mkdtempSync(join(os.tmpdir(), "adstudio-approval-test-"));
    try {
      const path = join(root, "approved.json");
      writeFileSync(path, JSON.stringify({
        decision: "approved",
        gate: "native-pixel-human-approval",
        receipt_ref: "hermes://receipts/approved-20-pack",
        decided_at: "2026-08-29T00:00:00.000Z",
        reviewer: "must-not-leak",
      }));
      assert.deepEqual(readApprovalReceipt(path), {
        decision: "approved",
        gate: "native-pixel-human-approval",
        receipt_ref: "hermes://receipts/approved-20-pack",
        decided_at: "2026-08-29T00:00:00.000Z",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for draft, stale-template, and stale-review evidence", () => {
    const hash = "a".repeat(64);
    const doc = {
      exactness: { status: "ready", bakedTextKeys: [], residuals: {} },
      provenance: {
        sourceAd: { contentHash: hash },
        sample: { contentHash: "b".repeat(64) },
        storySample: { contentHash: "c".repeat(64) },
      },
    };
    const fidelityHash = hashCanonicalJson({ ...doc, exactness: { bakedTextKeys: [] } });
    const residual = {
      templateHash: fidelityHash,
      outside: { differingPixels: 0 },
    };
    const entries = Array.from({ length: 10 }, (_, index) => ({
      format: index < 5 ? "4:5" : "9:16",
      scenario: ["longest-copy", "one-character-copy", "minimum-resolution", "all-portrait", "all-landscape"][index % 5],
      renderHash: hash,
    }));
    const stress = {
      templateHash: fidelityHash,
      entries,
      matrixHash: hashCanonicalJson({ templateHash: fidelityHash, entries }),
    };
    doc.exactness.residualEvidence = residual;
    doc.exactness.stressEvidence = stress;
    doc.exactness.reviewEvidence = {
      templateHash: fidelityHash,
      sourceContentHash: hash,
      sampleContentHash: "b".repeat(64),
      fidelityEvidenceHash: hashCanonicalJson(residual),
      stressEvidenceHash: hashCanonicalJson(stress),
    };
    const templateBytes = Buffer.from(JSON.stringify(doc));
    const evidence = {
      templateSha256: hashCanonicalJson(doc),
      restyle: { sourceFree: true, noWholeAdImageModel: true },
      generationTrace: appendGeneration(
        createGenerationTrace({ templateId: "fixture", sourceSha256: hash }),
        {
          feedSha256: "b".repeat(64), storySha256: "c".repeat(64), renderSetSha256: "d".repeat(64),
          primaryReviewer: "vision-primary-v1", strictReviewer: "vision-strict-v1",
          primaryScore: 9.8, strictScore: 9.6,
          revisionReason: "Both independent reviewers accepted the current render",
        },
      ),
      qa: {
        feedPassed: true,
        storyPassed: true,
        stressFixtureResults: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`case-${index}`, { passed: true }])),
      },
    };
    assertCandidateEvidence({ templateId: "fixture", doc, evidence, templateBytes });

    assert.throws(() => assertCandidateEvidence({
      templateId: "fixture",
      doc: { ...doc, exactness: { ...doc.exactness, status: "qa" } },
      evidence,
      templateBytes,
    }), /status=ready/);
    assert.throws(() => assertCandidateEvidence({
      templateId: "fixture",
      doc,
      evidence: { ...evidence, templateSha256: hash },
      templateBytes,
    }), /templateSha256/);
    assert.throws(() => assertCandidateEvidence({
      templateId: "fixture",
      doc: { ...doc, exactness: { ...doc.exactness, reviewEvidence: { ...doc.exactness.reviewEvidence, templateHash: hash } } },
      evidence,
      templateBytes,
    }), /human review evidence/);
    assert.throws(() => assertCandidateEvidence({
      templateId: "fixture",
      doc,
      evidence: { ...evidence, generationTrace: { ...evidence.generationTrace, status: "active" } },
      templateBytes,
    }), /generation trace/);
  });
});
