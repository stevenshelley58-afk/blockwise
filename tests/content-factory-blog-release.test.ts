import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONTENT_FACTORY_RELEASE_SCHEMA,
  CONTENT_FACTORY_TOOL_ID,
  ContentFactoryReleaseError,
  canonicalJson,
  fetchContentFactoryBlogRelease,
  parseContentFactoryBlogRelease,
  sha256Hex,
} from "../src/lib/content-factory/blog-release.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const frankProducerPin = "e9fa6434f4d29a40d43966b6d3e3f654ba99bd5fd";
const goldenReleaseHash = "ac0f1819a79b3c42ab604f4092b6bcb2928cb312462062e2416334cfb447a803";

// Golden fixture source: Frank codex/blockwise-modular-tools @ e9fa6434f4d29a40d43966b6d3e3f654ba99bd5fd.
const goldenContentReleaseV1 = JSON.parse(
  readFileSync(new URL("./fixtures/content-release-v1.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function makeRelease(): Record<string, unknown> {
  const body = { format: "markdown", content: "# Café guide — 日本語\n\nThe final, reviewed article." };
  const seo = {
    title: "A useful Blockwise guide | Blockwise",
    description: "A practical guide for real-estate advertising teams.",
    canonical_url: "https://blockwise.sale/guides/a-useful-blockwise-guide",
  };
  const media = [
    {
      id: "hero",
      url: "https://cdn.frank.fail/releases/a-useful-blockwise-guide/hero.webp",
      alt_text: "A clear illustration of a campaign decision",
      checksum: "f".repeat(64),
    },
  ];
  const withoutReleaseHash = {
    schema: CONTENT_FACTORY_RELEASE_SCHEMA,
    tool_id: CONTENT_FACTORY_TOOL_ID,
    project_id: "blockwise",
    workspace_id: workspaceId,
    settings_revision: 7,
    pipeline_id: "content-factory-pipeline",
    pipeline_version: "1.0.0",
    consumer_compatibility: ["article-release-v1"],
    release_id: "release-2026-08-14-guide",
    content_id: "content-a-useful-guide",
    version: 1,
    immutable: true,
    status: "published",
    channel: "web",
    title: "A useful Blockwise guide",
    summary: "A short summary for the public guide.",
    body,
    media,
    seo,
    approval_receipt: { decision: "approve", receipt_ref: "approval-123", decided_at: "2026-08-14T07:50:00.000Z" },
    provenance: {
      trace_id: "trace-123",
      artifact_checksums: {
        body: sha256Hex(body),
        seo: sha256Hex(seo),
        "media:hero": media[0].checksum,
      },
    },
    sanitization_receipts: {
      pii_scan: { status: "passed", receipt_id: "pii-123", scanned_at: "2026-08-14T07:45:00.000Z" },
      secret_scan: { status: "passed", receipt_id: "secret-123", scanned_at: "2026-08-14T07:46:00.000Z" },
    },
    qa_receipt: { decision: "pass", receipt_ref: "qa-123", checked_at: "2026-08-14T07:55:00.000Z" },
    published_at: "2026-08-14T08:00:00.000Z",
  };
  return { ...withoutReleaseHash, release_hash: sha256Hex(withoutReleaseHash) };
}

function assertReleaseError(action: () => unknown, code: ContentFactoryReleaseError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof ContentFactoryReleaseError && error.code === code);
}

test("accepts the exact immutable Frank public_release contract", () => {
  const parsed = parseContentFactoryBlogRelease(makeRelease(), workspaceId);

  assert.equal(parsed.releaseId, "release-2026-08-14-guide");
  assert.equal(parsed.pipeline.version, "1.0.0");
  assert.equal(parsed.channel, "web");
  assert.equal(parsed.consumerCompatibility[0], "article-release-v1");
  assert.equal(parsed.bodyMarkdown, "# Café guide — 日本語\n\nThe final, reviewed article.");
});

test("accepts the pinned Frank golden payload unchanged", () => {
  const { release_hash: releaseHash, ...withoutReleaseHash } = goldenContentReleaseV1;

  assert.equal(frankProducerPin, "e9fa6434f4d29a40d43966b6d3e3f654ba99bd5fd");
  assert.equal(releaseHash, goldenReleaseHash);
  assert.equal(sha256Hex(withoutReleaseHash), goldenReleaseHash);

  const parsed = parseContentFactoryBlogRelease(goldenContentReleaseV1, "123e4567-e89b-42d3-a456-426614174000");

  assert.equal(parsed.releaseId, "release-1");
  assert.equal(parsed.contentId, "content-1");
  assert.equal(parsed.bodyMarkdown, "# Article\n\nPublic content.");
  assert.equal(parsed.media[0]?.checksum, "a".repeat(64));
});

test("uses RFC 8785 JCS for Unicode, numeric, and property-order equivalence", () => {
  const first = { z: "café", number: 1.0, nested: { b: "日本語", a: true } };
  const second = { nested: { a: true, b: "日本語" }, number: 1, z: "caf\u00e9" };

  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(sha256Hex(first), sha256Hex(second));
});

test("rejects drafts, wrong pipeline/channel, incompatible releases, and failed receipts", () => {
  const draft = makeRelease() as { status: string };
  draft.status = "draft";
  assertReleaseError(() => parseContentFactoryBlogRelease(draft, workspaceId), "schema_invalid");

  const wrongPipeline = makeRelease() as { pipeline_version: string };
  wrongPipeline.pipeline_version = "1";
  assertReleaseError(() => parseContentFactoryBlogRelease(wrongPipeline, workspaceId), "schema_invalid");

  const wrongChannel = makeRelease() as { channel: string };
  wrongChannel.channel = "web/blog";
  assertReleaseError(() => parseContentFactoryBlogRelease(wrongChannel, workspaceId), "schema_invalid");

  const incompatible = makeRelease() as { consumer_compatibility: string[] };
  incompatible.consumer_compatibility = ["other-capability-v1"];
  assertReleaseError(() => parseContentFactoryBlogRelease(incompatible, workspaceId), "schema_invalid");

  const failedApproval = makeRelease() as { approval_receipt: { decision: string } };
  failedApproval.approval_receipt.decision = "reject";
  assertReleaseError(() => parseContentFactoryBlogRelease(failedApproval, workspaceId), "schema_invalid");

  const failedSanitization = makeRelease() as { sanitization_receipts: { pii_scan: { status: string } } };
  failedSanitization.sanitization_receipts.pii_scan.status = "failed";
  assertReleaseError(() => parseContentFactoryBlogRelease(failedSanitization, workspaceId), "schema_invalid");

  const failedQa = makeRelease() as { qa_receipt: { decision: string } };
  failedQa.qa_receipt.decision = "fail";
  assertReleaseError(() => parseContentFactoryBlogRelease(failedQa, workspaceId), "schema_invalid");
});

test("rejects extra nested fields and recursive forbidden keys and values", () => {
  const extra = makeRelease() as { body: Record<string, unknown> };
  extra.body.extra = "not in the producer contract";
  assertReleaseError(() => parseContentFactoryBlogRelease(extra, workspaceId), "schema_invalid");

  const forbidden = makeRelease() as { provenance: Record<string, unknown> };
  forbidden.provenance = {
    trace_id: "trace-123",
    artifact_checksums: { body: "f".repeat(64), seo: "f".repeat(64), "media:hero": "f".repeat(64) },
    nested: { raw_output: "not allowed" },
  };
  assertReleaseError(() => parseContentFactoryBlogRelease(forbidden, workspaceId), "forbidden_field");

  const piiValue = makeRelease() as { body: { content: string } };
  piiValue.body.content = "Contact alex@example.test for the reviewed article.";
  assertReleaseError(() => parseContentFactoryBlogRelease(piiValue, workspaceId), "forbidden_field");

  const secretValue = makeRelease() as { seo: { description: string } };
  secretValue.seo.description = "Bearer abcdefghijklmnopqrstuvwxyz";
  assertReleaseError(() => parseContentFactoryBlogRelease(secretValue, workspaceId), "forbidden_field");
});

test("requires producer-shaped unique consumer compatibility IDs", () => {
  const duplicate = makeRelease() as { consumer_compatibility: string[] };
  duplicate.consumer_compatibility = ["article-release-v1", "article-release-v1"];
  assertReleaseError(() => parseContentFactoryBlogRelease(duplicate, workspaceId), "schema_invalid");

  const malformed = makeRelease() as { consumer_compatibility: string[] };
  malformed.consumer_compatibility = ["article-release-v1", "Article Release V1"];
  assertReleaseError(() => parseContentFactoryBlogRelease(malformed, workspaceId), "schema_invalid");
});

test("rejects wrong artifact keys and hashes", () => {
  const wrongKey = makeRelease() as { provenance: { artifact_checksums: Record<string, string> } };
  wrongKey.provenance.artifact_checksums.hero = wrongKey.provenance.artifact_checksums["media:hero"];
  delete wrongKey.provenance.artifact_checksums["media:hero"];
  assertReleaseError(() => parseContentFactoryBlogRelease(wrongKey, workspaceId), "hash_mismatch");

  const wrongBodyHash = makeRelease() as { provenance: { artifact_checksums: Record<string, string> } };
  wrongBodyHash.provenance.artifact_checksums.body = "0".repeat(64);
  assertReleaseError(() => parseContentFactoryBlogRelease(wrongBodyHash, workspaceId), "hash_mismatch");

  const wrongReleaseHash = makeRelease() as { release_hash: string };
  wrongReleaseHash.release_hash = "0".repeat(64);
  assertReleaseError(() => parseContentFactoryBlogRelease(wrongReleaseHash, workspaceId), "hash_mismatch");
});

test("rejects unsafe media URLs and cross-workspace data", () => {
  const unsafe = makeRelease() as { media: Array<{ url: string }> };
  unsafe.media[0].url = "http://127.0.0.1/private.webp";
  assertReleaseError(() => parseContentFactoryBlogRelease(unsafe, workspaceId), "unsafe_url");

  const crossWorkspace = makeRelease() as { workspace_id: string };
  crossWorkspace.workspace_id = "22222222-2222-4222-8222-222222222222";
  assertReleaseError(() => parseContentFactoryBlogRelease(crossWorkspace, workspaceId), "workspace_mismatch");
});

test("fetch adapter validates a served release without a generator or orchestrator path", async () => {
  let fetchCount = 0;
  const parsed = await fetchContentFactoryBlogRelease(
    "https://frank.fail/releases/release-2026-08-14-guide.json",
    workspaceId,
    {
      fetchRelease: async () => {
        fetchCount += 1;
        return makeRelease();
      },
    },
  );

  assert.equal(fetchCount, 1);
  assert.equal(parsed.seo.canonical_url, "https://blockwise.sale/guides/a-useful-blockwise-guide");
});

test("live source URLs require an allowed Frank origin", async () => {
  await assert.rejects(
    fetchContentFactoryBlogRelease("https://evil.example/releases/release.json", workspaceId),
    (error: unknown) => error instanceof ContentFactoryReleaseError && error.code === "source_not_allowed",
  );
});
