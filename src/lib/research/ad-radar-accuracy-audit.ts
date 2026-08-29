import type { SupabaseClient } from "@supabase/supabase-js";

import { sendPaidServiceAlert, type AlertMessage } from "../alerts/notify.ts";

export const AD_RADAR_ACCURACY_SETTING_KEY = "ad_radar_accuracy_audit_latest";
export const AD_RADAR_ACCURACY_SAMPLE_SIZE = 30;
export const AD_RADAR_ACCURACY_WINDOW_DAYS = 7;
export const AD_RADAR_TYPED_WARN_PCT = 70;
export const AD_RADAR_ADVERTISER_WARN_PCT = 90;

export type ResearchAdSampleRow = {
  observed_ad_id: string;
  agent_id: string | null;
  agency_id: string | null;
  ad_type: string | null;
  primary_intent: string | null;
  classification: Record<string, unknown> | null;
  last_seen_at: string | null;
};

type AreaCoverageRow = {
  observed_ad_id: string;
  postcode: string | null;
  suburb: string | null;
};

export type AdRadarAccuracyAuditSummary = {
  version: 1;
  auditedAt: string;
  windowDays: number;
  sampleSize: number;
  candidateCount: number;
  status: "ok" | "warn";
  thresholds: {
    typedClassificationPct: number;
    resolvedAdvertiserPct: number;
  };
  counts: {
    typedClassification: number;
    resolvedAdvertiser: number;
    suburbPostcodeCoverage: number | null;
  };
  metrics: {
    typedClassificationPct: number;
    resolvedAdvertiserPct: number;
    suburbPostcodeCoveragePct: number | null;
    medianLastSeenAgeHours: number | null;
  };
  errors: string[];
};

export type RunAdRadarAccuracyAuditOptions = {
  now?: Date;
  sampleSize?: number;
  sendAlerts?: boolean;
  alertSender?: (message: AlertMessage) => Promise<{ email: boolean; whatsapp: boolean }>;
};

export async function runAdRadarAccuracyAudit(
  supabase: SupabaseClient,
  options: RunAdRadarAccuracyAuditOptions = {},
) {
  const now = options.now ?? new Date();
  const sampleSize = options.sampleSize ?? AD_RADAR_ACCURACY_SAMPLE_SIZE;
  const rows = await loadRecentAdSample(supabase, now, sampleSize);
  const sampledRows = sampleRows(rows, sampleSize);
  const { coverageByObservedAdId, errors } = await loadAreaCoverage(supabase, sampledRows);
  const summary = summariseAdRadarAccuracyRows(sampledRows, {
    now,
    candidateCount: rows.length,
    coverageByObservedAdId,
    errors,
  });

  const stored = await saveAdRadarAccuracySummary(supabase, summary);
  const alert = summary.status === "warn" && options.sendAlerts !== false
    ? await (options.alertSender ?? sendPaidServiceAlert)(formatAdRadarAccuracyAlert(summary))
    : null;

  return { summary, stored, alert };
}

export function summariseAdRadarAccuracyRows(
  rows: ResearchAdSampleRow[],
  input: {
    now: Date;
    candidateCount?: number;
    coverageByObservedAdId?: Map<string, boolean>;
    errors?: string[];
  },
): AdRadarAccuracyAuditSummary {
  const typedClassification = rows.filter((row) => isTypedClassification(row)).length;
  const resolvedAdvertiser = rows.filter((row) => Boolean(row.agent_id || row.agency_id)).length;
  const coverageValues = input.coverageByObservedAdId
    ? rows.map((row) => input.coverageByObservedAdId?.get(row.observed_ad_id) === true)
    : null;
  const suburbPostcodeCoverage = coverageValues ? coverageValues.filter(Boolean).length : null;
  const typedClassificationPct = pct(typedClassification, rows.length);
  const resolvedAdvertiserPct = pct(resolvedAdvertiser, rows.length);
  const suburbPostcodeCoveragePct = coverageValues ? pct(suburbPostcodeCoverage ?? 0, rows.length) : null;
  const medianLastSeenAgeHours = median(
    rows
      .map((row) => ageHours(row.last_seen_at, input.now))
      .filter((value): value is number => value !== null),
  );
  const status =
    typedClassificationPct < AD_RADAR_TYPED_WARN_PCT ||
    resolvedAdvertiserPct < AD_RADAR_ADVERTISER_WARN_PCT
      ? "warn"
      : "ok";

  return {
    version: 1,
    auditedAt: input.now.toISOString(),
    windowDays: AD_RADAR_ACCURACY_WINDOW_DAYS,
    sampleSize: rows.length,
    candidateCount: input.candidateCount ?? rows.length,
    status,
    thresholds: {
      typedClassificationPct: AD_RADAR_TYPED_WARN_PCT,
      resolvedAdvertiserPct: AD_RADAR_ADVERTISER_WARN_PCT,
    },
    counts: {
      typedClassification,
      resolvedAdvertiser,
      suburbPostcodeCoverage,
    },
    metrics: {
      typedClassificationPct,
      resolvedAdvertiserPct,
      suburbPostcodeCoveragePct,
      medianLastSeenAgeHours,
    },
    errors: input.errors ?? [],
  };
}

export function formatAdRadarAccuracyAlert(summary: AdRadarAccuracyAuditSummary): AlertMessage {
  const subject = `[Blockwise WARN] Ad Radar accuracy ${summary.metrics.typedClassificationPct.toFixed(0)}% typed, ${summary.metrics.resolvedAdvertiserPct.toFixed(0)}% advertiser`;
  const lines = [
    "Ad Radar accuracy needs attention:",
    `  - typed classification: ${summary.metrics.typedClassificationPct.toFixed(1)}% (${summary.counts.typedClassification}/${summary.sampleSize})`,
    `  - resolved advertiser: ${summary.metrics.resolvedAdvertiserPct.toFixed(1)}% (${summary.counts.resolvedAdvertiser}/${summary.sampleSize})`,
    `  - suburb/postcode coverage: ${formatOptionalPct(summary.metrics.suburbPostcodeCoveragePct)}`,
    `  - median last_seen_at age: ${formatOptionalHours(summary.metrics.medianLastSeenAgeHours)}`,
  ];

  if (summary.errors.length > 0) {
    lines.push("", "Audit warnings:", ...summary.errors.map((error) => `  - ${error}`));
  }

  return { subject, text: lines.join("\n") };
}

async function loadRecentAdSample(
  supabase: SupabaseClient,
  now: Date,
  sampleSize: number,
): Promise<ResearchAdSampleRow[]> {
  const since = new Date(now.getTime() - AD_RADAR_ACCURACY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .schema("research")
    .from("v_customer_agent_ad_history")
    .select("observed_ad_id,agent_id,agency_id,ad_type,primary_intent,classification,last_seen_at")
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(sampleSize * 10, sampleSize));

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ResearchAdSampleRow[];
}

async function loadAreaCoverage(
  supabase: SupabaseClient,
  rows: ResearchAdSampleRow[],
): Promise<{ coverageByObservedAdId: Map<string, boolean>; errors: string[] }> {
  const ids = [...new Set(rows.map((row) => row.observed_ad_id).filter(Boolean))];
  const coverageByObservedAdId = new Map(ids.map((id) => [id, false]));
  if (ids.length === 0) return { coverageByObservedAdId, errors: [] };

  const { data, error } = await supabase
    .schema("research")
    .from("ad_area_matches")
    .select("observed_ad_id,postcode,suburb")
    .in("observed_ad_id", ids);

  if (error) {
    return {
      coverageByObservedAdId,
      errors: [`suburb/postcode coverage query failed: ${error.message}`],
    };
  }

  for (const row of (data ?? []) as unknown as AreaCoverageRow[]) {
    if (row.observed_ad_id && cleanString(row.postcode) && cleanString(row.suburb)) {
      coverageByObservedAdId.set(row.observed_ad_id, true);
    }
  }

  return { coverageByObservedAdId, errors: [] };
}

async function saveAdRadarAccuracySummary(
  supabase: SupabaseClient,
  summary: AdRadarAccuracyAuditSummary,
): Promise<boolean> {
  const { error } = await supabase
    .schema("research")
    .from("runtime_settings")
    .upsert({
      setting_key: AD_RADAR_ACCURACY_SETTING_KEY,
      setting_value: summary,
      description: "Latest weekly Ad Radar accuracy audit summary.",
      updated_by: "ad-radar-accuracy-audit",
    });

  if (!error) return true;
  console.error("Ad Radar accuracy audit storage failed", error.message);
  return false;
}

function sampleRows<T>(rows: T[], sampleSize: number): T[] {
  if (rows.length <= sampleSize) return [...rows];
  return [...rows]
    .map((row) => ({ row, rank: Math.random() }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, sampleSize)
    .map((entry) => entry.row);
}

function isTypedClassification(row: ResearchAdSampleRow): boolean {
  const adType =
    cleanString(row.ad_type) ??
    cleanString(row.classification?.ad_type) ??
    cleanString(row.classification?.type) ??
    cleanString(row.primary_intent);
  return Boolean(adType && !["other", "unknown", "unclassified"].includes(adType.toLowerCase()));
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Number(value.toFixed(1));
}

function ageHours(value: string | null, now: Date): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function cleanString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function formatOptionalPct(value: number | null): string {
  return value === null ? "unavailable" : `${value.toFixed(1)}%`;
}

function formatOptionalHours(value: number | null): string {
  return value === null ? "unavailable" : `${value.toFixed(1)} hours`;
}
