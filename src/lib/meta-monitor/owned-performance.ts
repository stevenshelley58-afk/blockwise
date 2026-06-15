import type { createSupabaseServiceClient } from "@/lib/supabase/service";

import type { MetaAdPerformance, MetaMonitorPayload } from "./types.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type OwnedAdPerformancePersistenceResult = {
  considered: number;
  persisted: number;
};

type OwnedAdPerformanceRow = {
  workspace_id: string;
  template_key: string | null;
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  impressions: number;
  clicks: number;
  leads: number;
  qualified_leads: number;
  spend_cents: number;
  ctr: number | null;
  cpl_cents: number | null;
  lead_quality_score: number | null;
  reported_at: string;
  source: "meta_monitor";
  raw_metrics: Record<string, unknown>;
  updated_at: string;
};

export async function persistOwnedAdPerformanceFromMonitor(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  payload: MetaMonitorPayload;
  now?: Date;
}): Promise<OwnedAdPerformancePersistenceResult> {
  if (input.payload.source !== "live" || input.payload.issue || !input.payload.ads.length) {
    return { considered: input.payload.ads.length, persisted: 0 };
  }

  const now = input.now ?? new Date();
  const reportedAt = `${input.payload.range.until}T23:59:59.000Z`;
  const rows = input.payload.ads
    .map((ad) => mapOwnedPerformanceRow(ad, input.workspaceId, reportedAt, now))
    .filter((row): row is OwnedAdPerformanceRow => row !== null);

  if (rows.length === 0) {
    return { considered: input.payload.ads.length, persisted: 0 };
  }

  const { error } = await input.serviceSupabase
    .schema("research")
    .from("owned_ad_performance")
    .upsert(rows, {
      onConflict: "workspace_id,meta_ad_id,reported_at,source",
    });

  if (error) {
    throw new Error(`Unable to persist owned ad performance: ${error.message}`);
  }

  return { considered: input.payload.ads.length, persisted: rows.length };
}

function mapOwnedPerformanceRow(
  ad: MetaAdPerformance,
  workspaceId: string,
  reportedAt: string,
  now: Date,
): OwnedAdPerformanceRow | null {
  if (!ad.variantTags || !ad.adId) {
    return null;
  }

  const validLeadRate = ad.metrics.validRate;
  return {
    workspace_id: workspaceId,
    template_key: ad.variantTags.template,
    meta_ad_id: ad.adId,
    meta_adset_id: ad.adsetId || null,
    meta_campaign_id: ad.campaignId || null,
    impressions: Math.max(0, Math.round(ad.metrics.impressions)),
    clicks: Math.max(0, Math.round(ad.metrics.clicks)),
    leads: Math.max(0, Math.round(ad.metrics.leads)),
    qualified_leads: Math.max(0, Math.round(ad.metrics.validLeads)),
    spend_cents: Math.max(0, Math.round(ad.metrics.spend * 100)),
    ctr: ad.metrics.ctr,
    cpl_cents: ad.metrics.validCpl === null ? null : Math.max(0, Math.round(ad.metrics.validCpl * 100)),
    lead_quality_score: validLeadRate === null ? null : Math.round(validLeadRate * 1000) / 10,
    reported_at: reportedAt,
    source: "meta_monitor",
    raw_metrics: {
      variant_id: ad.variantTags.variantId,
      angle: ad.variantTags.angle,
      ad_name: ad.adName,
      campaign_name: ad.campaignName,
      adset_name: ad.adsetName,
      suburb: ad.suburb,
      frequency: ad.metrics.frequency,
      fatigued: ad.fatigued ?? false,
    },
    updated_at: now.toISOString(),
  };
}
