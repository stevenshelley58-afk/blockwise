import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_FACTORY_RELEASE_SCHEMA,
  CONTENT_FACTORY_PRODUCER_REVISION,
  CONTENT_FACTORY_TOOL_ID,
  ContentFactoryReleaseError,
  fetchContentFactoryBlogRelease,
  parseContentFactoryBlogRelease,
  sha256Hex,
} from "../src/lib/content-factory/blog-release.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function makeRelease(): Record<string, unknown> {
  const body = { format: "markdown", content: "# A useful guide\n\nThe final, reviewed article." };
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
      checksum: sha256Hex({
        id: "hero",
        url: "https://cdn.frank.fail/releases/a-useful-blockwise-guide/hero.webp",
        alt_text: "A clear illustration of a campaign decision",
      }),
    },
  ];
  const withoutReleaseHash = {
    schema: CONTENT_FACTORY_RELEASE_SCHEMA,
    tool_id: CONTENT_FACTORY_TOOL_ID,
    project_id: "blockwise",
    workspace_id: workspaceId,
    settings_revision: 7,
    pipeline_id: "blog-web-release",
    pipeline_version: 3,
    consumer_compatibility: ["blockwise.blog/v1"],
    release_id: "release-2026-08-14-guide",
    content_id: "content-a-useful-guide",
    version: 1,
    immutable: true,
    status: "published",
    channel: "web/blog",
    title: "A useful Blockwise guide",
    summary: "A short summary for the public guide.",
    body,
    media,
    seo,
    approval_receipt: { status: "approved", receipt_id: "approval-123" },
    provenance: {
      trace_id: "trace-123",
      artifact_checksums: {
        body: sha256Hex(body),
        seo: sha256Hex(seo),
        hero: media[0].checksum,
      },
    },
    sanitization_receipts: [
      { kind: "pii", status: "passed", receipt_id: "pii-123" },
      { kind: "secrets", status: "passed", receipt_id: "secret-123" },
    ],
    qa_receipt: { decision: "pass", receipt_ref: "qa-123", checked_at: "2026-08-14T07:55:00.000Z" },
    published_at: "2026-08-14T08:00:00.000Z",
  };
  return { ...withoutReleaseHash, release_hash: sha256Hex(withoutReleaseHash) };
}

function assertReleaseError(action: () => unknown, code: ContentFactoryReleaseError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof ContentFactoryReleaseError && error.code === code);
}

test("accepts the immutable Frank public_release contract and verifies artifact checksums", () => {
  assert.equal(CONTENT_FACTORY_PRODUCER_REVISION, "3de9e4f");
  const parsed = parseContentFactoryBlogRelease(makeRelease(), workspaceId);

  assert.equal(parsed.releaseId, "release-2026-08-14-guide");
  assert.equal(parsed.bodyMarkdown, "# A useful guide\n\nThe final, reviewed article.");
  assert.equal(parsed.artifactChecksums.hero, (makeRelease() as { provenance: { artifact_checksums: Record<string, string> } }).provenance.artifact_checksums.hero);
});

test("rejects drafts and failed approval or sanitization receipts", () => {
  const draft = makeRelease() as { status: string };
  draft.status = "draft";
  assertReleaseError(() => parseContentFactoryBlogRelease(draft, workspaceId), "schema_invalid");

  const failedApproval = makeRelease() as { approval_receipt: { status: string } };
  failedApproval.approval_receipt.status = "rejected";
  assertReleaseError(() => parseContentFactoryBlogRelease(failedApproval, workspaceId), "receipt_failed");

  const failedSanitization = makeRelease() as { sanitization_receipts: Array<{ status: string }> };
  failedSanitization.sanitization_receipts[0].status = "failed";
  assertReleaseError(() => parseContentFactoryBlogRelease(failedSanitization, workspaceId), "receipt_failed");

  const failedQa = makeRelease() as { qa_receipt: { decision: string } };
  failedQa.qa_receipt.decision = "fail";
  assertReleaseError(() => parseContentFactoryBlogRelease(failedQa, workspaceId), "schema_invalid");

  const incompatible = makeRelease() as { consumer_compatibility: string[] };
  incompatible.consumer_compatibility = ["other-consumer/v1"];
  assertReleaseError(() => parseContentFactoryBlogRelease(incompatible, workspaceId), "schema_invalid");
});

test("rejects recursive prompt, model, provider, private, raw, and internal fields", () => {
  const release = makeRelease() as { provenance: Record<string, unknown> };
  release.provenance = {
    trace_id: "trace-123",
    artifact_checksums: { body: "f".repeat(64), seo: "f".repeat(64), hero: "f".repeat(64) },
    nested: { raw_output: "not allowed" },
  };
  assertReleaseError(() => parseContentFactoryBlogRelease(release, workspaceId), "forbidden_field");
});

test("rejects unsafe media URLs, cross-workspace releases, and hash tampering", () => {
  const unsafe = makeRelease() as { media: Array<{ url: string }> };
  unsafe.media[0].url = "http://127.0.0.1/private.webp";
  assertReleaseError(() => parseContentFactoryBlogRelease(unsafe, workspaceId), "unsafe_url");

  const crossWorkspace = makeRelease() as { workspace_id: string };
  crossWorkspace.workspace_id = "22222222-2222-4222-8222-222222222222";
  assertReleaseError(() => parseContentFactoryBlogRelease(crossWorkspace, workspaceId), "workspace_mismatch");

  const nestedCrossWorkspace = makeRelease() as { provenance: Record<string, unknown> };
  nestedCrossWorkspace.provenance = {
    trace_id: "trace-123",
    artifact_checksums: { body: "f".repeat(64), seo: "f".repeat(64), hero: "f".repeat(64) },
    workspace_id: "22222222-2222-4222-8222-222222222222",
  };
  assertReleaseError(() => parseContentFactoryBlogRelease(nestedCrossWorkspace, workspaceId), "workspace_mismatch");

  const tampered = makeRelease() as { media: Array<{ checksum: string }> };
  tampered.media[0].checksum = "f".repeat(64);
  assertReleaseError(() => parseContentFactoryBlogRelease(tampered, workspaceId), "hash_mismatch");
});

test("fetch adapter validates a served release and has no generator or orchestrator path", async () => {
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
