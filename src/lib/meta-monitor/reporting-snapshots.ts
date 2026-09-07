import { createHash } from "node:crypto";

import * as Sentry from "@sentry/core";

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";

import { resolveMonitorDateRange, type MonitorCustomRange } from "../monitor/dashboard-data.ts";
import { getResultsPayload } from "./getResultsPayload.ts";
import {
  reportIndicatesMetaDelivery,
  startTrialOnFirstDeliveryBestEffort,
} from "../trial/first-delivery.ts";
import { buildSampleMetaMonitorPayload } from "./sampleMetaMonitorData.ts";
import type { MetaMonitorPayload, MonitorRange } from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const REPORTING_SNAPSHOT_VERSION = 1 as const;
export const REPORTING_SNAPSHOT_TTL_MS = 15 * 60 * 1000;

export type ReportingSnapshotV1 = {
  version: typeof REPORTING_SNAPSHOT_VERSION;
  workspaceId: string;
  rangeKey: string;
  generatedAt: string;
  staleAt: string;
  etag: string;
  payload: MetaMonitorPayload;
};

type ReportingSnapshotRow = {
  workspace_id: string;
  snapshot_version: number;
  range_key: string | null;
  generated_at: string;
  stale_at: string;
  etag: string | null;
  payload: unknown;
};

export function reportingRangeKey(range: MonitorRange, customRange?: MonitorCustomRange): string {
  if (range !== "custom") return range;

  const resolved = resolveMonitorDateRange(range, new Date(), customRange);
  return `custom:${resolved.since}:${resolved.until}`;
}

export async function loadReportingSnapshot(input: {
  supabase: SupabaseServerClient;
  workspaceId: string;
  range: MonitorRange;
  customRange?: MonitorCustomRange;
  now?: Date;
}): Promise<{ snapshot: ReportingSnapshotV1; needsRefresh: boolean; persisted: boolean }> {
  const now = input.now ?? new Date();
  const rangeKey = reportingRangeKey(input.range, input.customRange);

  const result = await Sentry.startSpan(
    {
      name: "Load reporting snapshot",
      op: "db.reporting_snapshot",
      attributes: {
        "workspace.id": input.workspaceId,
        "reporting.range_key": rangeKey,
      },
    },
    () =>
      input.supabase
        .from("reporting_snapshots")
        .select("workspace_id,snapshot_version,range_key,generated_at,stale_at,etag,payload")
        .eq("workspace_id", input.workspaceId)
        .eq("provider", "meta")
        .eq("range_key", rangeKey)
        .maybeSingle(),
  );

  if (result.error) {
    throw new Error(`Reporting snapshot could not be loaded: ${result.error.message}`);
  }

  const persisted = toSnapshot(result.data as ReportingSnapshotRow | null);
  if (persisted) {
    Sentry.setMeasurement(
      "reporting.snapshot_age_ms",
      Math.max(0, now.getTime() - Date.parse(persisted.generatedAt)),
      "millisecond",
    );
    return {
      snapshot: persisted,
      needsRefresh: Date.parse(persisted.staleAt) <= now.getTime(),
      persisted: true,
    };
  }

  const fallback = await buildReportingFallback({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    range: input.range,
    customRange: input.customRange,
    now,
  });

  return { snapshot: fallback, needsRefresh: true, persisted: false };
}

export async function refreshReportingSnapshot(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  range: MonitorRange;
  customRange?: MonitorCustomRange;
  now?: Date;
}): Promise<ReportingSnapshotV1> {
  const now = input.now ?? new Date();
  const rangeKey = reportingRangeKey(input.range, input.customRange);
  const payload = await Sentry.startSpan(
    {
      name: "Refresh Meta reporting snapshot",
      op: "provider.meta",
      attributes: {
        "workspace.id": input.workspaceId,
        "reporting.range_key": rangeKey,
      },
    },
    () =>
      getResultsPayload({
        supabase: input.serviceSupabase as unknown as SupabaseServerClient,
        serviceSupabase: input.serviceSupabase,
        workspaceId: input.workspaceId,
        range: input.range,
        customRange: input.customRange,
        now,
      }),
  );
  const generatedAt = now.toISOString();
  const staleAt = new Date(now.getTime() + REPORTING_SNAPSHOT_TTL_MS).toISOString();
  const etag = payloadEtag(payload);
  const snapshot: ReportingSnapshotV1 = {
    version: REPORTING_SNAPSHOT_VERSION,
    workspaceId: input.workspaceId,
    rangeKey,
    generatedAt,
    staleAt,
    etag,
    payload,
  };
  const range = resolveMonitorDateRange(input.range, now, input.customRange);
  const { error } = await input.serviceSupabase.from("reporting_snapshots").upsert(
    {
      workspace_id: input.workspaceId,
      provider: "meta",
      date_range: `[${range.since},${range.until}]`,
      snapshot_version: REPORTING_SNAPSHOT_VERSION,
      range_key: rangeKey,
      generated_at: generatedAt,
      stale_at: staleAt,
      etag,
      payload,
      metrics: {
        source: payload.source,
        connected: payload.connected,
        issue: payload.issue,
        lastSyncAt: payload.summary?.lastSyncedAt ?? generatedAt,
        spend: payload.summary?.spend ?? 0,
        leads: payload.summary?.leads ?? 0,
        validLeads: payload.summary?.validLeads ?? 0,
      },
      created_at: generatedAt,
    },
    { onConflict: "workspace_id,provider,range_key" },
  );

  if (error) {
    throw new Error(`Reporting snapshot could not be saved: ${error.message}`);
  }

  // Meta has reported actual delivery for this workspace: start the 14-day
  // no-card app trial if it is still pending. Durable and idempotent
  // server-side; a failure here never breaks reporting.
  if (reportIndicatesMetaDelivery(payload)) {
    await startTrialOnFirstDeliveryBestEffort({
      service: input.serviceSupabase,
      workspaceId: input.workspaceId,
      deliveredAt: now,
    });
  }

  return snapshot;
}

export function isMatchingEtag(headerValue: string | null | undefined, etag: string): boolean {
  if (!headerValue) return false;
  return headerValue
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === etag || value === "*");
}

function toSnapshot(row: ReportingSnapshotRow | null): ReportingSnapshotV1 | null {
  if (
    !row ||
    row.snapshot_version !== REPORTING_SNAPSHOT_VERSION ||
    !row.range_key ||
    !row.etag ||
    !isMetaMonitorPayload(row.payload)
  ) {
    return null;
  }

  return {
    version: REPORTING_SNAPSHOT_VERSION,
    workspaceId: row.workspace_id,
    rangeKey: row.range_key,
    generatedAt: row.generated_at,
    staleAt: row.stale_at,
    etag: row.etag,
    payload: row.payload,
  };
}

async function buildReportingFallback(input: {
  supabase: SupabaseServerClient;
  workspaceId: string;
  range: MonitorRange;
  customRange?: MonitorCustomRange;
  now: Date;
}): Promise<ReportingSnapshotV1> {
  const { data } = await input.supabase
    .from("provider_connections")
    .select("status")
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "meta")
    .neq("status", "not_connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const connected = data?.status === "connected" || data?.status === "needs_attention";
  const range = resolveMonitorDateRange(input.range, input.now, input.customRange);
  const payload: MetaMonitorPayload = connected
    ? {
        connected: true,
        source: "live",
        currencyCode: "AUD",
        range,
        issue: "Your reporting snapshot is being prepared. Existing results will stay visible during future refreshes.",
        summary: null,
        daily: [],
        suburbPerformance: [],
        ads: [],
        anglePerformance: [],
      }
    : buildSampleMetaMonitorPayload({
        range: input.range,
        customRange: input.customRange,
        now: input.now,
        connected: false,
      });
  const generatedAt = input.now.toISOString();

  return {
    version: REPORTING_SNAPSHOT_VERSION,
    workspaceId: input.workspaceId,
    rangeKey: reportingRangeKey(input.range, input.customRange),
    generatedAt,
    staleAt: generatedAt,
    etag: payloadEtag(payload),
    payload,
  };
}

function payloadEtag(payload: MetaMonitorPayload): string {
  return `"${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}"`;
}

function isMetaMonitorPayload(value: unknown): value is MetaMonitorPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<MetaMonitorPayload>;
  return (
    typeof payload.connected === "boolean" &&
    (payload.source === "live" || payload.source === "sample") &&
    payload.currencyCode === "AUD" &&
    Boolean(payload.range && typeof payload.range === "object") &&
    Array.isArray(payload.daily) &&
    Array.isArray(payload.suburbPerformance) &&
    Array.isArray(payload.ads)
  );
}
