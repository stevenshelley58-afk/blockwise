import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  consumeContentFactoryBlogRelease,
  ContentFactoryReleaseError,
} from "../src/lib/content-factory/blog-release.ts";
import { hashFrankReleaseEnvelope, hashFrankReleaseValue } from "../src/lib/frank-release-integrity.ts";

const fixturePath = new URL("./fixtures/frank-releases/content-release-v1.json", import.meta.url);
const projectId = "blockwise";
const workspaceId = "123e4567-e89b-42d3-a456-426614174000";

function fixture(): any {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function resign(release: any): void {
  release.release_hash = hashFrankReleaseEnvelope(release);
}

function resignContentArtifacts(release: any): void {
  release.provenance.artifact_checksums.body = hashFrankReleaseValue(release.body);
  release.provenance.artifact_checksums.seo = hashFrankReleaseValue(release.seo);
  resign(release);
}

function assertError(action: () => unknown, code: ContentFactoryReleaseError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof ContentFactoryReleaseError && error.code === code);
}

test("accepts the exact Frank Content Factory golden fixture without translation", () => {
  const input = fixture();
  const result = consumeContentFactoryBlogRelease(input, projectId, workspaceId);

  assert.equal(result.releaseId, input.release_id);
  assert.equal(result.releaseHash, input.release_hash);
  assert.equal(result.projectId, input.project_id);
  assert.equal(result.workspaceId, input.workspace_id);
  assert.equal(result.bodyMarkdown, input.body.content);
  assert.deepEqual(result.approvalReceipt, input.approval_receipt);
  assert.deepEqual(result.sanitizationReceipts, input.sanitization_receipts);
  assert.deepEqual(result.qaReceipt, input.qa_receipt);
  assert.deepEqual(result.provenance, input.provenance);
});

test("binds both project and workspace to caller targets", () => {
  assertError(() => consumeContentFactoryBlogRelease(fixture(), "another-project", workspaceId), "project_mismatch");
  assertError(
    () => consumeContentFactoryBlogRelease(fixture(), projectId, "11111111-1111-4111-8111-111111111111"),
    "workspace_mismatch",
  );
});

test("accepts the producer safe opaque workspace ID and binds it exactly", () => {
  const release = fixture();
  release.workspace_id = "workspace:acct_123.blockwise";
  resign(release);

  assert.equal(
    consumeContentFactoryBlogRelease(release, projectId, "workspace:acct_123.blockwise").workspaceId,
    "workspace:acct_123.blockwise",
  );
});

test("rejects credential-query and IPv4-mapped IPv6 content URLs", () => {
  const credential = fixture();
  credential.seo.canonical_url = "https://example/article?access_token=secret";
  resignContentArtifacts(credential);
  assertError(() => consumeContentFactoryBlogRelease(credential, projectId, workspaceId), "unsafe_url");

  const mappedLoopback = fixture();
  mappedLoopback.media[0].url = "https://[::ffff:127.0.0.1]/hero.png";
  resign(mappedLoopback);
  assertError(() => consumeContentFactoryBlogRelease(mappedLoopback, projectId, workspaceId), "unsafe_url");
});

test("rejects re-signed PII, secrets, and private URLs in completed blog content", () => {
  const unsafeReleaseBodies = [
    "Contact owner@example.com for details.",
    "Call +61 412 345 678 for details.",
    "Internal credential=do-not-release.",
    "The secret is do-not-release.",
    "Private source material.",
    "Provider payload details.",
  ];
  for (const content of unsafeReleaseBodies) {
    const release = fixture();
    release.body.content = content;
    resignContentArtifacts(release);
    assertError(() => consumeContentFactoryBlogRelease(release, projectId, workspaceId), "unsafe_release");
  }

  const privateUrl = fixture();
  privateUrl.body.content = "Internal source: http://10.0.0.4/article";
  resignContentArtifacts(privateUrl);
  assertError(() => consumeContentFactoryBlogRelease(privateUrl, projectId, workspaceId), "unsafe_url");
});

test("accepts ordinary public copy that uses private and provider in a non-implementation context", () => {
  const release = fixture();
  release.body.content = "A private courtyard and a useful provider comparison.";
  resignContentArtifacts(release);

  assert.equal(
    consumeContentFactoryBlogRelease(release, projectId, workspaceId).bodyMarkdown,
    release.body.content,
  );
});

test("rejects re-signed private and provider data in Content refs and receipts", () => {
  const mutations = [
    (release: any) => { release.qa_receipt.receipt_ref = "vault://private/content-qa"; },
    (release: any) => { release.provenance.trace_id = "provider://openai/private-trace"; },
    (release: any) => { release.approval_receipt.receipt_ref = "reviewer@example.com"; },
  ];

  for (const mutate of mutations) {
    const release = fixture();
    mutate(release);
    resign(release);
    assertError(() => consumeContentFactoryBlogRelease(release, projectId, workspaceId), "unsafe_release");
  }
});

test("rejects body, artifact checksum, and release envelope tampering", () => {
  const bodyTamper = fixture();
  bodyTamper.body.content = "# Changed";
  assertError(() => consumeContentFactoryBlogRelease(bodyTamper, projectId, workspaceId), "hash_mismatch");

  const checksumTamper = fixture();
  checksumTamper.provenance.artifact_checksums.body = "b".repeat(64);
  resign(checksumTamper);
  assertError(() => consumeContentFactoryBlogRelease(checksumTamper, projectId, workspaceId), "hash_mismatch");

  const envelopeTamper = fixture();
  envelopeTamper.title = "Changed title";
  assertError(() => consumeContentFactoryBlogRelease(envelopeTamper, projectId, workspaceId), "hash_mismatch");
});

test("rejects failed evidence and unknown fields", () => {
  const failedSanitization = fixture();
  failedSanitization.sanitization_receipts.pii_scan.status = "failed";
  assertError(() => consumeContentFactoryBlogRelease(failedSanitization, projectId, workspaceId), "schema_invalid");

  const failedApproval = fixture();
  failedApproval.approval_receipt.decision = "reject";
  assertError(() => consumeContentFactoryBlogRelease(failedApproval, projectId, workspaceId), "schema_invalid");

  const unknown = fixture();
  unknown.body.prompt = "private";
  assertError(() => consumeContentFactoryBlogRelease(unknown, projectId, workspaceId), "unsafe_release");
});
