import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createLockedClonePacket,
  verifyLockedClonePacket,
} from "../scripts/adstudio/local-template-adapter.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "adstudio-customer-fixture-"));
  mkdirSync(join(root, "public"));
  mkdirSync(join(root, "assets"));
  const sample = join(root, "public", "sample.png");
  const photo = join(root, "assets", "photo.png");
  writeFileSync(sample, "approved-public-sample");
  writeFileSync(photo, "customer-photo");
  return { root, sample, photo };
}

function packet(input) {
  return createLockedClonePacket({
    root: input.root,
    templateId: "meta-local-test",
    request: { prompt: "Clone the approved public sample.", negativePrompt: "", aspectRatio: "4:5", seed: 4 },
    copy: { headline: "Request your appraisal" },
    referencePaths: [
      { key: "approved_sample", role: "approved_sample", path: input.sample },
      { key: "property_photo", role: "replacement_asset", path: input.photo },
    ],
    expectedOutput: join(input.root, "artifacts", "customer.png"),
  });
}

test("locks an independent customer fixture to the approved public sample", () => {
  const item = fixture();
  const value = packet(item);
  assert.equal(value.stage, "customer_fixture");
  assert.equal(value.references[0].role, "approved_sample");
  assert.doesNotThrow(() => verifyLockedClonePacket(value, { root: item.root }));
});

test("refuses every non-customer packet stage and non-sample first reference", () => {
  const item = fixture();
  assert.throws(() => createLockedClonePacket({
    root: item.root,
    stage: "legacy_factory_stage",
    templateId: "meta-local-test",
    request: { prompt: "Clone", aspectRatio: "4:5" },
    copy: {},
    referencePaths: [{ key: "source", role: "source", path: item.sample }],
    expectedOutput: join(item.root, "public", "candidate.png"),
  }), /only exports customer-fixture packets/u);
  assert.throws(() => createLockedClonePacket({
    root: item.root,
    templateId: "meta-local-test",
    request: { prompt: "Clone", aspectRatio: "4:5" },
    copy: {},
    referencePaths: [{ key: "not_sample", role: "replacement_asset", path: item.photo }],
    expectedOutput: join(item.root, "public", "candidate.png"),
  }), /approved public sample/u);
});

test("rejects packet tampering and changed public or customer assets", () => {
  const item = fixture();
  const value = packet(item);
  value.references[0].role = "source";
  assert.throws(() => verifyLockedClonePacket(value, { root: item.root }), /changed after export|approved public sample/u);

  const fresh = packet(item);
  fresh.references.reverse();
  assert.throws(() => verifyLockedClonePacket(fresh, { root: item.root }), /changed after export|approved public sample/u);

  const changed = packet(item);
  writeFileSync(item.photo, "changed-photo");
  assert.throws(() => verifyLockedClonePacket(changed, { root: item.root }), /changed after export/u);
});
