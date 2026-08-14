import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AdTemplateGeneratorReleaseError,
  consumeAdTemplateGeneratorRelease,
  toTemplatePackImportRequest,
} from "../src/lib/adstudio/frank-template-release.ts";
import { verifyPackSignature } from "../src/lib/adstudio/import-pack.ts";
import { canonicalJson } from "../packages/ad-template-pack-contract/src/index.ts";
import { hashFrankReleaseEnvelope } from "../src/lib/frank-release-integrity.ts";

const fixturePath = new URL("./fixtures/frank-releases/ad-template-generator-v1.json", import.meta.url);
const expectedScope = { kind: "project", id: "blockwise" } as const;

function fixture(): any {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function resign(release: any): void {
  release.release_hash = hashFrankReleaseEnvelope(release);
}

function assertError(action: () => unknown, code: AdTemplateGeneratorReleaseError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof AdTemplateGeneratorReleaseError && error.code === code);
}

test("accepts the exact Frank Ad Template golden fixture and prepares the existing importer", () => {
  const input = fixture();
  const result = consumeAdTemplateGeneratorRelease(input, expectedScope);

  assert.equal(result.releaseHash, input.release_hash);
  assert.deepEqual(result.templatePack, input.template_pack);
  assert.deepEqual(result.qaReceipt, input.qa_receipt);
  assert.deepEqual(result.approvalReceipt, input.approval_receipt);
  assert.deepEqual(result.sanitizationReceipt, input.sanitization_receipt);
  assert.deepEqual(result.importArtifact, {
    packUrl: input.template_pack.artifact_ref,
    packSha256: input.template_pack.sha256,
    packId: input.template_pack.pack_id,
    signature: input.template_pack.signature,
  });

  assert.deepEqual(toTemplatePackImportRequest(result, {
    buildId: "delivery-1",
    issuedAt: "2026-08-14T00:04:00Z",
    nonce: "nonce-1",
    idempotencyKey: "release-1",
  }), {
    ...result.importArtifact,
    buildId: "delivery-1",
    issuedAt: "2026-08-14T00:04:00Z",
    nonce: "nonce-1",
    idempotencyKey: "release-1",
  });

  const hostileDelivery = {
    buildId: "delivery-2",
    issuedAt: "2026-08-14T00:04:00Z",
    nonce: "nonce-2",
    idempotencyKey: "release-1",
    packUrl: "https://attacker.example/pack.json",
  };
  assert.equal(toTemplatePackImportRequest(result, hostileDelivery).packUrl, input.template_pack.artifact_ref);
});

test("binds the immutable release to the caller scope", () => {
  assertError(
    () => consumeAdTemplateGeneratorRelease(fixture(), { kind: "project", id: "another-project" }),
    "scope_mismatch",
  );
  assertError(
    () => consumeAdTemplateGeneratorRelease(fixture(), { kind: "workspace", id: "blockwise" }),
    "scope_mismatch",
  );
});

test("rejects envelope, artifact, receipt, and unknown-field tampering", () => {
  const hashTamper = fixture();
  hashTamper.settings_revision = 2;
  assertError(() => consumeAdTemplateGeneratorRelease(hashTamper, expectedScope), "release_hash_mismatch");

  const artifactTamper = fixture();
  artifactTamper.provenance.artifact_ref = "https://frank.fail/releases/another.json";
  assertError(() => consumeAdTemplateGeneratorRelease(artifactTamper, expectedScope), "artifact_mismatch");

  const failedSanitization = fixture();
  failedSanitization.sanitization_receipt.decision = "fail";
  assertError(() => consumeAdTemplateGeneratorRelease(failedSanitization, expectedScope), "invalid_shape");

  const unknown = fixture();
  unknown.template_pack.second_artifact_ref = "https://frank.fail/releases/another.json";
  assertError(() => consumeAdTemplateGeneratorRelease(unknown, expectedScope), "invalid_shape");
});

test("rejects credential-query and IPv4-mapped IPv6 artifact URLs", () => {
  const credential = fixture();
  credential.template_pack.artifact_ref = "https://frank.fail/releases/pack.json?access_token=secret";
  credential.provenance.artifact_ref = credential.template_pack.artifact_ref;
  resign(credential);
  assertError(() => consumeAdTemplateGeneratorRelease(credential, expectedScope), "unsafe_artifact_url");

  const mappedLoopback = fixture();
  mappedLoopback.template_pack.artifact_ref = "https://[::ffff:127.0.0.1]/pack.json";
  mappedLoopback.provenance.artifact_ref = mappedLoopback.template_pack.artifact_ref;
  resign(mappedLoopback);
  assertError(() => consumeAdTemplateGeneratorRelease(mappedLoopback, expectedScope), "unsafe_artifact_url");
});

test("rejects re-signed private, provider, PII, and secret data across the Template envelope", () => {
  const mutations = [
    (release: any) => { release.settings_ref = "vault://private/template-settings"; },
    (release: any) => { release.settings_ref = "provider://openai/settings"; },
    (release: any) => { release.settings_ref = "settings://template/private/revision-1"; },
    (release: any) => { release.settings_ref = "settings://template/provider/openai"; },
    (release: any) => { release.qa_receipt.receipt_ref = "owner@example.com"; },
    (release: any) => { release.approval_receipt.receipt_ref = "provider payload record"; },
    (release: any) => { release.release_id = "secret=template-source"; },
  ];

  for (const mutate of mutations) {
    const release = fixture();
    mutate(release);
    resign(release);
    assertError(() => consumeAdTemplateGeneratorRelease(release, expectedScope), "unsafe_release");
  }
});

test("existing TemplatePack validator accepts base64 Ed25519 release signatures", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pack = { schema: "blockwise.template-pack/v1", packId: "pack-1" };
  const signature = sign(null, Buffer.from(canonicalJson(pack), "utf8"), privateKey).toString("base64");
  const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).toString("hex");

  assert.equal(verifyPackSignature(pack, signature, publicKeyHex), true);
});
