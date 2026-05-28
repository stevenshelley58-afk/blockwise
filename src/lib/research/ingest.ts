import { randomUUID } from "node:crypto";

import { payloadHash } from "./hash.ts";
import {
  type AdAreaMatch,
  type AdCreative,
  type AdSnapshot,
  type FetchRunResultSummary,
  type ObservedAd,
  type ObservedAdIngestInput,
  type SourceProvider,
} from "./schemas/index.ts";

/**
 * Pure ingestion core for observed ads.
 *
 * The writer interface abstracts the DB so the same code runs against a
 * Supabase client in production and against an in-memory store in tests.
 *
 * Integrity rules enforced here (these are the SLA):
 *
 *   1. IDEMPOTENT UPSERT. If (advertiser_page_id, external_ad_id) already
 *      exists AND payload_hash matches, only last_seen_at and
 *      last_checked_at advance. No snapshot is written.
 *
 *   2. CHANGE → APPEND. If the same observed_ad has a different payload_hash
 *      from its prior, write a new ad_snapshots row.
 *
 *   3. ABSENCE CONFIRMATION. Ads seen previously but not in this run have
 *      missing_successive_checks incremented. They are only flipped to
 *      active_status='inactive' when missing_successive_checks >= 2.
 *
 *   4. PROVIDER FAILURE NEVER OVERWRITES. If the fetch run status is
 *      'failed', NO upserts happen and no absence increments happen.
 *      The caller is responsible for passing status='success'|'partial'
 *      before invoking applyRunOutcome.
 *
 *   5. last_checked_at advances ONLY on successful runs.
 */

export type IngestWriter = {
  /**
   * Find an existing observed_ad by (advertiser_page_id, external_ad_id).
   */
  findObservedAd(args: {
    advertiserPageId: string;
    externalAdId: string;
  }): Promise<ObservedAd | null>;

  /**
   * Insert a new observed_ad. Must return the inserted row with id/timestamps.
   */
  insertObservedAd(input: PendingObservedAdInsert): Promise<ObservedAd>;

  /**
   * Update an existing observed_ad. Only fields listed in input are written.
   */
  updateObservedAd(
    id: string,
    patch: PendingObservedAdPatch,
  ): Promise<ObservedAd>;

  /**
   * Append a snapshot. Unique on (observed_ad_id, payload_hash) — caller
   * must catch the unique violation and treat it as "no-op."
   */
  insertSnapshot(input: PendingSnapshotInsert): Promise<AdSnapshot | null>;

  /**
   * Upsert an ad_creative for an observed_ad. Keyed by (observed_ad_id).
   */
  upsertCreative(input: PendingCreativeUpsert): Promise<AdCreative>;

  /**
   * Insert ad_area_matches (caller dedupes by unique index).
   */
  insertAreaMatches(matches: PendingAreaMatch[]): Promise<AdAreaMatch[]>;

  /**
   * Record an ingest_events row.
   */
  recordIngestEvent(input: PendingIngestEvent): Promise<void>;

  /**
   * List currently-active observed_ads for an advertiser_page that were NOT
   * seen in the current run. Used by applyAbsence().
   */
  listActiveAdsNotIn(args: {
    advertiserPageId: string;
    seenExternalAdIds: string[];
  }): Promise<ObservedAd[]>;
};

export type PendingObservedAdInsert = {
  id: string;
  externalAdId: string;
  advertiserPageId: string;
  firstSeenProvider: SourceProvider;
  platform: ObservedAd["platform"];
  activeStatus: ObservedAd["activeStatus"];
  metaPublisherPlatforms: string[];
  adDeliveryStartedAt: string | null;
  adDeliveryStoppedAt: string | null;
  adCreationDate: string | null;
  rawPayload: Record<string, unknown>;
  payloadHash: string;
  metadata: Record<string, unknown>;
};

export type PendingObservedAdPatch = Partial<
  Pick<
    ObservedAd,
    | "activeStatus"
    | "lastSeenAt"
    | "lastCheckedAt"
    | "missingSuccessiveChecks"
    | "metaPublisherPlatforms"
    | "adDeliveryStartedAt"
    | "adDeliveryStoppedAt"
    | "adCreationDate"
    | "rawPayload"
    | "payloadHash"
    | "metadata"
  >
>;

export type PendingSnapshotInsert = {
  id: string;
  observedAdId: string;
  adFetchRunId: string;
  sourceProvider: SourceProvider;
  payload: Record<string, unknown>;
  payloadHash: string;
  changesFromPrior: Record<string, unknown>;
  snapshotAt: string;
};

export type PendingCreativeUpsert = {
  id: string;
  observedAdId: string;
  adSnapshotId: string | null;
  format: AdCreative["format"];
  headline: string | null;
  body: string | null;
  cta: string | null;
  ctaUrl: string | null;
  primaryImageUrl: string | null;
  imageUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  landingUrl: string | null;
  locale: string | null;
  language: string | null;
  creativeHash: string;
};

export type PendingAreaMatch = {
  id: string;
  observedAdId: string;
  postcode: string;
  suburb: string;
  state: string;
  matchType: AdAreaMatch["matchType"];
  confidence: number;
  evidence: Record<string, unknown>;
};

export type PendingIngestEvent = {
  id: string;
  eventType: "insert" | "update" | "upsert" | "mark_inactive" | "delete" | "merge" | "split";
  tableName: string;
  rowId: string;
  payload: Record<string, unknown>;
  payloadHash: string | null;
  sourceProvider: SourceProvider | null;
  adFetchRunId: string | null;
};

export type ApplyObservationInput = {
  observation: ObservedAdIngestInput;
  payloadHash: string;
  adFetchRunId: string;
  sourceProvider: SourceProvider;
  now: string;
};

export type ApplyObservationOutcome =
  | { kind: "inserted"; observedAd: ObservedAd; snapshot: AdSnapshot }
  | { kind: "updated"; observedAd: ObservedAd; snapshot: AdSnapshot }
  | { kind: "unchanged"; observedAd: ObservedAd };

/**
 * Idempotently apply a single ad observation. Pure-ish: takes a writer
 * and a clock-injected `now`. Returns what happened so the caller can
 * tally a run result_summary.
 */
export async function applyObservation(
  writer: IngestWriter,
  input: ApplyObservationInput,
): Promise<ApplyObservationOutcome> {
  const { observation, payloadHash: newHash, adFetchRunId, sourceProvider, now } = input;

  const existing = await writer.findObservedAd({
    advertiserPageId: observation.advertiserPageId,
    externalAdId: observation.externalAdId,
  });

  if (!existing) {
    const newId = randomUUID();
    const observedAd = await writer.insertObservedAd({
      id: newId,
      externalAdId: observation.externalAdId,
      advertiserPageId: observation.advertiserPageId,
      firstSeenProvider: observation.observedByProvider,
      platform: observation.platform,
      activeStatus: observation.activeStatus,
      metaPublisherPlatforms: observation.metaPublisherPlatforms,
      adDeliveryStartedAt: observation.adDeliveryStartedAt ?? null,
      adDeliveryStoppedAt: observation.adDeliveryStoppedAt ?? null,
      adCreationDate: observation.adCreationDate ?? null,
      rawPayload: observation.rawPayload as Record<string, unknown>,
      payloadHash: newHash,
      metadata: observation.metadata as Record<string, unknown>,
    });

    const snapshot = await writer.insertSnapshot({
      id: randomUUID(),
      observedAdId: observedAd.id,
      adFetchRunId,
      sourceProvider,
      payload: observation.rawPayload as Record<string, unknown>,
      payloadHash: newHash,
      changesFromPrior: {},
      snapshotAt: now,
    });

    await writer.recordIngestEvent({
      id: randomUUID(),
      eventType: "insert",
      tableName: "research.observed_ads",
      rowId: observedAd.id,
      payload: observation.rawPayload as Record<string, unknown>,
      payloadHash: newHash,
      sourceProvider,
      adFetchRunId,
    });

    return { kind: "inserted", observedAd, snapshot: snapshot! };
  }

  if (existing.payloadHash === newHash) {
    const updated = await writer.updateObservedAd(existing.id, {
      lastSeenAt: now,
      lastCheckedAt: now,
      missingSuccessiveChecks: 0,
      activeStatus: observation.activeStatus,
    });
    await writer.recordIngestEvent({
      id: randomUUID(),
      eventType: "update",
      tableName: "research.observed_ads",
      rowId: updated.id,
      payload: { lastSeenAt: now, payloadUnchanged: true },
      payloadHash: newHash,
      sourceProvider,
      adFetchRunId,
    });
    return { kind: "unchanged", observedAd: updated };
  }

  const updated = await writer.updateObservedAd(existing.id, {
    lastSeenAt: now,
    lastCheckedAt: now,
    missingSuccessiveChecks: 0,
    activeStatus: observation.activeStatus,
    metaPublisherPlatforms: observation.metaPublisherPlatforms,
    adDeliveryStartedAt: observation.adDeliveryStartedAt ?? null,
    adDeliveryStoppedAt: observation.adDeliveryStoppedAt ?? null,
    adCreationDate: observation.adCreationDate ?? null,
    rawPayload: observation.rawPayload as Record<string, unknown>,
    payloadHash: newHash,
    metadata: observation.metadata as Record<string, unknown>,
  });

  const diff = diffPayloads(existing.rawPayload as Record<string, unknown>, observation.rawPayload as Record<string, unknown>);
  const snapshot = await writer.insertSnapshot({
    id: randomUUID(),
    observedAdId: updated.id,
    adFetchRunId,
    sourceProvider,
    payload: observation.rawPayload as Record<string, unknown>,
    payloadHash: newHash,
    changesFromPrior: diff,
    snapshotAt: now,
  });

  await writer.recordIngestEvent({
    id: randomUUID(),
    eventType: "update",
    tableName: "research.observed_ads",
    rowId: updated.id,
    payload: { diff },
    payloadHash: newHash,
    sourceProvider,
    adFetchRunId,
  });

  return { kind: "updated", observedAd: updated, snapshot: snapshot! };
}

/**
 * After a SUCCESSFUL fetch run for an advertiser_page, increment
 * missing_successive_checks for any ad that we previously thought was
 * active but did not see in this run. Flip to inactive only when the
 * counter crosses 2.
 *
 * NEVER call this for a failed run. Provider failure != ad gone.
 */
export async function applyAbsence(
  writer: IngestWriter,
  args: {
    advertiserPageId: string;
    seenExternalAdIds: string[];
    adFetchRunId: string;
    sourceProvider: SourceProvider;
    now: string;
    inactiveThreshold?: number;
  },
): Promise<{ incremented: number; markedInactive: number }> {
  const threshold = args.inactiveThreshold ?? 2;
  const missing = await writer.listActiveAdsNotIn({
    advertiserPageId: args.advertiserPageId,
    seenExternalAdIds: args.seenExternalAdIds,
  });

  let incremented = 0;
  let markedInactive = 0;

  for (const ad of missing) {
    const nextCount = ad.missingSuccessiveChecks + 1;
    const willMarkInactive = nextCount >= threshold && ad.activeStatus !== "inactive";
    const updated = await writer.updateObservedAd(ad.id, {
      missingSuccessiveChecks: nextCount,
      lastCheckedAt: args.now,
      activeStatus: willMarkInactive ? "inactive" : ad.activeStatus,
    });
    incremented += 1;
    if (willMarkInactive) {
      markedInactive += 1;
      await writer.recordIngestEvent({
        id: randomUUID(),
        eventType: "mark_inactive",
        tableName: "research.observed_ads",
        rowId: updated.id,
        payload: { missing_successive_checks: nextCount, threshold },
        payloadHash: null,
        sourceProvider: args.sourceProvider,
        adFetchRunId: args.adFetchRunId,
      });
    }
  }

  return { incremented, markedInactive };
}

/**
 * Combine the outcomes of many applyObservation calls into a single
 * fetch run result_summary. The caller writes this back into
 * ad_fetch_runs.result_summary.
 */
export function summariseOutcomes(
  outcomes: ApplyObservationOutcome[],
  absence: { incremented: number; markedInactive: number },
  extras: { creditsSpent?: number; warnings?: string[]; errorCount?: number } = {},
): FetchRunResultSummary {
  return {
    adsObserved: outcomes.length,
    adsNew: outcomes.filter((o) => o.kind === "inserted").length,
    adsUpdated: outcomes.filter((o) => o.kind === "updated").length,
    adsUnchanged: outcomes.filter((o) => o.kind === "unchanged").length,
    adsMissing: absence.incremented,
    creditsSpent: extras.creditsSpent ?? 0,
    errorCount: extras.errorCount ?? 0,
    warnings: [
      ...(extras.warnings ?? []),
      ...(absence.markedInactive > 0
        ? [`${absence.markedInactive} ads marked inactive after threshold`]
        : []),
    ],
  };
}

function diffPayloads(prior: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prior), ...Object.keys(next)]);
  for (const key of keys) {
    const a = prior[key];
    const b = next[key];
    if (payloadHash(a) !== payloadHash(b)) {
      diff[key] = { from: a ?? null, to: b ?? null };
    }
  }
  return diff;
}
