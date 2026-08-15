import { z } from "zod";
import {
  importTemplatePack,
  type ImportError,
  type ImportOptions,
  type ImportReceipt,
  type ImportRequest,
} from "./import-pack.ts";
import { sha256Hex, templatePackSchema, verifyManifestHash } from "../../../packages/ad-template-pack-contract/src/index.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// This is the Blockwise-side consumer contract. Frank owns producing the
// release; this adapter deliberately consumes only public references and the
// already-frozen TemplatePack v1 contract.
const RELEASE_SCHEMA = "schema://frank.tool-app-release/v1" as const;
const BLOCKWISE_COMPATIBILITY_VERSION = 1;

const sha256Schema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const publicRefSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Public artifact references must be HTTPS URLs without credentials");
const publicArtifactRefSchema = z.object({
  ref: publicRefSchema,
  sha256: sha256Schema,
  public: z.literal(true),
}).strict();

const releaseScalarSchema = z.union([z.string().min(1), z.number().int().positive()]);
const decisionSchema = z.object({
  status: z.string().min(1),
  ref: z.string().min(1),
}).strict();

export const frankPublicReleaseSchema = z.object({
  schema: z.literal(RELEASE_SCHEMA),
  tool_id: z.string().min(1),
  scope: z.object({
    kind: z.string().min(1),
    id: z.string().min(1),
  }).strict(),
  release_version: releaseScalarSchema,
  release_id: z.string().min(1),
  status: z.literal("released"),
  settings_revision: releaseScalarSchema,
  settings_ref: z.string().min(1),
  pipeline_id: z.literal("reference-clone-release"),
  pipeline_version: z.literal("1.0.0"),
  consumer_compatibility: z.record(z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }).strict()),
  artifact_refs: z.object({
    template_pack: publicArtifactRefSchema,
    assets: z.record(publicArtifactRefSchema),
    fonts: z.record(publicArtifactRefSchema),
    previews: z.object({
      feed: publicArtifactRefSchema,
      story: publicArtifactRefSchema,
    }).strict(),
  }).strict(),
  artifact_provenance: z.record(z.string().min(1)),
  output_checksums: z.object({
    template_pack: sha256Schema,
    assets: z.record(sha256Schema),
    fonts: z.record(sha256Schema),
    previews: z.object({
      feed: sha256Schema,
      story: sha256Schema,
    }).strict(),
  }).strict(),
  receipt_refs: z.record(z.string().min(1)),
  trace_ref: z.string().min(1),
  qa_decision: decisionSchema,
  approval_decision: decisionSchema,
  sanitization_receipt: decisionSchema,
  release_hash: sha256Schema,
  immutable: z.literal(true),
  source_free: z.literal(true),
}).strict();

export type FrankPublicRelease = z.infer<typeof frankPublicReleaseSchema>;

export interface FrankPublicReleaseImport {
  release: unknown;
  importRequest: ImportRequest;
}

/**
 * Validate and import a Frank public release through the existing importer.
 *
 * The adapter never imports a pack supplied inside arbitrary release metadata:
 * it binds the request URL/hash to the release's public template-pack artifact
 * and lets importTemplatePack perform the network, nonce, signature, schema,
 * and persistence work.
 */
export async function importFrankPublicRelease(
  supabase: SupabaseClient,
  input: FrankPublicReleaseImport,
  options: ImportOptions = {},
): Promise<ImportReceipt> {
  const release = parseRelease(input.release);
  validateCompatibility(release);
  validateImportBinding(release, input.importRequest);

  return importTemplatePack(
    supabase,
    {
      ...input.importRequest,
      releaseReceipt: release,
    },
    {
      ...options,
      validatePack: (packJson) => {
        // Scan the raw wire payload before the contract parser can strip
        // unknown/private fields. The caller's hook remains available for
        // additional consumer-side checks.
        assertSanitizedPayload(packJson, "template_pack");
        validatePackArtifacts(release, input.importRequest, packJson);
        options.validatePack?.(packJson);
      },
    },
  );
}

function parseRelease(value: unknown): FrankPublicRelease {
  assertSanitizedPayload(value, "release");
  const parsed = frankPublicReleaseSchema.safeParse(value);
  if (!parsed.success) {
    throw releaseError("release_invalid", "Frank release failed the public release contract", parsed.error.issues);
  }
  return parsed.data;
}

function validateCompatibility(release: FrankPublicRelease): void {
  const range = release.consumer_compatibility.blockwise;
  if (!range) {
    throw releaseError("release_incompatible", "Frank release does not declare Blockwise compatibility");
  }
  if (range.min > range.max || range.min > BLOCKWISE_COMPATIBILITY_VERSION || range.max < BLOCKWISE_COMPATIBILITY_VERSION) {
    throw releaseError("release_incompatible", "Frank release is outside Blockwise compatibility range");
  }
}

function validateImportBinding(release: FrankPublicRelease, input: ImportRequest): void {
  const packArtifact = release.artifact_refs.template_pack;
  if (input.packUrl !== packArtifact.ref) {
    throw releaseError("artifact_binding_mismatch", "packUrl must match the public TemplatePack artifact reference");
  }
  if (input.packSha256 !== packArtifact.sha256) {
    throw releaseError("checksum_mismatch", "packSha256 must match the public TemplatePack artifact checksum");
  }
  if (!sha256Schema.safeParse(input.packSha256).success) {
    throw releaseError("checksum_invalid", "packSha256 must be a lowercase SHA-256 checksum");
  }
  if (!input.packId || !input.buildId || !input.issuedAt || !input.nonce || !input.signature) {
    throw releaseError("import_request_invalid", "The release import request is incomplete");
  }
  if (release.qa_decision.status !== "passed" && release.qa_decision.status !== "pass") {
    throw releaseError("qa_rejected", "Frank release QA decision is not a pass");
  }
  if (release.approval_decision.status !== "approved" && release.approval_decision.status !== "approve") {
    throw releaseError("approval_required", "Frank release does not have human approval");
  }
  if (release.sanitization_receipt.status !== "passed" && release.sanitization_receipt.status !== "pass") {
    throw releaseError("sanitization_rejected", "Frank release sanitization receipt is not a pass");
  }
  if (!release.artifact_provenance || Object.keys(release.artifact_provenance).length === 0) {
    throw releaseError("provenance_missing", "Frank release does not include artifact provenance references");
  }
  if (!release.receipt_refs || Object.keys(release.receipt_refs).length === 0) {
    throw releaseError("receipt_missing", "Frank release does not include receipt references");
  }
  if (["workspace", "tenant", "user", "client"].includes(release.scope.kind.toLowerCase())) {
    throw releaseError("cross_workspace_data", "Frank release scope is not public-safe");
  }
  const { release_hash: _, ...withoutReleaseHash } = release;
  if (sha256Hex(withoutReleaseHash) !== release.release_hash) {
    throw releaseError("checksum_mismatch", "release_hash does not match the canonical release envelope");
  }
}

function validatePackArtifacts(
  release: FrankPublicRelease,
  input: ImportRequest,
  packJson: unknown,
): void {
  const parsed = templatePackSchema.safeParse(packJson);
  if (!parsed.success) return; // The existing importer owns the schema error.

  const pack = parsed.data;
  if (pack.packId !== input.packId) {
    throw releaseError("pack_id_mismatch", "packId does not match the imported TemplatePack");
  }
  if (!verifyManifestHash(pack as Record<string, unknown>)) {
    throw releaseError("checksum_mismatch", "TemplatePack manifestSha256 does not match its canonical manifest");
  }
  if (release.output_checksums.template_pack !== input.packSha256) {
    throw releaseError("checksum_mismatch", "output_checksums.template_pack does not match the imported pack");
  }

  if (!sameKeys(pack.assets, release.artifact_refs.assets)) {
    throw releaseError("unknown_asset", "Release asset references must exactly match TemplatePack assets");
  }
  for (const [assetKey, asset] of Object.entries(pack.assets)) {
    if (release.artifact_refs.assets[assetKey]?.sha256 !== asset.sha256) {
      throw releaseError("checksum_mismatch", `Asset checksum mismatch for ${assetKey}`);
    }
    if (release.output_checksums.assets[assetKey] !== asset.sha256) {
      throw releaseError("checksum_mismatch", `Output checksum mismatch for ${assetKey}`);
    }
  }

  const expectedFonts = new Set(pack.fonts.map((font) => font.file));
  if (!sameKeys(Object.fromEntries([...expectedFonts].map((font) => [font, true])), release.artifact_refs.fonts)) {
    throw releaseError("unknown_asset", "Release font references must exactly match TemplatePack fonts");
  }
  for (const font of pack.fonts) {
    if (release.artifact_refs.fonts[font.file]?.sha256 !== font.sha256) {
      throw releaseError("checksum_mismatch", `Font checksum mismatch for ${font.file}`);
    }
    if (release.output_checksums.fonts[font.file] !== font.sha256) {
      throw releaseError("checksum_mismatch", `Output checksum mismatch for ${font.file}`);
    }
  }

  for (const placement of ["feed", "story"] as const) {
    if (release.artifact_refs.previews[placement].sha256 !== pack.safePreviews[placement].sha256) {
      throw releaseError("checksum_mismatch", `${placement} preview checksum mismatch`);
    }
    if (release.output_checksums.previews[placement] !== pack.safePreviews[placement].sha256) {
      throw releaseError("checksum_mismatch", `${placement} output checksum mismatch`);
    }
  }
}

function sameKeys(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key));
}

const SAFE_PACK_FIELD_PATHS = new Set([
  "template_pack.classification.modelVersion",
  "template_pack.qaEvidence.reviewerVersions",
]);

function assertSanitizedPayload(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSanitizedPayload(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    const normalized = key.replace(/[-_]/g, "").toLowerCase();
    if (isWorkspaceField(normalized)) {
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
    assertSanitizedPayload(child, childPath);
  }
}

function isWorkspaceField(normalized: string): boolean {
  return normalized === "workspace" || normalized === "workspaceid" || normalized === "tenant" || normalized === "tenantid" || normalized === "clientworkspaceid";
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

export { RELEASE_SCHEMA, BLOCKWISE_COMPATIBILITY_VERSION };
