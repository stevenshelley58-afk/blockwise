import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AdAreaMatch,
  type AdCreative,
  type AdSnapshot,
  type ObservedAd,
} from "./schemas/index.ts";
import {
  type IngestWriter,
  type PendingAreaMatch,
  type PendingCreativeUpsert,
  type PendingIngestEvent,
  type PendingObservedAdInsert,
  type PendingObservedAdPatch,
  type PendingSnapshotInsert,
} from "./ingest.ts";

/**
 * Production IngestWriter backed by Supabase service-role client.
 *
 * Every method here is the real-database equivalent of InMemoryWriter's
 * behaviour. The integrity rules (idempotency, append-only snapshots,
 * absence-confirmation) are enforced primarily at the DB level via the
 * unique indexes in 202605280003_research_engine.sql; this code is the
 * thin layer that translates the IngestWriter contract into those
 * Postgres operations.
 *
 * Construct with a service-role client only. Anon / authenticated clients
 * cannot write to research.*.
 */
export class SupabaseIngestWriter implements IngestWriter {
    private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private get researchSchema() {
    return this.client.schema("research");
  }

  async findObservedAd(args: { advertiserPageId: string; externalAdId: string }) {
    const { data, error } = await this.researchSchema
      .from("observed_ads")
      .select("*")
      .eq("advertiser_page_id", args.advertiserPageId)
      .eq("external_ad_id", args.externalAdId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapObservedAd(data) : null;
  }

  async insertObservedAd(input: PendingObservedAdInsert): Promise<ObservedAd> {
    const { data, error } = await this.researchSchema
      .from("observed_ads")
      .insert(observedAdToRow(input))
      .select("*")
      .single();
    if (error) throw error;
    return mapObservedAd(data);
  }

  async updateObservedAd(id: string, patch: PendingObservedAdPatch): Promise<ObservedAd> {
    const row = patchToRow(patch);
    const { data, error } = await this.researchSchema
      .from("observed_ads")
      .update(row)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapObservedAd(data);
  }

  async insertSnapshot(input: PendingSnapshotInsert): Promise<AdSnapshot | null> {
    // Unique on (observed_ad_id, payload_hash) — on conflict, return null.
    const { data, error } = await this.researchSchema
      .from("ad_snapshots")
      .insert({
        id: input.id,
        observed_ad_id: input.observedAdId,
        ad_fetch_run_id: input.adFetchRunId,
        source_provider: input.sourceProvider,
        payload: input.payload,
        payload_hash: input.payloadHash,
        changes_from_prior: input.changesFromPrior,
        snapshot_at: input.snapshotAt,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      // 23505 = unique_violation
      if ((error as { code?: string }).code === "23505") {
        return null;
      }
      throw error;
    }
    return data ? mapSnapshot(data) : null;
  }

  async upsertCreative(input: PendingCreativeUpsert): Promise<AdCreative> {
    // Find existing creative by observed_ad_id (one creative per ad at a time)
    const { data: existing, error: lookupErr } = await this.researchSchema
      .from("ad_creatives")
      .select("id")
      .eq("observed_ad_id", input.observedAdId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;

    const row = {
      observed_ad_id: input.observedAdId,
      ad_snapshot_id: input.adSnapshotId,
      format: input.format,
      headline: input.headline,
      body: input.body,
      cta: input.cta,
      cta_url: input.ctaUrl,
      primary_image_url: input.primaryImageUrl,
      image_urls: input.imageUrls,
      image_storage_path: input.imageStoragePath,
      video_url: input.videoUrl,
      video_storage_path: input.videoStoragePath,
      video_thumbnail_url: input.videoThumbnailUrl,
      media_assets: input.mediaAssets,
      landing_url: input.landingUrl,
      locale: input.locale,
      language: input.language,
      creative_hash: input.creativeHash,
    };

    if (existing) {
      const { data, error } = await this.researchSchema
        .from("ad_creatives")
        .update(row)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return mapCreative(data);
    }

    const { data, error } = await this.researchSchema
      .from("ad_creatives")
      .insert({ id: input.id || randomUUID(), ...row })
      .select("*")
      .single();
    if (error) throw error;
    return mapCreative(data);
  }

  async insertAreaMatches(matches: PendingAreaMatch[]): Promise<AdAreaMatch[]> {
    if (matches.length === 0) return [];
    const rows = matches.map((m) => ({
      id: m.id || randomUUID(),
      observed_ad_id: m.observedAdId,
      postcode: m.postcode,
      suburb: m.suburb,
      state: m.state,
      match_type: m.matchType,
      confidence: m.confidence,
      evidence: m.evidence,
    }));
    // Unique on (observed_ad_id, postcode, suburb, match_type) — upsert.
    const { data, error } = await this.researchSchema
      .from("ad_area_matches")
      .upsert(rows, { onConflict: "observed_ad_id,postcode,suburb,match_type", ignoreDuplicates: true })
      .select("*");
    if (error) throw error;
    return (data ?? []).map(mapAreaMatch);
  }

  async recordIngestEvent(input: PendingIngestEvent): Promise<void> {
    const { error } = await this.researchSchema.from("ingest_events").insert({
      id: input.id,
      event_type: input.eventType,
      table_name: input.tableName,
      row_id: input.rowId,
      payload: input.payload,
      payload_hash: input.payloadHash,
      source_provider: input.sourceProvider,
      ad_fetch_run_id: input.adFetchRunId,
    });
    if (error) throw error;
  }

  async listActiveAdsNotIn(args: {
    advertiserPageId: string;
    seenExternalAdIds: string[];
  }): Promise<ObservedAd[]> {
    let q = this.researchSchema
      .from("observed_ads")
      .select("*")
      .eq("advertiser_page_id", args.advertiserPageId)
      .neq("active_status", "inactive");
    if (args.seenExternalAdIds.length > 0) {
      // Postgres `not in` via the `not.in` filter
      const ids = args.seenExternalAdIds.map((s) => `"${s}"`).join(",");
      q = q.not("external_ad_id", "in", `(${ids})`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapObservedAd);
  }
}

// ---------------------------------------------------------------------------
// row <-> domain mappers
// ---------------------------------------------------------------------------

function observedAdToRow(input: PendingObservedAdInsert): Record<string, unknown> {
  return {
    id: input.id,
    external_ad_id: input.externalAdId,
    advertiser_page_id: input.advertiserPageId,
    first_seen_provider: input.firstSeenProvider,
    platform: input.platform,
    active_status: input.activeStatus,
    meta_publisher_platforms: input.metaPublisherPlatforms,
    ad_delivery_started_at: input.adDeliveryStartedAt,
    ad_delivery_stopped_at: input.adDeliveryStoppedAt,
    ad_creation_date: input.adCreationDate,
    raw_payload: input.rawPayload,
    payload_hash: input.payloadHash,
    metadata: input.metadata,
  };
}

function patchToRow(patch: PendingObservedAdPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.activeStatus !== undefined) out.active_status = patch.activeStatus;
  if (patch.lastSeenAt !== undefined) out.last_seen_at = patch.lastSeenAt;
  if (patch.lastCheckedAt !== undefined) out.last_checked_at = patch.lastCheckedAt;
  if (patch.missingSuccessiveChecks !== undefined)
    out.missing_successive_checks = patch.missingSuccessiveChecks;
  if (patch.metaPublisherPlatforms !== undefined)
    out.meta_publisher_platforms = patch.metaPublisherPlatforms;
  if (patch.adDeliveryStartedAt !== undefined)
    out.ad_delivery_started_at = patch.adDeliveryStartedAt;
  if (patch.adDeliveryStoppedAt !== undefined)
    out.ad_delivery_stopped_at = patch.adDeliveryStoppedAt;
  if (patch.adCreationDate !== undefined) out.ad_creation_date = patch.adCreationDate;
  if (patch.rawPayload !== undefined) out.raw_payload = patch.rawPayload;
  if (patch.payloadHash !== undefined) out.payload_hash = patch.payloadHash;
  if (patch.metadata !== undefined) out.metadata = patch.metadata;
  return out;
}

function mapObservedAd(row: Record<string, unknown>): ObservedAd {
  return {
    id: row.id as string,
    externalAdId: row.external_ad_id as string,
    advertiserPageId: row.advertiser_page_id as string,
    firstSeenProvider: row.first_seen_provider as ObservedAd["firstSeenProvider"],
    platform: row.platform as ObservedAd["platform"],
    activeStatus: row.active_status as ObservedAd["activeStatus"],
    firstSeenAt: row.first_seen_at as string,
    lastSeenAt: row.last_seen_at as string,
    lastCheckedAt: row.last_checked_at as string,
    missingSuccessiveChecks: row.missing_successive_checks as number,
    metaPublisherPlatforms: (row.meta_publisher_platforms ?? []) as string[],
    adDeliveryStartedAt: (row.ad_delivery_started_at ?? null) as string | null,
    adDeliveryStoppedAt: (row.ad_delivery_stopped_at ?? null) as string | null,
    adCreationDate: (row.ad_creation_date ?? null) as string | null,
    rawPayload: (row.raw_payload ?? {}) as Record<string, unknown>,
    payloadHash: row.payload_hash as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSnapshot(row: Record<string, unknown>): AdSnapshot {
  return {
    id: row.id as string,
    observedAdId: row.observed_ad_id as string,
    adFetchRunId: row.ad_fetch_run_id as string,
    sourceProvider: row.source_provider as AdSnapshot["sourceProvider"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    payloadHash: row.payload_hash as string,
    changesFromPrior: (row.changes_from_prior ?? {}) as Record<string, unknown>,
    snapshotAt: row.snapshot_at as string,
    createdAt: row.created_at as string,
  };
}

function mapCreative(row: Record<string, unknown>): AdCreative {
  return {
    id: row.id as string,
    observedAdId: row.observed_ad_id as string,
    adSnapshotId: (row.ad_snapshot_id ?? null) as string | null,
    format: row.format as AdCreative["format"],
    headline: (row.headline ?? null) as string | null,
    body: (row.body ?? null) as string | null,
    cta: (row.cta ?? null) as string | null,
    ctaUrl: (row.cta_url ?? null) as string | null,
    primaryImageUrl: (row.primary_image_url ?? null) as string | null,
    imageUrls: (row.image_urls ?? []) as string[],
    imageStoragePath: (row.image_storage_path ?? null) as string | null,
    videoUrl: (row.video_url ?? null) as string | null,
    videoStoragePath: (row.video_storage_path ?? null) as string | null,
    videoThumbnailUrl: (row.video_thumbnail_url ?? null) as string | null,
    mediaAssets: (row.media_assets ?? []) as AdCreative["mediaAssets"],
    landingUrl: (row.landing_url ?? null) as string | null,
    locale: (row.locale ?? null) as string | null,
    language: (row.language ?? null) as string | null,
    creativeHash: row.creative_hash as string,
    classification: row.classification as AdCreative["classification"],
    classifiedAt: (row.classified_at ?? null) as string | null,
    classifiedByDecisionId: (row.classified_by_decision_id ?? null) as string | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapAreaMatch(row: Record<string, unknown>): AdAreaMatch {
  return {
    id: row.id as string,
    observedAdId: row.observed_ad_id as string,
    postcode: row.postcode as string,
    suburb: row.suburb as string,
    state: row.state as AdAreaMatch["state"],
    matchType: row.match_type as AdAreaMatch["matchType"],
    confidence: row.confidence as number,
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}
