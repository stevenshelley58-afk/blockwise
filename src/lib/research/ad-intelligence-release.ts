import { createHash } from "node:crypto";

import { z } from "zod";

import { hashFrankReleaseEnvelope, hashFrankReleaseValue, isRecord } from "../frank-release-integrity.ts";
import { publicFrankReleaseUrl } from "../frank-release-public-url.ts";
import { assertSafeFrankReleaseEnvelope, FrankReleaseSafetyError } from "../frank-release-safety.ts";
import {
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "./customer-meta-card.ts";

export const AD_INTELLIGENCE_RELEASE_SCHEMA = "schema://frank.ad-intelligence-release/v1" as const;
export const AD_INTELLIGENCE_TOOL_ID = "ad-intelligence" as const;
export const AD_INTELLIGENCE_PUBLIC_EXPORT_SCHEMA = "schema://frank.ad-intelligence-public/v1" as const;
export const AD_INTELLIGENCE_PIPELINE_ID = "ad-radar-pipeline" as const;
export const AD_INTELLIGENCE_PIPELINE_VERSION = "1.0.0" as const;
export const AD_INTELLIGENCE_CONSUMER_COMPATIBILITY = "ad-intelligence-public-v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const PRIVATE_REF_PATTERN = /^(?:openbao|vault|secret|file|private|provider):\/\//iu;

const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const safeRef = text.refine((value) => !PRIVATE_REF_PATTERN.test(value));
const uniqueRefs = z.array(safeRef).min(1).refine((items) => new Set(items).size === items.length);
const nullableText = text.nullable();

const publicExportSchema = z
  .object({
    schema: z.literal(AD_INTELLIGENCE_PUBLIC_EXPORT_SCHEMA),
    project: text,
    generated_at: timestamp,
    creatives: z.array(
      z
        .object({
          id: text,
          source_ref: safeRef,
          advertiser: nullableText,
          market: nullableText,
          category: nullableText,
          copy: z
            .object({ headline: nullableText, body: nullableText, cta: nullableText })
            .strict(),
          destination_ref: safeRef.nullable(),
          observed: z
            .object({ first_seen: timestamp.nullable(), last_seen: timestamp.nullable() })
            .strict(),
          media: z.array(
            z
              .object({
                asset_ref: safeRef,
                kind: text,
                width: z.number().int().nonnegative().nullable(),
                height: z.number().int().nonnegative().nullable(),
                qa_status: z.literal("passed"),
              })
              .strict(),
          ),
          classification: z
            .object({
              label: text,
              confidence: z.number().finite().min(0).max(1),
              receipt_refs: z.array(safeRef).refine((items) => new Set(items).size === items.length),
              provenance_refs: z.array(safeRef).refine((items) => new Set(items).size === items.length),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const adIntelligenceReleaseSchema = z
  .object({
    schema: z.literal(AD_INTELLIGENCE_RELEASE_SCHEMA),
    tool_id: z.literal(AD_INTELLIGENCE_TOOL_ID),
    pipeline_id: z.literal(AD_INTELLIGENCE_PIPELINE_ID),
    pipeline_version: z.literal(AD_INTELLIGENCE_PIPELINE_VERSION),
    consumer_compatibility: z.tuple([z.literal(AD_INTELLIGENCE_CONSUMER_COMPATIBILITY)]),
    release_id: text,
    version: z.string().regex(SEMVER_PATTERN),
    status: z.literal("released"),
    released_at: timestamp,
    immutable: z.literal(true),
    project_scope: text,
    checksum: z.string().regex(SHA256_PATTERN),
    provenance_refs: uniqueRefs,
    trace_refs: uniqueRefs,
    settings_revision: z.number().int().positive(),
    settings_ref: safeRef,
    qa_receipt: z
      .object({ decision: z.literal("pass"), receipt_ref: safeRef, checked_at: timestamp })
      .strict(),
    sanitization_receipts: z
      .object({
        pii_scan: z
          .object({ status: z.literal("passed"), receipt_id: text, scanned_at: timestamp })
          .strict(),
        secret_scan: z
          .object({ status: z.literal("passed"), receipt_id: text, scanned_at: timestamp })
          .strict(),
      })
      .strict(),
    release_hash: z.string().regex(SHA256_PATTERN),
    public_export: publicExportSchema,
  })
  .strict();

export type AdIntelligenceRelease = z.infer<typeof adIntelligenceReleaseSchema>;
export type AdIntelligenceCreative = AdIntelligenceRelease["public_export"]["creatives"][number];
export type AdIntelligenceMedia = AdIntelligenceCreative["media"][number];

export type AdIntelligenceReleaseRow = CustomerMetaAdLibraryCardRow & {
  observed_ad_id: string;
  source_ad_creative_id: string;
  source_revision: string;
};

export type AdIntelligenceStableSubjectRef = {
  creativeId: string;
  sourceRef: string;
  cardId: string;
  observedAdId: string;
};

export type AdIntelligenceMediaReference = {
  creativeId: string;
  assetRef: string;
  resolvedUrl: string | null;
  kind: string;
  width: number | null;
  height: number | null;
  qaStatus: "passed";
};

export type TrustedAdIntelligenceMediaResolver = (
  assetRef: string,
  context: { creativeId: string; media: AdIntelligenceMedia },
) => string | null;

export type AdIntelligenceReleaseConsumerResult = {
  state: "ready" | "empty";
  release: Pick<
    AdIntelligenceRelease,
    "schema" | "tool_id" | "release_id" | "version" | "status" | "released_at" | "immutable" | "checksum" | "release_hash"
  >;
  scope: string;
  settingsRevision: number;
  settingsRef: string;
  provenanceRefs: string[];
  traceRefs: string[];
  qaReceipt: AdIntelligenceRelease["qa_receipt"];
  sanitizationReceipts: AdIntelligenceRelease["sanitization_receipts"];
  rows: AdIntelligenceReleaseRow[];
  cards: CustomerMetaAdLibraryCard[];
  stableSubjectRefs: AdIntelligenceStableSubjectRef[];
  mediaReferences: AdIntelligenceMediaReference[];
};

export type AdIntelligenceReleaseErrorCode =
  | "invalid_shape"
  | "unsafe_public_export"
  | "scope_mismatch"
  | "checksum_mismatch"
  | "release_hash_mismatch"
  | "duplicate_subject"
  | "invalid_media_resolution";

export class AdIntelligenceReleaseError extends Error {
  readonly code: AdIntelligenceReleaseErrorCode;

  constructor(code: AdIntelligenceReleaseErrorCode, message: string) {
    super(message);
    this.name = "AdIntelligenceReleaseError";
    this.code = code;
  }
}

export function computeAdIntelligencePublicExportChecksum(publicExport: unknown): string {
  return hashFrankReleaseValue(publicExport);
}

export function computeAdIntelligenceReleaseHash(input: Record<string, unknown>): string {
  return hashFrankReleaseEnvelope(input);
}

export function consumeAdIntelligenceRelease(
  input: unknown,
  expectedProjectScope: string,
  options: { resolveMediaRef?: TrustedAdIntelligenceMediaResolver } = {},
): AdIntelligenceReleaseConsumerResult {
  if (!isRecord(input)) {
    throw new AdIntelligenceReleaseError("invalid_shape", "Ad Intelligence release must be an object.");
  }
  if (!expectedProjectScope.trim()) {
    throw new AdIntelligenceReleaseError("scope_mismatch", "A caller project target is required.");
  }

  try {
    assertSafeFrankReleaseEnvelope(input);
  } catch (error) {
    if (error instanceof FrankReleaseSafetyError) {
      throw new AdIntelligenceReleaseError("unsafe_public_export", error.message);
    }
    throw error;
  }
  const parsed = adIntelligenceReleaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdIntelligenceReleaseError("invalid_shape", "Release does not match the reviewed Frank Ad Intelligence v1 contract.");
  }
  const release = parsed.data;
  if (release.project_scope !== expectedProjectScope || release.public_export.project !== expectedProjectScope) {
    throw new AdIntelligenceReleaseError("scope_mismatch", "Release scope and public export must both match the caller target.");
  }
  if (release.project_scope !== release.public_export.project) {
    throw new AdIntelligenceReleaseError("scope_mismatch", "Release scope does not match its public export.");
  }
  assertAdTimeline(release);
  if (computeAdIntelligencePublicExportChecksum(release.public_export) !== release.checksum) {
    throw new AdIntelligenceReleaseError("checksum_mismatch", "Public export checksum does not match.");
  }
  if (computeAdIntelligenceReleaseHash(input) !== release.release_hash) {
    throw new AdIntelligenceReleaseError("release_hash_mismatch", "Release hash does not match the immutable envelope.");
  }

  const stableSubjectRefs = buildStableSubjectRefs(release);
  const mediaReferences = resolveMediaReferences(release, options.resolveMediaRef);
  const rows = release.public_export.creatives.map((creative) =>
    toCustomerAdRadarRow(release, creative, stableSubjectRefs.get(creative.id)!, mediaReferences),
  );

  return {
    state: rows.length ? "ready" : "empty",
    release: {
      schema: release.schema,
      tool_id: release.tool_id,
      release_id: release.release_id,
      version: release.version,
      status: release.status,
      released_at: release.released_at,
      immutable: release.immutable,
      checksum: release.checksum,
      release_hash: release.release_hash,
    },
    scope: release.project_scope,
    settingsRevision: release.settings_revision,
    settingsRef: release.settings_ref,
    provenanceRefs: [...release.provenance_refs],
    traceRefs: [...release.trace_refs],
    qaReceipt: release.qa_receipt,
    sanitizationReceipts: release.sanitization_receipts,
    rows,
    cards: rows.map(normaliseCustomerMetaAdLibraryCard),
    stableSubjectRefs: [...stableSubjectRefs.values()],
    mediaReferences,
  };
}

function assertAdTimeline(release: AdIntelligenceRelease): void {
  const generatedAt = Date.parse(release.public_export.generated_at);
  if (Date.parse(release.released_at) < generatedAt) {
    throw new AdIntelligenceReleaseError("invalid_shape", "Release timestamp precedes public export generation.");
  }
  for (const creative of release.public_export.creatives) {
    const firstSeen = creative.observed.first_seen === null ? null : Date.parse(creative.observed.first_seen);
    const lastSeen = creative.observed.last_seen === null ? null : Date.parse(creative.observed.last_seen);
    if ((firstSeen !== null && firstSeen > generatedAt) || (lastSeen !== null && lastSeen > generatedAt)) {
      throw new AdIntelligenceReleaseError("invalid_shape", "Creative observation occurs after public export generation.");
    }
    if (firstSeen !== null && lastSeen !== null && firstSeen > lastSeen) {
      throw new AdIntelligenceReleaseError("invalid_shape", "Creative first_seen occurs after last_seen.");
    }
  }
}

function buildStableSubjectRefs(release: AdIntelligenceRelease): Map<string, AdIntelligenceStableSubjectRef> {
  const result = new Map<string, AdIntelligenceStableSubjectRef>();
  const sourceRefs = new Set<string>();
  for (const creative of release.public_export.creatives) {
    if (result.has(creative.id) || sourceRefs.has(creative.source_ref)) {
      throw new AdIntelligenceReleaseError("duplicate_subject", `Release repeats creative subject ${creative.id}.`);
    }
    sourceRefs.add(creative.source_ref);
    result.set(creative.id, {
      creativeId: creative.id,
      sourceRef: creative.source_ref,
      cardId: stableUuid(`card:${release.project_scope}:${creative.id}`),
      observedAdId: stableUuid(`observed:${release.project_scope}:${creative.source_ref}`),
    });
  }
  return result;
}

function resolveMediaReferences(
  release: AdIntelligenceRelease,
  resolver: TrustedAdIntelligenceMediaResolver | undefined,
): AdIntelligenceMediaReference[] {
  return release.public_export.creatives.flatMap((creative) =>
    creative.media.map((media) => {
      let resolvedUrl = publicHttpsUrl(media.asset_ref);
      if (!resolvedUrl && resolver) {
        const candidate = resolver(media.asset_ref, { creativeId: creative.id, media });
        const trustedUrl = typeof candidate === "string" ? publicHttpsUrl(candidate) : null;
        if (candidate !== null && trustedUrl === null) {
          throw new AdIntelligenceReleaseError("invalid_media_resolution", "Trusted media resolver returned a non-public URL.");
        }
        resolvedUrl = trustedUrl;
      }
      return {
        creativeId: creative.id,
        assetRef: media.asset_ref,
        resolvedUrl,
        kind: media.kind,
        width: media.width,
        height: media.height,
        qaStatus: media.qa_status,
      };
    }),
  );
}

function toCustomerAdRadarRow(
  release: AdIntelligenceRelease,
  creative: AdIntelligenceCreative,
  subject: AdIntelligenceStableSubjectRef,
  mediaReferences: AdIntelligenceMediaReference[],
): AdIntelligenceReleaseRow {
  const media = mediaReferences.filter((entry) => entry.creativeId === creative.id && entry.resolvedUrl !== null);
  const images = media.filter((entry) => entry.kind.toLowerCase() === "image");
  const videos = media.filter((entry) => entry.kind.toLowerCase() === "video");
  return {
    card_id: subject.cardId,
    observed_ad_id: subject.observedAdId,
    source_ad_creative_id: stableUuid(`creative:${release.project_scope}:${creative.source_ref}`),
    source_revision: `${release.release_id}@${release.version}`,
    library_id: creative.id,
    agent_id: null,
    agent_name: null,
    agency_id: null,
    agency_name: null,
    attribution_links: [],
    page_id: null,
    page_name: creative.advertiser,
    page_url: null,
    page_image_url: null,
    active_status: "unknown",
    ad_delivery_started_at: creative.observed.first_seen,
    ad_delivery_stopped_at: null,
    publisher_platforms: [],
    postcode: null,
    suburb: creative.market,
    state: null,
    postcodes: [],
    headline: creative.copy.headline,
    body: creative.copy.body,
    description: creative.category,
    cta: creative.copy.cta,
    cta_url: null,
    destination_url: creative.destination_ref ? publicHttpsUrl(creative.destination_ref) : null,
    primary_image_url: images[0]?.resolvedUrl ?? null,
    image_urls: images.flatMap((entry) => entry.resolvedUrl ? [entry.resolvedUrl] : []),
    image_storage_path: null,
    video_url: videos[0]?.resolvedUrl ?? null,
    video_storage_path: null,
    video_thumbnail_url: null,
    media_assets: media.map((entry) => ({
      kind: entry.kind,
      url: entry.resolvedUrl,
      width: entry.width,
      height: entry.height,
      captureStatus: "captured",
    })),
    last_seen_at: creative.observed.last_seen,
    area_match_postcode: null,
    area_match_suburb: creative.market,
    area_match_state: null,
    area_match_type: creative.market ? "market" : null,
    area_match_confidence: null,
    ad_area_postcodes: [],
    ad_area_suburbs: creative.market ? [creative.market] : [],
    service_area_postcodes: [],
    service_area_suburbs: [],
    ad_type: creative.classification?.label ?? creative.category,
    format: creative.media[0]?.kind ?? null,
    hooks: null,
  };
}

function publicHttpsUrl(value: string): string | null {
  return publicFrankReleaseUrl(value);
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
