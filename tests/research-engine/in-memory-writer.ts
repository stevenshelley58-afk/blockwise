import { randomUUID } from "node:crypto";

import {
  type AdAreaMatch,
  type AdCreative,
  type AdSnapshot,
  type ObservedAd,
} from "../../src/lib/research/schemas/index.ts";
import {
  type IngestWriter,
  type PendingAreaMatch,
  type PendingCreativeUpsert,
  type PendingIngestEvent,
  type PendingObservedAdInsert,
  type PendingObservedAdPatch,
  type PendingSnapshotInsert,
} from "../../src/lib/research/ingest.ts";

/**
 * In-memory IngestWriter used by Phase 1 unit tests.
 *
 * Behaves like the real DB writer for the operations the ingestion core
 * uses: idempotent upserts, unique snapshots, append-only events, listing
 * "active ads not in this run" for absence-confirmation.
 */
export class InMemoryWriter implements IngestWriter {
  observedAds = new Map<string, ObservedAd>();
  snapshots = new Map<string, AdSnapshot>();
  creatives = new Map<string, AdCreative>();
  areaMatches = new Map<string, AdAreaMatch>();
  ingestEvents: PendingIngestEvent[] = [];

  private byPageExternal(advertiserPageId: string, externalAdId: string): ObservedAd | null {
    for (const ad of this.observedAds.values()) {
      if (ad.advertiserPageId === advertiserPageId && ad.externalAdId === externalAdId) {
        return ad;
      }
    }
    return null;
  }

  async findObservedAd(args: { advertiserPageId: string; externalAdId: string }) {
    return this.byPageExternal(args.advertiserPageId, args.externalAdId);
  }

  async insertObservedAd(input: PendingObservedAdInsert): Promise<ObservedAd> {
    if (this.byPageExternal(input.advertiserPageId, input.externalAdId)) {
      throw new Error(
        `duplicate observed_ad (advertiser_page_id, external_ad_id): ${input.advertiserPageId}, ${input.externalAdId}`,
      );
    }
    const nowIso = new Date().toISOString();
    const row: ObservedAd = {
      id: input.id,
      externalAdId: input.externalAdId,
      advertiserPageId: input.advertiserPageId,
      firstSeenProvider: input.firstSeenProvider,
      platform: input.platform,
      activeStatus: input.activeStatus,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastCheckedAt: nowIso,
      missingSuccessiveChecks: 0,
      metaPublisherPlatforms: input.metaPublisherPlatforms,
      adDeliveryStartedAt: input.adDeliveryStartedAt,
      adDeliveryStoppedAt: input.adDeliveryStoppedAt,
      adCreationDate: input.adCreationDate,
      rawPayload: input.rawPayload,
      payloadHash: input.payloadHash,
      metadata: input.metadata,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.observedAds.set(row.id, row);
    return row;
  }

  async updateObservedAd(id: string, patch: PendingObservedAdPatch): Promise<ObservedAd> {
    const existing = this.observedAds.get(id);
    if (!existing) {
      throw new Error(`observed_ad not found: ${id}`);
    }
    const updated: ObservedAd = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.observedAds.set(id, updated);
    return updated;
  }

  async insertSnapshot(input: PendingSnapshotInsert): Promise<AdSnapshot | null> {
    // Enforce the unique (observed_ad_id, payload_hash) constraint by
    // returning null if a snapshot with the same hash already exists.
    for (const snap of this.snapshots.values()) {
      if (
        snap.observedAdId === input.observedAdId &&
        snap.payloadHash === input.payloadHash
      ) {
        return null;
      }
    }
    const row: AdSnapshot = {
      id: input.id,
      observedAdId: input.observedAdId,
      adFetchRunId: input.adFetchRunId,
      sourceProvider: input.sourceProvider,
      payload: input.payload,
      payloadHash: input.payloadHash,
      changesFromPrior: input.changesFromPrior,
      snapshotAt: input.snapshotAt,
      createdAt: new Date().toISOString(),
    };
    this.snapshots.set(row.id, row);
    return row;
  }

  async upsertCreative(input: PendingCreativeUpsert): Promise<AdCreative> {
    const existing = [...this.creatives.values()].find(
      (c) => c.observedAdId === input.observedAdId,
    );
    const nowIso = new Date().toISOString();
    if (existing) {
      const updated: AdCreative = {
        ...existing,
        ...input,
        updatedAt: nowIso,
      } as AdCreative;
      this.creatives.set(existing.id, updated);
      return updated;
    }
    const row: AdCreative = {
      id: input.id,
      observedAdId: input.observedAdId,
      adSnapshotId: input.adSnapshotId,
      format: input.format,
      headline: input.headline,
      body: input.body,
      cta: input.cta,
      ctaUrl: input.ctaUrl,
      primaryImageUrl: input.primaryImageUrl,
      imageUrls: input.imageUrls,
      imageStoragePath: input.imageStoragePath,
      videoUrl: input.videoUrl,
      videoStoragePath: input.videoStoragePath,
      videoThumbnailUrl: input.videoThumbnailUrl,
      mediaAssets: input.mediaAssets,
      landingUrl: input.landingUrl,
      locale: input.locale,
      language: input.language,
      creativeHash: input.creativeHash,
      classification: undefined,
      classifiedAt: null,
      classifiedByDecisionId: null,
      metadata: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.creatives.set(row.id, row);
    return row;
  }

  async insertAreaMatches(matches: PendingAreaMatch[]): Promise<AdAreaMatch[]> {
    const out: AdAreaMatch[] = [];
    for (const m of matches) {
      const key = `${m.observedAdId}:${m.postcode}:${m.suburb}:${m.matchType}`;
      if ([...this.areaMatches.values()].some(
        (existing) =>
          existing.observedAdId === m.observedAdId &&
          existing.postcode === m.postcode &&
          existing.suburb === m.suburb &&
          existing.matchType === m.matchType,
      )) {
        continue;
      }
      const row: AdAreaMatch = {
        id: m.id || randomUUID(),
        observedAdId: m.observedAdId,
        postcode: m.postcode,
        suburb: m.suburb,
        state: m.state as AdAreaMatch["state"],
        matchType: m.matchType,
        confidence: m.confidence,
        evidence: m.evidence,
        createdAt: new Date().toISOString(),
      };
      this.areaMatches.set(key, row);
      out.push(row);
    }
    return out;
  }

  async recordIngestEvent(input: PendingIngestEvent): Promise<void> {
    this.ingestEvents.push(input);
  }

  async listActiveAdsNotIn(args: {
    advertiserPageId: string;
    seenExternalAdIds: string[];
  }): Promise<ObservedAd[]> {
    const seen = new Set(args.seenExternalAdIds);
    const out: ObservedAd[] = [];
    for (const ad of this.observedAds.values()) {
      if (ad.advertiserPageId !== args.advertiserPageId) continue;
      if (ad.activeStatus === "inactive") continue;
      if (seen.has(ad.externalAdId)) continue;
      out.push(ad);
    }
    return out;
  }
}
