import { z } from "zod";

import {
  hashFrankReleaseEnvelope,
  hashFrankReleaseValue,
  isRecord,
} from "../frank-release-integrity.ts";
import { publicFrankReleaseUrl } from "../frank-release-public-url.ts";
import { assertSafeFrankReleaseEnvelope, FrankReleaseSafetyError } from "../frank-release-safety.ts";

export const CONTENT_FACTORY_RELEASE_SCHEMA = "schema://frank.content-factory-release/v1" as const;
export const CONTENT_FACTORY_TOOL_ID = "content-factory" as const;

const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const text = z.string().min(1);
const domainId = z.string().regex(DOMAIN_ID_PATTERN);
const scopeId = z.string().regex(SCOPE_ID_PATTERN);
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(SHA256_PATTERN);

const bodySchema = z.object({ format: z.literal("markdown"), content: text }).strict();
const mediaSchema = z
  .object({ id: domainId, url: text, alt_text: text, checksum: sha256 })
  .strict();
const seoSchema = z
  .object({ title: text, description: text, canonical_url: text })
  .strict();
const qaReceiptSchema = z
  .object({ decision: z.literal("pass"), receipt_ref: domainId, checked_at: timestamp })
  .strict();
const approvalReceiptSchema = z
  .object({ decision: z.literal("approve"), receipt_ref: domainId, decided_at: timestamp })
  .strict();
const scanReceiptSchema = z
  .object({ status: z.literal("passed"), receipt_id: domainId, scanned_at: timestamp })
  .strict();

export const contentFactoryBlogReleaseSchema = z
  .object({
    schema: z.literal(CONTENT_FACTORY_RELEASE_SCHEMA),
    tool_id: z.literal(CONTENT_FACTORY_TOOL_ID),
    project_id: domainId,
    workspace_id: scopeId,
    settings_revision: z.number().int().nonnegative(),
    pipeline_id: z.literal("content-factory-pipeline"),
    pipeline_version: z.literal("1.0.0"),
    consumer_compatibility: z
      .array(domainId)
      .min(1)
      .refine((items) => new Set(items).size === items.length && items.includes("article-release-v1")),
    release_id: domainId,
    content_id: domainId,
    version: z.number().int().positive(),
    immutable: z.literal(true),
    status: z.literal("published"),
    channel: z.literal("web"),
    title: text,
    summary: text.optional(),
    body: bodySchema,
    media: z.array(mediaSchema),
    seo: seoSchema,
    qa_receipt: qaReceiptSchema,
    approval_receipt: approvalReceiptSchema,
    provenance: z
      .object({ trace_id: scopeId, artifact_checksums: z.record(sha256) })
      .strict(),
    sanitization_receipts: z
      .object({ pii_scan: scanReceiptSchema, secret_scan: scanReceiptSchema })
      .strict(),
    published_at: timestamp,
    release_hash: sha256,
  })
  .strict();

export type ContentFactoryBlogRelease = z.infer<typeof contentFactoryBlogReleaseSchema>;

export type BlockwiseBlogRelease = {
  releaseId: string;
  releaseHash: string;
  contentId: string;
  version: number;
  workspaceId: string;
  projectId: string;
  channel: "web";
  status: "published";
  immutable: true;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  seo: ContentFactoryBlogRelease["seo"];
  media: ContentFactoryBlogRelease["media"];
  settingsRevision: number;
  pipeline: { id: "content-factory-pipeline"; version: "1.0.0" };
  consumerCompatibility: string[];
  provenance: ContentFactoryBlogRelease["provenance"];
  qaReceipt: ContentFactoryBlogRelease["qa_receipt"];
  approvalReceipt: ContentFactoryBlogRelease["approval_receipt"];
  sanitizationReceipts: ContentFactoryBlogRelease["sanitization_receipts"];
  publishedAt: string;
};

export type ContentFactoryReleaseErrorCode =
  | "invalid_payload"
  | "schema_invalid"
  | "project_mismatch"
  | "workspace_mismatch"
  | "unsafe_release"
  | "unsafe_url"
  | "hash_mismatch";

export class ContentFactoryReleaseError extends Error {
  readonly code: ContentFactoryReleaseErrorCode;
  readonly detail?: unknown;

  constructor(
    code: ContentFactoryReleaseErrorCode,
    message: string,
    detail?: unknown,
  ) {
    super(message);
    this.name = "ContentFactoryReleaseError";
    this.code = code;
    this.detail = detail;
  }
}

export function consumeContentFactoryBlogRelease(
  input: unknown,
  expectedProjectId: string,
  expectedWorkspaceId: string,
): BlockwiseBlogRelease {
  if (!isRecord(input)) {
    throw new ContentFactoryReleaseError("invalid_payload", "Content Factory release must be an object.");
  }
  if (!expectedProjectId.trim()) {
    throw new ContentFactoryReleaseError("project_mismatch", "A target project is required.");
  }
  if (!expectedWorkspaceId.trim()) {
    throw new ContentFactoryReleaseError("workspace_mismatch", "A target workspace is required.");
  }

  try {
    assertSafeFrankReleaseEnvelope(input);
  } catch (error) {
    if (error instanceof FrankReleaseSafetyError) {
      const code = error.reason === "unsafe_url" ? "unsafe_url" : "unsafe_release";
      throw new ContentFactoryReleaseError(code, error.message);
    }
    throw error;
  }

  const parsed = contentFactoryBlogReleaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentFactoryReleaseError(
      "schema_invalid",
      "Release does not match the reviewed Frank Content Factory v1 contract.",
      parsed.error.issues,
    );
  }
  const release = parsed.data;
  if (release.project_id !== expectedProjectId) {
    throw new ContentFactoryReleaseError("project_mismatch", "Release project does not match the caller target.");
  }
  if (release.workspace_id !== expectedWorkspaceId) {
    throw new ContentFactoryReleaseError("workspace_mismatch", "Release workspace does not match the caller target.");
  }

  assertPublicHttpsUrl(release.seo.canonical_url, "seo.canonical_url");
  for (const media of release.media) assertPublicHttpsUrl(media.url, `media.${media.id}.url`);
  assertUniqueMediaIds(release.media);
  assertArtifactChecksums(release);
  if (hashFrankReleaseEnvelope(input) !== release.release_hash) {
    throw new ContentFactoryReleaseError("hash_mismatch", "Release hash does not match the immutable envelope.");
  }

  return {
    releaseId: release.release_id,
    releaseHash: release.release_hash,
    contentId: release.content_id,
    version: release.version,
    workspaceId: release.workspace_id,
    projectId: release.project_id,
    channel: release.channel,
    status: release.status,
    immutable: release.immutable,
    title: release.title,
    summary: release.summary ?? null,
    bodyMarkdown: release.body.content,
    seo: release.seo,
    media: release.media,
    settingsRevision: release.settings_revision,
    pipeline: { id: release.pipeline_id, version: release.pipeline_version },
    consumerCompatibility: [...release.consumer_compatibility],
    provenance: release.provenance,
    qaReceipt: release.qa_receipt,
    approvalReceipt: release.approval_receipt,
    sanitizationReceipts: release.sanitization_receipts,
    publishedAt: release.published_at,
  };
}

function assertArtifactChecksums(release: ContentFactoryBlogRelease): void {
  const expectedKeys = new Set(["body", "seo", ...release.media.map(({ id }) => `media:${id}`)]);
  const actualKeys = Object.keys(release.provenance.artifact_checksums);
  if (actualKeys.length !== expectedKeys.size || actualKeys.some((key) => !expectedKeys.has(key))) {
    throw new ContentFactoryReleaseError("hash_mismatch", "Artifact checksum keys do not match released artifacts.");
  }
  if (release.provenance.artifact_checksums.body !== hashFrankReleaseValue(release.body)) {
    throw new ContentFactoryReleaseError("hash_mismatch", "Body checksum does not match.");
  }
  if (release.provenance.artifact_checksums.seo !== hashFrankReleaseValue(release.seo)) {
    throw new ContentFactoryReleaseError("hash_mismatch", "SEO checksum does not match.");
  }
  for (const media of release.media) {
    if (release.provenance.artifact_checksums[`media:${media.id}`] !== media.checksum) {
      throw new ContentFactoryReleaseError("hash_mismatch", `Media checksum receipt does not match ${media.id}.`);
    }
  }
}

function assertUniqueMediaIds(media: ContentFactoryBlogRelease["media"]): void {
  const ids = new Set<string>();
  for (const entry of media) {
    if (ids.has(entry.id)) {
      throw new ContentFactoryReleaseError("hash_mismatch", `Media id ${entry.id} is duplicated.`);
    }
    ids.add(entry.id);
  }
}

function assertPublicHttpsUrl(value: string, field: string): void {
  if (publicFrankReleaseUrl(value) === null) {
    throw new ContentFactoryReleaseError("unsafe_url", `${field} must be a public HTTPS URL.`);
  }
}
