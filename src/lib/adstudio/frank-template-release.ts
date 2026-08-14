import { z } from "zod";

import type { ImportRequest } from "./import-pack.ts";
import { hashFrankReleaseEnvelope, isRecord } from "../frank-release-integrity.ts";
import { publicFrankReleaseUrl } from "../frank-release-public-url.ts";
import { assertSafeFrankReleaseEnvelope, FrankReleaseSafetyError } from "../frank-release-safety.ts";

export const AD_TEMPLATE_GENERATOR_RELEASE_SCHEMA = "schema://frank.ad-template-generator-release/v1" as const;
export const AD_TEMPLATE_GENERATOR_TOOL_ID = "ad-template-generator" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"));
const receipt = z
  .object({ decision: z.literal("pass"), receipt_ref: text, checked_at: timestamp })
  .strict();

export const adTemplateGeneratorReleaseSchema = z
  .object({
    schema: z.literal(AD_TEMPLATE_GENERATOR_RELEASE_SCHEMA),
    tool_id: z.literal(AD_TEMPLATE_GENERATOR_TOOL_ID),
    scope: z
      .object({ kind: z.enum(["project", "workspace"]), id: text })
      .strict(),
    release_version: z.literal("1.0.0"),
    release_id: text,
    status: z.literal("released"),
    settings_revision: z.number().int().nonnegative(),
    settings_ref: text,
    pipeline_id: z.literal("reference-clone-release"),
    pipeline_version: z.literal("1.0.0"),
    consumer_compatibility: z.tuple([z.literal("blockwise-template-pack-v1")]),
    template_pack: z
      .object({
        schema: z.literal("blockwise.template-pack/v1"),
        pack_id: text,
        artifact_ref: httpsUrl,
        sha256: z.string().regex(SHA256_PATTERN),
        signature_algorithm: z.literal("ed25519"),
        signature: z.string().min(16).max(512),
      })
      .strict(),
    provenance: z
      .object({ artifact_ref: httpsUrl, artifact_receipt_ref: text })
      .strict(),
    trace_ref: text,
    qa_receipt: receipt,
    approval_receipt: z
      .object({
        decision: z.literal("approved"),
        gate: z.literal("native-pixel-human-approval"),
        receipt_ref: text,
        decided_at: timestamp,
      })
      .strict(),
    sanitization_receipt: receipt,
    released_at: timestamp,
    release_hash: z.string().regex(SHA256_PATTERN),
    immutable: z.literal(true),
    source_free: z.literal(true),
  })
  .strict();

export type AdTemplateGeneratorRelease = z.infer<typeof adTemplateGeneratorReleaseSchema>;

export type ConsumedAdTemplateGeneratorRelease = {
  releaseId: string;
  releaseHash: string;
  scope: AdTemplateGeneratorRelease["scope"];
  settingsRevision: number;
  settingsRef: string;
  pipeline: { id: "reference-clone-release"; version: "1.0.0" };
  templatePack: AdTemplateGeneratorRelease["template_pack"];
  provenance: AdTemplateGeneratorRelease["provenance"];
  traceRef: string;
  qaReceipt: AdTemplateGeneratorRelease["qa_receipt"];
  approvalReceipt: AdTemplateGeneratorRelease["approval_receipt"];
  sanitizationReceipt: AdTemplateGeneratorRelease["sanitization_receipt"];
  releasedAt: string;
  importArtifact: Pick<ImportRequest, "packUrl" | "packSha256" | "packId" | "signature">;
};

export type AdTemplateGeneratorReleaseErrorCode =
  | "invalid_shape"
  | "scope_mismatch"
  | "unsafe_release"
  | "unsafe_artifact_url"
  | "artifact_mismatch"
  | "release_hash_mismatch";

export class AdTemplateGeneratorReleaseError extends Error {
  readonly code: AdTemplateGeneratorReleaseErrorCode;

  constructor(code: AdTemplateGeneratorReleaseErrorCode, message: string) {
    super(message);
    this.name = "AdTemplateGeneratorReleaseError";
    this.code = code;
  }
}

export function consumeAdTemplateGeneratorRelease(
  input: unknown,
  expectedScope: { kind: "project" | "workspace"; id: string },
): ConsumedAdTemplateGeneratorRelease {
  if (!isRecord(input)) {
    throw new AdTemplateGeneratorReleaseError("invalid_shape", "Ad Template release must be an object.");
  }
  try {
    assertSafeFrankReleaseEnvelope(input);
  } catch (error) {
    if (error instanceof FrankReleaseSafetyError) {
      const code = error.reason === "unsafe_url" ? "unsafe_artifact_url" : "unsafe_release";
      throw new AdTemplateGeneratorReleaseError(code, error.message);
    }
    throw error;
  }
  const parsed = adTemplateGeneratorReleaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdTemplateGeneratorReleaseError("invalid_shape", "Release does not match the reviewed Frank Ad Template v1 contract.");
  }
  const release = parsed.data;
  if (release.scope.kind !== expectedScope.kind || release.scope.id !== expectedScope.id || !expectedScope.id.trim()) {
    throw new AdTemplateGeneratorReleaseError("scope_mismatch", "Release scope does not match the caller target.");
  }
  assertPublicHttpsUrl(release.template_pack.artifact_ref);
  assertPublicHttpsUrl(release.provenance.artifact_ref);
  if (release.provenance.artifact_ref !== release.template_pack.artifact_ref) {
    throw new AdTemplateGeneratorReleaseError("artifact_mismatch", "Provenance and template-pack artifact references differ.");
  }
  if (hashFrankReleaseEnvelope(input) !== release.release_hash) {
    throw new AdTemplateGeneratorReleaseError("release_hash_mismatch", "Release hash does not match the immutable envelope.");
  }

  return {
    releaseId: release.release_id,
    releaseHash: release.release_hash,
    scope: release.scope,
    settingsRevision: release.settings_revision,
    settingsRef: release.settings_ref,
    pipeline: { id: release.pipeline_id, version: release.pipeline_version },
    templatePack: release.template_pack,
    provenance: release.provenance,
    traceRef: release.trace_ref,
    qaReceipt: release.qa_receipt,
    approvalReceipt: release.approval_receipt,
    sanitizationReceipt: release.sanitization_receipt,
    releasedAt: release.released_at,
    importArtifact: {
      packUrl: release.template_pack.artifact_ref,
      packSha256: release.template_pack.sha256,
      packId: release.template_pack.pack_id,
      signature: release.template_pack.signature,
    },
  };
}

/**
 * Add delivery-authentication fields to the verified Frank artifact metadata.
 * The returned request is consumed by the existing TemplatePack importer,
 * which fetches and verifies the pack hash, schema, and Ed25519 signature.
 */
export function toTemplatePackImportRequest(
  release: ConsumedAdTemplateGeneratorRelease,
  delivery: Pick<ImportRequest, "buildId" | "issuedAt" | "nonce" | "idempotencyKey">,
): ImportRequest {
  return {
    packUrl: release.importArtifact.packUrl,
    packSha256: release.importArtifact.packSha256,
    packId: release.importArtifact.packId,
    signature: release.importArtifact.signature,
    buildId: delivery.buildId,
    issuedAt: delivery.issuedAt,
    nonce: delivery.nonce,
    idempotencyKey: delivery.idempotencyKey,
  };
}

function assertPublicHttpsUrl(value: string): void {
  if (publicFrankReleaseUrl(value) === null) {
    throw new AdTemplateGeneratorReleaseError("unsafe_artifact_url", "Template pack must use a public HTTPS artifact URL.");
  }
}
