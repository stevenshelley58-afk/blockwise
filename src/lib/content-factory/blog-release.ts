import { createHash } from "node:crypto";

import { z } from "zod";

/** Wire identifiers emitted by Frank's `public_release()` producer. */
export const CONTENT_FACTORY_RELEASE_SCHEMA = "schema://frank.content-factory-release/v1" as const;
export const CONTENT_FACTORY_TOOL_ID = "content-factory" as const;
/** Compatibility pin for the reviewed Frank producer revision. */
export const CONTENT_FACTORY_PRODUCER_REVISION = "3de9e4f" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_FIELD_PATTERN = /(?:^|[_-])(prompt|prompts|model|models|provider|providers|private|raw|internal)(?:$|[_-])/iu;

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const sha256Schema = z.string().regex(SHA256_PATTERN, "must be a lowercase SHA-256 hex digest");
const publicUrlSchema = z.string().trim().url().max(2_048);

const bodySchema = z
  .object({ format: z.literal("markdown"), content: nonEmptyText(500_000) })
  .strict();

const mediaSchema = z
  .object({
    id: nonEmptyText(200),
    url: publicUrlSchema,
    alt_text: nonEmptyText(500),
    checksum: sha256Schema,
  })
  .strict();

const seoSchema = z
  .object({
    title: nonEmptyText(240),
    description: nonEmptyText(320),
    canonical_url: publicUrlSchema,
  })
  .strict();

const approvalReceiptSchema = z.record(z.unknown());
const sanitizationReceiptsSchema = z.array(z.record(z.unknown())).min(2).max(16);
const qaReceiptSchema = z
  .object({
    decision: z.literal("pass"),
    receipt_ref: nonEmptyText(500),
    checked_at: z.string().datetime({ offset: true }),
  })
  .strict();

const releaseSchema = z
  .object({
    schema: z.literal(CONTENT_FACTORY_RELEASE_SCHEMA),
    tool_id: z.literal(CONTENT_FACTORY_TOOL_ID),
    project_id: nonEmptyText(200),
    workspace_id: nonEmptyText(200),
    settings_revision: z.number().int().nonnegative(),
    pipeline_id: nonEmptyText(200),
    pipeline_version: z.number().int().positive(),
    consumer_compatibility: z.array(nonEmptyText(200)).min(1).max(32),
    release_id: nonEmptyText(200),
    content_id: nonEmptyText(200),
    version: z.number().int().positive(),
    immutable: z.literal(true),
    status: z.literal("published"),
    channel: nonEmptyText(100),
    title: nonEmptyText(240),
    summary: nonEmptyText(1_000).optional(),
    body: bodySchema,
    media: z.array(mediaSchema).max(64),
    seo: seoSchema,
    approval_receipt: approvalReceiptSchema,
    provenance: z
      .object({
        trace_id: nonEmptyText(500),
        artifact_checksums: z.record(sha256Schema),
      })
      .strict(),
    sanitization_receipts: sanitizationReceiptsSchema,
    qa_receipt: qaReceiptSchema,
    published_at: z.string().datetime({ offset: true }),
    release_hash: sha256Schema,
  })
  .strict();

export const contentFactoryBlogReleaseSchema = releaseSchema;
export type ContentFactoryBlogRelease = z.infer<typeof releaseSchema>;

export type BlockwiseBlogRelease = {
  releaseId: string;
  contentId: string;
  version: number;
  workspaceId: string;
  projectId: string;
  channel: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  seo: ContentFactoryBlogRelease["seo"];
  media: ContentFactoryBlogRelease["media"];
  settingsRevision: number;
  pipeline: { id: string; version: number };
  consumerCompatibility: string[];
  traceId: string;
  artifactChecksums: Record<string, string>;
  qaReceipt: ContentFactoryBlogRelease["qa_receipt"];
  publishedAt: string;
};

export type ContentFactoryReleaseErrorCode =
  | "invalid_payload"
  | "forbidden_field"
  | "schema_invalid"
  | "workspace_mismatch"
  | "unsafe_url"
  | "hash_missing"
  | "hash_mismatch"
  | "receipt_failed"
  | "source_not_allowed"
  | "fetch_failed"
  | "redirect_not_allowed";

export class ContentFactoryReleaseError extends Error {
  readonly code: ContentFactoryReleaseErrorCode;
  readonly detail?: unknown;

  constructor(code: ContentFactoryReleaseErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "ContentFactoryReleaseError";
    this.code = code;
    this.detail = detail;
  }
}

/** Canonical JSON used by the Frank release contract for hash receipts. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return entry;
  });
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function parseContentFactoryBlogRelease(input: unknown, workspaceId: string): BlockwiseBlogRelease {
  if (!isRecord(input)) {
    throw new ContentFactoryReleaseError("invalid_payload", "Content Factory release must be a JSON object.");
  }
  if (!workspaceId.trim()) {
    throw new ContentFactoryReleaseError("workspace_mismatch", "A target workspace is required.");
  }

  const forbiddenPath = findForbiddenField(input);
  if (forbiddenPath) {
    throw new ContentFactoryReleaseError("forbidden_field", `Release contains a prohibited field at ${forbiddenPath}.`, forbiddenPath);
  }

  const foreignWorkspacePath = findForeignWorkspaceField(input, workspaceId);
  if (foreignWorkspacePath) {
    throw new ContentFactoryReleaseError("workspace_mismatch", `Release contains a different workspace at ${foreignWorkspacePath}.`, foreignWorkspacePath);
  }

  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentFactoryReleaseError("schema_invalid", "Release does not match the Frank public_release contract.", parsed.error.issues);
  }

  const release = parsed.data;
  if (!UUID_PATTERN.test(release.workspace_id) || release.workspace_id !== workspaceId) {
    throw new ContentFactoryReleaseError("workspace_mismatch", "Release workspace does not match the requested Blockwise workspace.");
  }
  if (!release.consumer_compatibility.some((entry) => /blockwise/iu.test(entry))) {
    throw new ContentFactoryReleaseError("schema_invalid", "Release does not declare Blockwise consumer compatibility.");
  }
  assertReceipts(release);
  assertPublicUrl(release.seo.canonical_url, "seo.canonical_url");
  for (const media of release.media) assertPublicUrl(media.url, `media.${media.id}.url`);
  assertUniqueMediaIds(release.media);
  assertArtifactChecksums(release);
  if (release.release_hash !== hashReleaseWithoutHash(release)) {
    throw new ContentFactoryReleaseError("hash_mismatch", "Release release_hash does not match the immutable release payload.");
  }

  return {
    releaseId: release.release_id,
    contentId: release.content_id,
    version: release.version,
    workspaceId: release.workspace_id,
    projectId: release.project_id,
    channel: release.channel,
    title: release.title,
    summary: release.summary ?? null,
    bodyMarkdown: release.body.content,
    seo: release.seo,
    media: release.media,
    settingsRevision: release.settings_revision,
    pipeline: { id: release.pipeline_id, version: release.pipeline_version },
    consumerCompatibility: release.consumer_compatibility,
    traceId: release.provenance.trace_id,
    artifactChecksums: release.provenance.artifact_checksums,
    qaReceipt: release.qa_receipt,
    publishedAt: release.published_at,
  };
}

export type FetchRelease = (url: string) => Promise<unknown>;
export type FetchContentFactoryBlogReleaseOptions = {
  /** Test/local fixture injection. Production callers must omit this. */
  fetchRelease?: FetchRelease;
  allowedOrigins?: readonly string[];
};

export async function fetchContentFactoryBlogRelease(
  releaseUrl: string,
  workspaceId: string,
  options: FetchContentFactoryBlogReleaseOptions = {},
): Promise<BlockwiseBlogRelease> {
  if (options.fetchRelease) {
    if (process.env.NODE_ENV === "production") {
      throw new ContentFactoryReleaseError("source_not_allowed", "Injected release fetchers are disabled in production.");
    }
    return parseContentFactoryBlogRelease(await options.fetchRelease(releaseUrl), workspaceId);
  }

  assertPublicUrl(releaseUrl, "release URL");
  const parsedUrl = new URL(releaseUrl);
  const allowedOrigins = (options.allowedOrigins ?? ["frank.fail"]).map((origin) => origin.toLowerCase().replace(/\.$/u, ""));
  if (!allowedOrigins.some((origin) => parsedUrl.hostname === origin || parsedUrl.hostname.endsWith(`.${origin}`))) {
    throw new ContentFactoryReleaseError("source_not_allowed", "Release URL is not served by an allowed Frank origin.");
  }

  const response = await fetch(releaseUrl, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new ContentFactoryReleaseError("redirect_not_allowed", "Release URL must not redirect.");
  }
  if (!response.ok) {
    throw new ContentFactoryReleaseError("fetch_failed", `Release fetch failed with HTTP ${response.status}.`);
  }
  return parseContentFactoryBlogRelease(await response.json(), workspaceId);
}

function assertReceipts(release: ContentFactoryBlogRelease): void {
  const approvalStatus = readStatus(release.approval_receipt);
  if (approvalStatus !== "approved") {
    throw new ContentFactoryReleaseError("receipt_failed", "Release approval receipt is not approved.");
  }
  for (const receipt of release.sanitization_receipts) {
    const status = readStatus(receipt);
    if (status !== "passed" && status !== "sanitized" && status !== "approved") {
      throw new ContentFactoryReleaseError("receipt_failed", "Release contains a failed sanitization receipt.");
    }
  }
}

function assertArtifactChecksums(release: ContentFactoryBlogRelease): void {
  const checksums = release.provenance.artifact_checksums;
  for (const media of release.media) {
    const checksum = checksums[media.id] ?? checksums[`media:${media.id}`];
    if (!checksum) throw new ContentFactoryReleaseError("hash_missing", `Media artifact ${media.id} is missing a checksum receipt.`);
    if (checksum !== media.checksum) throw new ContentFactoryReleaseError("hash_mismatch", `Media artifact ${media.id} checksum does not match its receipt.`);
  }
  if (!checksums.body && !checksums.content) throw new ContentFactoryReleaseError("hash_missing", "Body artifact is missing a checksum receipt.");
  if (!checksums.seo) throw new ContentFactoryReleaseError("hash_missing", "SEO artifact is missing a checksum receipt.");
}

function hashReleaseWithoutHash(release: ContentFactoryBlogRelease): string {
  const { release_hash: _releaseHash, ...withoutHash } = release;
  return sha256Hex(withoutHash);
}

function findForbiddenField(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, entry] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (FORBIDDEN_FIELD_PATTERN.test(key)) return currentPath;
    const found = findForbiddenField(entry, currentPath);
    if (found) return found;
  }
  return null;
}

function findForeignWorkspaceField(value: unknown, workspaceId: string, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForeignWorkspaceField(value[index], workspaceId, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, entry] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if ((key === "workspace_id" || key === "workspaceId") && entry !== workspaceId) return currentPath;
    const found = findForeignWorkspaceField(entry, workspaceId, currentPath);
    if (found) return found;
  }
  return null;
}

function assertUniqueMediaIds(media: ContentFactoryBlogRelease["media"]): void {
  const ids = new Set<string>();
  for (const entry of media) {
    if (ids.has(entry.id)) throw new ContentFactoryReleaseError("hash_mismatch", `Media artifact id ${entry.id} is not unique.`);
    ids.add(entry.id);
  }
}

function readStatus(receipt: Record<string, unknown>): string | null {
  return typeof receipt.status === "string" ? receipt.status.trim().toLowerCase() : null;
}

function assertPublicUrl(value: string, label: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || isPrivateHost(url.hostname)) throw new Error("unsafe");
  } catch {
    throw new ContentFactoryReleaseError("unsafe_url", `${label} must be a public HTTPS URL.`);
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
