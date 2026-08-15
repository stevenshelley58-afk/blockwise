import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../../packages/ad-template-pack-contract/src/index.ts";
import {
  importTemplatePack,
  type ImportError,
  type ImportOptions,
  type ImportReceipt,
  type ImportRequest,
} from "./import-pack.ts";

// Exact public release envelope produced by Frank's Ad Template Generator.
// Blockwise owns consumption only; TemplatePack v1 remains the inner contract.
const RELEASE_SCHEMA = "schema://frank.ad-template-generator-release/v1" as const;

const sha256Schema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const httpsRefSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Artifact references must be HTTPS URLs without credentials");
const isoDateSchema = z.string().datetime({ offset: true });

const templatePackReleaseSchema = z.object({
  schema: z.literal("blockwise.template-pack/v1"),
  pack_id: z.string().min(1),
  artifact_ref: httpsRefSchema,
  sha256: sha256Schema,
  signature_algorithm: z.literal("ed25519"),
  signature: z.string().min(16).max(512),
}).strict();

export const frankPublicReleaseSchema = z.object({
  schema: z.literal(RELEASE_SCHEMA),
  tool_id: z.literal("ad-template-generator"),
  scope: z.object({
    kind: z.enum(["project", "workspace"]),
    id: z.string().min(1),
  }).strict(),
  release_version: z.literal("1.0.0"),
  release_id: z.string().min(1),
  status: z.literal("released"),
  settings_revision: z.number().int().min(0),
  settings_ref: z.string().min(1),
  pipeline_id: z.literal("reference-clone-release"),
  pipeline_version: z.literal("1.0.0"),
  consumer_compatibility: z.tuple([z.literal("blockwise-template-pack-v1")]),
  template_pack: templatePackReleaseSchema,
  provenance: z.object({
    artifact_ref: httpsRefSchema,
    artifact_receipt_ref: z.string().min(1),
  }).strict(),
  trace_ref: z.string().min(1),
  qa_receipt: z.object({
    decision: z.literal("pass"),
    receipt_ref: z.string().min(1),
    checked_at: isoDateSchema,
  }).strict(),
  approval_receipt: z.object({
    decision: z.literal("approved"),
    gate: z.literal("native-pixel-human-approval"),
    receipt_ref: z.string().min(1),
    decided_at: isoDateSchema,
  }).strict(),
  sanitization_receipt: z.object({
    decision: z.literal("pass"),
    receipt_ref: z.string().min(1),
    checked_at: isoDateSchema,
  }).strict(),
  released_at: isoDateSchema,
  release_hash: sha256Schema,
  immutable: z.literal(true),
  source_free: z.literal(true),
}).strict();

export type FrankPublicRelease = z.infer<typeof frankPublicReleaseSchema>;

export interface FrankPublicReleaseImport {
  release: unknown;
  /** Transport-only values; pack identity and signature come from the release. */
  importRequest: Pick<ImportRequest, "nonce"> & Partial<Pick<ImportRequest, "idempotencyKey">>;
  workspaceId?: string;
}

export function computeFrankPublicReleaseHash(
  release: Omit<FrankPublicRelease, "release_hash">,
): string {
  return sha256Hex(release);
}

export function verifyFrankPublicReleaseHash(release: FrankPublicRelease): boolean {
  const { release_hash: _, ...withoutReleaseHash } = release;
  return computeFrankPublicReleaseHash(withoutReleaseHash) === release.release_hash;
}

/** Validate the exact Frank envelope, then hand its one public pack artifact to the existing importer. */
export async function importFrankPublicRelease(
  supabase: SupabaseClient,
  input: FrankPublicReleaseImport,
  options: ImportOptions = {},
): Promise<ImportReceipt> {
  const release = parseRelease(input.release);
  validateScope(release, input.workspaceId);
  if (!verifyFrankPublicReleaseHash(release)) {
    throw releaseError("checksum_mismatch", "release_hash does not match the RFC 8785 JCS release envelope");
  }
  if (release.provenance.artifact_ref !== release.template_pack.artifact_ref) {
    throw releaseError("artifact_binding_mismatch", "provenance.artifact_ref must match template_pack.artifact_ref");
  }

  const importRequest: ImportRequest = {
    packUrl: release.template_pack.artifact_ref,
    packSha256: release.template_pack.sha256,
    packId: release.template_pack.pack_id,
    buildId: release.release_id,
    issuedAt: release.released_at,
    nonce: input.importRequest.nonce,
    signature: release.template_pack.signature,
    idempotencyKey: input.importRequest.idempotencyKey || `${release.release_id}:${release.release_hash}`,
    releaseReceipt: release,
  };

  return importTemplatePack(supabase, importRequest, {
    ...options,
    validatePack: (packJson) => {
      // Scan the raw wire payload before Zod can strip unknown fields. The
      // existing importer owns all inner TemplatePack schema/signature logic.
      assertSanitizedPayload(packJson, "template_pack");
      options.validatePack?.(packJson);
    },
  });
}

function parseRelease(value: unknown): FrankPublicRelease {
  assertSanitizedPayload(value, "release");
  const parsed = frankPublicReleaseSchema.safeParse(value);
  if (!parsed.success) {
    throw releaseError("release_invalid", "Frank release failed the exact public release contract", parsed.error.issues);
  }
  return parsed.data;
}

function validateScope(release: FrankPublicRelease, workspaceId: string | undefined): void {
  if (release.scope.kind === "workspace" && release.scope.id !== workspaceId) {
    throw releaseError("cross_workspace_data", "Workspace-scoped release does not match the import workspace");
  }
}

const SAFE_PACK_FIELD_PATHS = new Set([
  "template_pack.classification.modelVersion",
  "template_pack.qaEvidence.reviewerVersions",
]);
const SECRET_VALUE_PATTERN = /(?:secret|token|password|api[_-]?key|private[_-]?key|-----BEGIN)/i;
const HTML_OR_CODE_PATTERN = /<\/?[a-z][^>]*>|javascript\s*:|-----BEGIN /i;
const PII_VALUE_PATTERN = /(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d)/;

function assertSanitizedPayload(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSanitizedPayload(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    const normalized = key.replace(/[-_]/g, "").toLowerCase();
    if (normalized === "workspaceid" || normalized === "tenantid" || normalized === "clientworkspaceid") {
      throw releaseError("cross_workspace_data", `Workspace-scoped field is not allowed at ${childPath}`);
    }
    if (SAFE_PACK_FIELD_PATHS.has(childPath)) {
      assertSanitizedPayload(child, childPath);
      continue;
    }
    if (isForbiddenField(normalized)) {
      throw releaseError("sanitization_rejected", `Forbidden Frank field at ${childPath}`);
    }
    if (normalized === "draft" || (normalized === "mutable" && child === true)) {
      throw releaseError("mutable_draft_rejected", `Mutable draft field at ${childPath}`);
    }
    if ((normalized === "status" || normalized === "state") && typeof child === "string" && child.toLowerCase() === "draft") {
      throw releaseError("mutable_draft_rejected", `Mutable draft state at ${childPath}`);
    }
    if (typeof child === "string") {
      const valueIsEvidence = normalized === "checkedat" || normalized === "decidedat" || normalized === "releasedat"
        || normalized === "createdat" || normalized === "updatedat"
        || normalized === "sha256" || normalized === "signature" || normalized === "releasehash";
      if (HTML_OR_CODE_PATTERN.test(child) || SECRET_VALUE_PATTERN.test(child) || (!valueIsEvidence && PII_VALUE_PATTERN.test(child))) {
        throw releaseError("sanitization_rejected", `Forbidden private, executable, or PII-like value at ${childPath}`);
      }
    }
    assertSanitizedPayload(child, childPath);
  }
}

function isForbiddenField(normalized: string): boolean {
  if (normalized === "sourcefree") return false;
  if (normalized === "modelversion" || normalized === "reviewerversions") return true;
  return [
    "source", "private", "prompt", "provider", "model", "reviewer", "pii", "secret",
    "credential", "password", "token", "email", "phone", "address", "ssn", "dob",
    "firstname", "lastname", "fullname", "personallyidentifiable",
  ].some((term) => normalized === term || normalized.includes(term));
}

function releaseError(code: string, message: string, detail?: unknown): ImportError & Error {
  const error = new Error(message) as ImportError & Error;
  error.code = code;
  error.detail = detail;
  return error;
}

export { RELEASE_SCHEMA };
