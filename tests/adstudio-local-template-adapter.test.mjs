import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLockedClonePacket,
  localAuditEvidence,
  validateLocalQaEvidence,
  verifyLockedClonePacket,
} from "../scripts/adstudio/local-template-adapter.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "adstudio-local-adapter-"));
  mkdirSync(join(root, "meta_ad_candidates"));
  mkdirSync(join(root, "assets"));
  const source = join(root, "meta_ad_candidates", "source.png");
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
    assetChecks: [{ key: "property_photo", used: true }],
    identityLeakage: [],
    defects: [],
    correctionCount: 0,
    reviewedAt: "2026-07-15T00:00:00.000Z",
    outputHash: "f".repeat(64),
  };
  return { root, source, photo, template, packet, qa };
}

test("locks the clone request and contractual reference order", () => {
  const { root, packet } = fixture();
  assert.equal(packet.references[0].role, "source");
  assert.equal(packet.references[1].key, "property_photo");
  assert.doesNotThrow(() => verifyLockedClonePacket(packet, { root }));
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
});

test("emits audit evidence without copying private image bytes", () => {
  const { source, template, packet, qa } = fixture();
  const evidence = localAuditEvidence({ template, packet, qa, outputHash: "f".repeat(64) });
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.outputHash, "f".repeat(64));
  assert.equal(serialized.includes(readFileSync(source, "utf8")), false);
});
