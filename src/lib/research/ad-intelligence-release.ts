import { sha256Hex } from "../../../packages/ad-template-pack-contract/src/hash.ts";
import { z } from "zod";

import {
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "./customer-meta-card.ts";

/** Exact reviewed Frank release identity. */
export const AD_INTELLIGENCE_RELEASE_SCHEMA = "schema://frank.ad-intelligence-release/v1" as const;
export const AD_INTELLIGENCE_TOOL_ID = "ad-intelligence" as const;
export const AD_INTELLIGENCE_PUBLIC_EXPORT_SCHEMA = "schema://frank.ad-intelligence-public/v1" as const;
export const AD_INTELLIGENCE_PIPELINE_ID = "ad-radar-pipeline" as const;
export const AD_INTELLIGENCE_PIPELINE_VERSION = "1.0.0" as const;
export const AD_INTELLIGENCE_CONSUMER_COMPATIBILITY = "ad-intelligence-public-v1" as const;

const unsafeText = /<\/?[a-z][^>]*>|javascript\s*:|bearer\s+[a-z0-9._~+/=-]{16,}|(?:sk|pk|rk)_(?:live|test)_[a-z0-9]+|-----begin [a-z ]+-----/iu;
const piiLikeText = /(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d)/u;
const privateRef = /^(?:openbao|vault|secret|file):\/\//iu;

const safeText = (max: number) => z.string().min(1).max(max).refine((value) => !unsafeText.test(value));
const nullableSafeText = (max: number) => safeText(max).nullable();
const safeRef = safeText(500).refine((value) => !privateRef.test(value));
const safeRefList = z.array(safeRef).min(1).max(100);

const publicCopySchema = z
  .object({
    headline: nullableSafeText(1000),
    body: nullableSafeText(5000),
    cta: nullableSafeText(240),
  })
  .strict();

const publicObservedSchema = z
  .object({
    first_seen: nullableSafeText(80),
    last_seen: nullableSafeText(80),
  })
  .strict();

const publicMediaSchema = z
  .object({
    asset_ref: safeRef,
    kind: safeText(80),
    width: z.number().int().nonnegative().nullable(),
    height: z.number().int().nonnegative().nullable(),
    qa_status: z.literal("passed"),
  })
  .strict();

const publicClassificationSchema = z
  .object({
    label: safeText(160),
    confidence: z.number().finite().min(0).max(1),
    receipt_refs: z.array(safeRef).max(100),
    provenance_refs: z.array(safeRef).max(100),
  })
  .strict();

const publicCreativeSchema = z
  .object({
    id: safeText(240),
    source_ref: safeRef,
    advertiser: nullableSafeText(240),
    market: nullableSafeText(160),
    category: nullableSafeText(160),
    copy: publicCopySchema,
    destination_ref: safeRef.nullable(),
    observed: publicObservedSchema,
    media: z.array(publicMediaSchema).max(20),
    classification: publicClassificationSchema.nullable(),
  })
  .strict();

const publicExportSchema = z
  .object({
    schema: z.literal(AD_INTELLIGENCE_PUBLIC_EXPORT_SCHEMA),
    project: safeText(240),
    generated_at: safeText(80),
    creatives: z.array(publicCreativeSchema).max(5000),
  })
  .strict();

const releaseSchema = z
  .object({
    schema: z.literal(AD_INTELLIGENCE_RELEASE_SCHEMA),
    tool_id: z.literal(AD_INTELLIGENCE_TOOL_ID),
    release_id: safeText(240),
    version: safeText(120),
    status: z.literal("released"),
    immutable: z.literal(true),
    project_scope: safeText(240),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    release_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    provenance_refs: safeRefList,
    trace_refs: safeRefList,
    settings_refs: safeRefList,
    qa_approved: z.literal(true),
    pii_sanitized: z.literal(true),
    secret_sanitized: z.literal(true),
    pipeline_id: z.literal(AD_INTELLIGENCE_PIPELINE_ID),
    pipeline_version: z.literal(AD_INTELLIGENCE_PIPELINE_VERSION),
    consumer_compatibility: z.tuple([z.literal(AD_INTELLIGENCE_CONSUMER_COMPATIBILITY)]),
    qa_receipt_ref: safeRef,
    sanitization_receipt_refs: safeRefList,
    public_export: publicExportSchema,
  })
  .strict();

export type AdIntelligenceRelease = z.infer<typeof releaseSchema>;

/** Insertable row contract for the existing public customer read model. */
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

export type AdIntelligenceReleaseConsumerResult = {
  state: "ready" | "empty";
  release: Pick<
    AdIntelligenceRelease,
    "schema" | "tool_id" | "release_id" | "version" | "status" | "immutable" | "checksum" | "release_hash"
  >;
  provenanceRefs: string[];
  traceRefs: string[];
  settingsRefs: string[];
  qaReceiptRef: string;
  sanitizationReceiptRefs: string[];
  scope: string;
  rows: AdIntelligenceReleaseRow[];
  cards: CustomerMetaAdLibraryCard[];
  stableSubjectRefs: AdIntelligenceStableSubjectRef[];
};

export class AdIntelligenceReleaseError extends Error {
  public readonly code:
    | "invalid_shape"
    | "unsafe_public_export"
    | "checksum_mismatch"
    | "release_hash_mismatch"
    | "incompatible_release"
    | "duplicate_subject";

  constructor(
    code:
      | "invalid_shape"
      | "unsafe_public_export"
      | "checksum_mismatch"
      | "release_hash_mismatch"
      | "incompatible_release"
      | "duplicate_subject",
    message: string,
  ) {
    super(message);
    this.name = "AdIntelligenceReleaseError";
    this.code = code;
  }
}

/** SHA-256 of `public_export`, matching Frank's public-export checksum. */
export function computeAdIntelligencePublicExportChecksum(publicExport: unknown): string {
  return sha256Hex(publicExport);
}

/** SHA-256 of the complete release envelope excluding only `release_hash`. */
export function computeAdIntelligenceReleaseHash(input: Record<string, unknown>): string {
  const { release_hash: _releaseHash, ...unsignedRelease } = input;
  return sha256Hex(unsignedRelease);
}

/**
 * Verify one immutable Frank release and adapt its public export to the
 * existing customer Ad Radar read-model row/card contracts.
 *
 * This function is pure. It does not create a Supabase client, query research
 * tables, execute providers, or persist a release. A future publication bridge
 * can persist the returned rows through the existing public read model.
 */
export function consumeAdIntelligenceRelease(input: unknown): AdIntelligenceReleaseConsumerResult {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdIntelligenceReleaseError("invalid_shape", "Ad Intelligence release is not the reviewed Frank v1 payload.");
  }

  const release = parsed.data;
  try {
    validatePublicExportSafety(release.public_export);
  } catch {
    throw new AdIntelligenceReleaseError("unsafe_public_export", "Ad Intelligence public export contains unsafe content.");
  }

  if (computeAdIntelligencePublicExportChecksum(release.public_export) !== release.checksum) {
    throw new AdIntelligenceReleaseError("checksum_mismatch", "Ad Intelligence public-export checksum does not match.");
  }
  if (!isRecord(input) || computeAdIntelligenceReleaseHash(input) !== release.release_hash) {
    throw new AdIntelligenceReleaseError("release_hash_mismatch", "Ad Intelligence release hash does not match the envelope.");
  }
  if (release.consumer_compatibility[0] !== AD_INTELLIGENCE_CONSUMER_COMPATIBILITY) {
    throw new AdIntelligenceReleaseError("incompatible_release", "Ad Intelligence release is not compatible with the public customer export.");
  }

  const stableSubjectRefs = new Map<string, AdIntelligenceStableSubjectRef>();
  for (const creative of release.public_export.creatives) {
    const ref = stableSubjectRef(release.public_export.project, creative);
    if (stableSubjectRefs.has(ref.creativeId) || [...stableSubjectRefs.values()].some((item) => item.sourceRef === ref.sourceRef)) {
      throw new AdIntelligenceReleaseError("duplicate_subject", `Ad Intelligence release repeats subject ${creative.id}.`);
    }
    stableSubjectRefs.set(ref.creativeId, ref);
  }

  const rows = release.public_export.creatives.map((creative) =>
    toCustomerAdRadarRow(release, creative, stableSubjectRefs.get(creative.id)!),
  );
  return {
    state: rows.length > 0 ? "ready" : "empty",
    release: {
      schema: release.schema,
      tool_id: release.tool_id,
      release_id: release.release_id,
      version: release.version,
      status: release.status,
      immutable: release.immutable,
      checksum: release.checksum,
      release_hash: release.release_hash,
    },
    provenanceRefs: [...release.provenance_refs],
    traceRefs: [...release.trace_refs],
    settingsRefs: [...release.settings_refs],
    qaReceiptRef: release.qa_receipt_ref,
    sanitizationReceiptRefs: [...release.sanitization_receipt_refs],
    scope: release.project_scope,
    rows,
    cards: rows.map(normaliseCustomerMetaAdLibraryCard),
    stableSubjectRefs: [...stableSubjectRefs.values()],
  };
}

function validatePublicExportSafety(value: unknown, key = "public_export"): void {
  if (typeof value === "string") {
    if (key !== "generated_at" && key !== "first_seen" && key !== "last_seen" && piiLikeText.test(value)) {
      throw new Error("PII-like public text");
    }
    if (unsafeText.test(value) || (privateRef.test(value) && key !== "project")) throw new Error("unsafe public text");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => validatePublicExportSafety(child, `${key}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      const normalizedKey = childKey.replace(/[^a-z0-9]/giu, "").toLowerCase();
      if (/^(?:email|phone|prospect|outreach|contact|recipient|lead|raw|provider|model|prompt|secret|token|password)/u.test(normalizedKey)) {
        throw new Error("unsafe public key");
      }
      validatePublicExportSafety(child, childKey);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSubjectRef(
  project: string,
  creative: AdIntelligenceRelease["public_export"]["creatives"][number],
): AdIntelligenceStableSubjectRef {
  return {
    creativeId: creative.id,
    sourceRef: creative.source_ref,
    cardId: stableUuid(`card:${project}:${creative.id}`),
    observedAdId: stableUuid(`observed:${project}:${creative.source_ref}`),
  };
}

function stableUuid(value: string): string {
  const hex = sha256Hex(value).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function toCustomerAdRadarRow(
  release: AdIntelligenceRelease,
  creative: AdIntelligenceRelease["public_export"]["creatives"][number],
  subjectRef: AdIntelligenceStableSubjectRef,
): AdIntelligenceReleaseRow {
  const images = creative.media.filter((media) => media.kind.toLowerCase() === "image");
  const videos = creative.media.filter((media) => media.kind.toLowerCase() === "video");
  const market = creative.market;
  return {
    card_id: subjectRef.cardId,
    observed_ad_id: subjectRef.observedAdId,
    source_ad_creative_id: stableUuid(`creative:${release.public_export.project}:${creative.source_ref}`),
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
    suburb: market,
    state: null,
    postcodes: [],
    headline: creative.copy.headline,
    body: creative.copy.body,
    description: creative.category,
    cta: creative.copy.cta,
    cta_url: null,
    destination_url: creative.destination_ref,
    primary_image_url: images[0]?.asset_ref ?? null,
    image_urls: images.map((media) => media.asset_ref),
    image_storage_path: null,
    video_url: videos[0]?.asset_ref ?? null,
    video_storage_path: null,
    video_thumbnail_url: null,
    media_assets: creative.media.map((media) => ({
      kind: media.kind,
      url: media.asset_ref,
      width: media.width,
      height: media.height,
      captureStatus: "captured",
    })),
    last_seen_at: creative.observed.last_seen,
    area_match_postcode: null,
    area_match_suburb: market,
    area_match_state: null,
    area_match_type: market ? "market" : null,
    area_match_confidence: null,
    ad_area_postcodes: [],
    ad_area_suburbs: market ? [market] : [],
    service_area_postcodes: [],
    service_area_suburbs: [],
    ad_type: creative.classification?.label ?? creative.category,
    format: creative.media[0]?.kind ?? null,
    hooks: null,
  };
}
