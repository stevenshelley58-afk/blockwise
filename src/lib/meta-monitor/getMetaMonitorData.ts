import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";

import { resolveMonitorDateRange } from "../monitor/dashboard-data.ts";
import {
  extractMetaLeadCount,
  fetchMetaAdEntities,
  fetchMetaInsightBreakdown,
  fetchMetaInsightRows,
  type MetaAdEntity,
  type MetaBreakdownRow,
  type MetaInsightRow,
} from "../providers/meta-reporting.ts";
import { listProviderConnections, loadStoredProviderTokens } from "../providers/provider-connections.ts";
import { safeCpl, safeRate } from "./calculations.ts";
import { buildSampleMetaMonitorPayload } from "./sampleMetaMonitorData.ts";
import { resolveSuburb } from "./suburbAttribution.ts";
import type {
  MetaAdPerformance,
  MetaAdStatus,
  MetaDailyPoint,
  MetaMonitorPayload,
  MetaMonitorSummary,
  MonitorDateRange,
  MonitorRange,
  SuburbPerformance,
} from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type WorkspaceLeadRow = {
  id: string;
  suburb: string | null;
  created_at: string;
};

type LeadFacts = {
  /** All Meta-attributed leads in range (Blockwise lead table). */
  totalLeads: number;
  totalValidLeads: number;
  validByDate: Map<string, number>;
  leadsByDate: Map<string, number>;
  leadCountByAdId: Map<string, number>;
  validCountByAdId: Map<string, number>;
  suburbRows: Array<{ suburb: string | null; adId: string | null; isValid: boolean }>;
};

export async function getMetaMonitorData(input: {
  supabase: SupabaseServerClient;
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  range: MonitorRange;
  now?: Date;
}): Promise<MetaMonitorPayload> {
  const now = input.now ?? new Date();
  const range = resolveMonitorDateRange(input.range, now);

  if (process.env.NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA === "true") {
    return buildSampleMetaMonitorPayload({ range: input.range, now });
  }

  const connections = await listProviderConnections(input.supabase, input.workspaceId);
  const metaConnection = connections.find(
    (connection) => connection.provider === "meta" && connection.status !== "not_connected",
  );

  if (!metaConnection) {
    // No ad account yet: show clearly-labelled demo data so the dashboard is
    // alive on day one. It is replaced by live data the moment Meta connects.
    return buildSampleMetaMonitorPayload({ range: input.range, now, connected: false });
  }

  const tokens = await loadStoredProviderTokens(input.serviceSupabase, metaConnection.id).catch(() => ({
    accessToken: null,
    refreshToken: null,
  }));

  if (!tokens.accessToken || !metaConnection.externalAccountId) {
    return emptyPayload(range, {
      connected: false,
      issue: "Your Meta connection needs to be reconnected before reporting can load.",
    });
  }

  const accessToken = tokens.accessToken;
  const accountId = metaConnection.externalAccountId;
  const datePreset = range.key === "today" || range.key === "yesterday" ? range.key : undefined;

  try {
    const [insightRows, adEntities, leadFacts] = await Promise.all([
      fetchMetaInsightRows({ accessToken, accountId, since: range.since, until: range.until, datePreset }),
      fetchMetaAdEntities({ accessToken, accountId }),
      loadLeadFacts(input.serviceSupabase, input.workspaceId, range),
    ]);

    // Optional extras — each degrades to "hidden panel", never fake data.
    const previousRange = resolvePreviousRange(range);
    const [placementRows, deviceRows, previousPeriod] = await Promise.all([
      fetchMetaInsightBreakdown({
        accessToken,
        accountId,
        since: range.since,
        until: range.until,
        datePreset,
        breakdowns: "publisher_platform,platform_position",
      }).catch(() => null),
      fetchMetaInsightBreakdown({
        accessToken,
        accountId,
        since: range.since,
        until: range.until,
        datePreset,
        breakdowns: "impression_device",
      }).catch(() => null),
      buildPreviousPeriod({
        accessToken,
        accountId,
        serviceSupabase: input.serviceSupabase,
        workspaceId: input.workspaceId,
        previousRange,
      }).catch(() => undefined),
    ]);

    const ads = buildAds({ insightRows, adEntities, leadFacts, placementRows, deviceRows });
    const daily = buildDaily(insightRows, leadFacts, range);
    const suburbPerformance = buildSuburbPerformance(leadFacts, ads);
    const spend = ads.reduce((total, ad) => total + ad.metrics.spend, 0);

    const summary: MetaMonitorSummary = {
      dateRange: { start: range.since, end: range.until, label: range.label },
      lastSyncedAt: now.toISOString(),
      budget: resolveBudget(),
      spend: round2(spend),
      impressions: ads.reduce((total, ad) => total + ad.metrics.impressions, 0),
      clicks: ads.reduce((total, ad) => total + ad.metrics.clicks, 0),
      leads: Math.max(
        ads.reduce((total, ad) => total + ad.metrics.leads, 0),
        leadFacts.totalLeads,
      ),
      validLeads: leadFacts.totalValidLeads,
      previousPeriod,
    };

    return {
      connected: true,
      source: "live",
      currencyCode: "AUD",
      range,
      issue: null,
      summary,
      daily,
      suburbPerformance,
      ads,
    };
  } catch (error) {
    return emptyPayload(range, {
      connected: true,
      issue: error instanceof Error ? error.message : "Meta reporting failed to load.",
    });
  }
}

function emptyPayload(
  range: MonitorDateRange,
  options: { connected: boolean; issue: string | null },
): MetaMonitorPayload {
  return {
    connected: options.connected,
    source: "live",
    currencyCode: "AUD",
    range,
    issue: options.issue,
    summary: null,
    daily: [],
    suburbPerformance: [],
    ads: [],
  };
}

function resolveBudget(): number | null {
  const parsed = Number(process.env.META_MONITOR_BUDGET_AUD);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Valid leads come from the Blockwise lead table (lead_quality_labels), never
 * from Meta's platform numbers. Attribution back to an ad uses the adId stored
 * by the Meta lead webhook in lead_source_attribution.source.
 */
async function loadLeadFacts(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  range: MonitorDateRange,
): Promise<LeadFacts> {
  // Dashboard dates are AU-local; AEST keeps day buckets aligned with resolveMonitorDateRange.
  const sinceIso = `${range.since}T00:00:00+10:00`;
  const untilIso = `${range.until}T23:59:59.999+10:00`;
  const { data: leadRows, error } = await serviceSupabase
    .from("leads")
    .select("id,suburb,created_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .gte("created_at", sinceIso)
    .lte("created_at", untilIso);

  if (error) {
    throw new Error(`Failed to load Blockwise leads: ${error.message}`);
  }

  const leads = (leadRows ?? []) as WorkspaceLeadRow[];
  const leadIds = leads.map((lead) => lead.id);
  const facts: LeadFacts = {
    totalLeads: leads.length,
    totalValidLeads: 0,
    validByDate: new Map(),
    leadsByDate: new Map(),
    leadCountByAdId: new Map(),
    validCountByAdId: new Map(),
    suburbRows: [],
  };

  if (leadIds.length === 0) {
    return facts;
  }

  const [{ data: labelRows }, { data: attributionRows }] = await Promise.all([
    serviceSupabase
      .from("lead_quality_labels")
      .select("lead_id,label")
      .eq("workspace_id", workspaceId)
      .in("lead_id", leadIds),
    serviceSupabase
      .from("lead_source_attribution")
      .select("lead_id,source")
      .eq("workspace_id", workspaceId)
      .in("lead_id", leadIds),
  ]);

  const validLeadIds = new Set(
    ((labelRows ?? []) as Array<{ lead_id: string; label: string | null }>)
      .filter((row) => row.label?.toLowerCase() === "valid")
      .map((row) => row.lead_id),
  );
  const adIdByLeadId = new Map<string, string>();

  for (const row of (attributionRows ?? []) as Array<{ lead_id: string; source: unknown }>) {
    const adId = extractAdId(row.source);

    if (adId) {
      adIdByLeadId.set(row.lead_id, adId);
    }
  }

  for (const lead of leads) {
    const date = toAuDate(lead.created_at);
    const isValid = validLeadIds.has(lead.id);
    const adId = adIdByLeadId.get(lead.id) ?? null;

    facts.leadsByDate.set(date, (facts.leadsByDate.get(date) ?? 0) + 1);

    if (isValid) {
      facts.totalValidLeads += 1;
      facts.validByDate.set(date, (facts.validByDate.get(date) ?? 0) + 1);
    }

    if (adId) {
      facts.leadCountByAdId.set(adId, (facts.leadCountByAdId.get(adId) ?? 0) + 1);

      if (isValid) {
        facts.validCountByAdId.set(adId, (facts.validCountByAdId.get(adId) ?? 0) + 1);
      }
    }

    facts.suburbRows.push({ suburb: lead.suburb, adId, isValid });
  }

  return facts;
}

function extractAdId(source: unknown): string | null {
  if (source && typeof source === "object" && "adId" in source) {
    const adId = (source as { adId?: unknown }).adId;

    return typeof adId === "string" && adId.length > 0 ? adId : null;
  }

  return null;
}

function buildAds(input: {
  insightRows: MetaInsightRow[];
  adEntities: MetaAdEntity[];
  leadFacts: LeadFacts;
  placementRows: MetaBreakdownRow[] | null;
  deviceRows: MetaBreakdownRow[] | null;
}): MetaAdPerformance[] {
  type Aggregate = {
    adName: string;
    campaignId: string;
    campaignName: string;
    adsetId: string;
    adsetName: string;
    spend: number;
    impressions: number;
    clicks: number;
    platformLeads: number;
    frequencyWeighted: number;
    frequencyImpressions: number;
  };

  const byAdId = new Map<string, Aggregate>();

  for (const row of input.insightRows) {
    const adId = row.ad_id;

    if (!adId) {
      continue;
    }

    const aggregate = byAdId.get(adId) ?? {
      adName: row.ad_name ?? "Meta ad",
      campaignId: row.campaign_id ?? "",
      campaignName: row.campaign_name ?? "Meta campaign",
      adsetId: row.adset_id ?? "",
      adsetName: row.adset_name ?? "",
      spend: 0,
      impressions: 0,
      clicks: 0,
      platformLeads: 0,
      frequencyWeighted: 0,
      frequencyImpressions: 0,
    };
    const impressions = Math.round(toNumber(row.impressions));
    const frequency = toNumber(row.frequency);

    aggregate.spend += toNumber(row.spend);
    aggregate.impressions += impressions;
    aggregate.clicks += Math.round(toNumber(row.clicks));
    aggregate.platformLeads += Math.round(extractMetaLeadCount(row.actions));

    if (frequency > 0 && impressions > 0) {
      aggregate.frequencyWeighted += frequency * impressions;
      aggregate.frequencyImpressions += impressions;
    }

    byAdId.set(adId, aggregate);
  }

  const entityById = new Map(input.adEntities.filter((entity) => entity.id).map((entity) => [entity.id as string, entity]));
  const placementByAd = groupBreakdown(input.placementRows, placementLabel);
  const deviceByAd = groupBreakdown(input.deviceRows, deviceLabel);

  return Array.from(byAdId.entries())
    .map(([adId, aggregate]): MetaAdPerformance => {
      const entity = entityById.get(adId);
      const creative = entity?.creative ?? null;
      // Platform lead actions estimate delivery; the Blockwise lead table can only add to it.
      const leads = Math.max(aggregate.platformLeads, input.leadFacts.leadCountByAdId.get(adId) ?? 0);
      const validLeads = input.leadFacts.validCountByAdId.get(adId) ?? 0;
      const spend = round2(aggregate.spend);

      return {
        adId,
        adName: entity?.name ?? aggregate.adName,
        campaignId: aggregate.campaignId,
        campaignName: aggregate.campaignName,
        adsetId: aggregate.adsetId,
        adsetName: aggregate.adsetName,
        suburb: resolveSuburb({ adsetName: aggregate.adsetName, campaignName: aggregate.campaignName }),
        status: mapAdStatus(entity?.effective_status),
        landingPageUrl: creative?.object_story_spec?.link_data?.link ?? null,
        metaPermalinkUrl: entity?.preview_shareable_link ?? null,
        creative: {
          type: mapCreativeType(creative),
          thumbnailUrl: creative?.thumbnail_url ?? null,
          imageUrl: creative?.image_url ?? null,
          videoThumbnailUrl: creative?.video_id ? (creative?.thumbnail_url ?? null) : null,
          primaryText: creative?.body ?? creative?.object_story_spec?.link_data?.message ?? null,
          headline: creative?.title ?? null,
          description: creative?.object_story_spec?.link_data?.description ?? null,
        },
        metrics: {
          spend,
          impressions: aggregate.impressions,
          clicks: aggregate.clicks,
          ctr: safeRate(aggregate.clicks, aggregate.impressions),
          leads,
          validLeads,
          validRate: safeRate(validLeads, leads),
          validCpl: safeCpl(spend, validLeads),
          frequency:
            aggregate.frequencyImpressions > 0
              ? round2(aggregate.frequencyWeighted / aggregate.frequencyImpressions)
              : null,
          landingPageViews: null,
        },
        placementBreakdown: placementByAd.get(adId),
        deviceBreakdown: deviceByAd.get(adId),
      };
    })
    .sort((a, b) => b.metrics.spend - a.metrics.spend);
}

function buildDaily(insightRows: MetaInsightRow[], leadFacts: LeadFacts, range: MonitorDateRange): MetaDailyPoint[] {
  const spendByDate = new Map<string, { spend: number; platformLeads: number }>();

  for (const row of insightRows) {
    const date = range.days === 1 ? range.since : row.date_start;

    if (!date) {
      continue;
    }

    const existing = spendByDate.get(date) ?? { spend: 0, platformLeads: 0 };

    existing.spend += toNumber(row.spend);
    existing.platformLeads += Math.round(extractMetaLeadCount(row.actions));
    spendByDate.set(date, existing);
  }

  const points: MetaDailyPoint[] = [];

  for (let offset = 0; offset < range.days; offset += 1) {
    const date = addDays(range.since, offset);
    const insights = spendByDate.get(date);
    const spend = round2(insights?.spend ?? 0);
    const validLeads = leadFacts.validByDate.get(date) ?? 0;

    points.push({
      date,
      spend,
      leads: Math.max(insights?.platformLeads ?? 0, leadFacts.leadsByDate.get(date) ?? 0),
      validLeads,
      validCpl: safeCpl(spend, validLeads),
    });
  }

  return points;
}

/**
 * Suburb performance is grounded in real lead/ad attribution only — no Meta geo
 * estimates. Leads with no resolvable suburb are excluded rather than invented.
 */
function buildSuburbPerformance(leadFacts: LeadFacts, ads: MetaAdPerformance[]): SuburbPerformance[] {
  const adSuburbById = new Map(ads.map((ad) => [ad.adId, ad.suburb]));
  const totals = new Map<string, { leads: number; validLeads: number }>();

  for (const row of leadFacts.suburbRows) {
    const suburb =
      resolveSuburbValue(row.suburb) ?? (row.adId ? resolveSuburbValue(adSuburbById.get(row.adId) ?? null) : null);

    if (!suburb) {
      continue;
    }

    const entry = totals.get(suburb) ?? { leads: 0, validLeads: 0 };

    entry.leads += 1;

    if (row.isValid) {
      entry.validLeads += 1;
    }

    totals.set(suburb, entry);
  }

  const spendBySuburb = new Map<string, number>();

  for (const ad of ads) {
    if (ad.suburb) {
      spendBySuburb.set(ad.suburb, (spendBySuburb.get(ad.suburb) ?? 0) + ad.metrics.spend);
    }
  }

  return Array.from(totals.entries())
    .map(([suburb, entry]) => {
      const spend = round2(spendBySuburb.get(suburb) ?? 0);

      return {
        suburb,
        spend,
        leads: entry.leads,
        validLeads: entry.validLeads,
        validCpl: spend > 0 ? safeCpl(spend, entry.validLeads) : null,
      };
    })
    .sort((a, b) => b.validLeads - a.validLeads);
}

async function buildPreviousPeriod(input: {
  accessToken: string;
  accountId: string;
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  previousRange: MonitorDateRange;
}): Promise<MetaMonitorSummary["previousPeriod"]> {
  const [insightRows, leadFacts] = await Promise.all([
    fetchMetaInsightRows({
      accessToken: input.accessToken,
      accountId: input.accountId,
      since: input.previousRange.since,
      until: input.previousRange.until,
    }),
    loadLeadFacts(input.serviceSupabase, input.workspaceId, input.previousRange),
  ]);
  const spend = round2(insightRows.reduce((total, row) => total + toNumber(row.spend), 0));
  const platformLeads = insightRows.reduce((total, row) => total + Math.round(extractMetaLeadCount(row.actions)), 0);
  const leads = Math.max(platformLeads, leadFacts.totalLeads);

  return {
    spend,
    leads,
    validLeads: leadFacts.totalValidLeads,
    validLeadRate: safeRate(leadFacts.totalValidLeads, leads),
    validCpl: safeCpl(spend, leadFacts.totalValidLeads),
  };
}

function resolvePreviousRange(range: MonitorDateRange): MonitorDateRange {
  const until = addDays(range.since, -1);
  const since = addDays(until, -(range.days - 1));

  return { ...range, since, until, label: `Previous ${range.days} days` };
}

function groupBreakdown(
  rows: MetaBreakdownRow[] | null,
  toLabel: (row: MetaBreakdownRow) => string | null,
): Map<string, Array<{ label: string; impressions: number; percentage: number }>> {
  const grouped = new Map<string, Map<string, number>>();

  for (const row of rows ?? []) {
    const adId = row.ad_id;
    const label = toLabel(row);

    if (!adId || !label) {
      continue;
    }

    const byLabel = grouped.get(adId) ?? new Map<string, number>();

    byLabel.set(label, (byLabel.get(label) ?? 0) + Math.round(toNumber(row.impressions)));
    grouped.set(adId, byLabel);
  }

  const result = new Map<string, Array<{ label: string; impressions: number; percentage: number }>>();

  for (const [adId, byLabel] of grouped) {
    const total = Array.from(byLabel.values()).reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
      continue;
    }

    result.set(
      adId,
      Array.from(byLabel.entries())
        .map(([label, impressions]) => ({
          label,
          impressions,
          percentage: Math.round((impressions / total) * 100),
        }))
        .sort((a, b) => b.impressions - a.impressions),
    );
  }

  return result;
}

function placementLabel(row: MetaBreakdownRow): string | null {
  if (!row.publisher_platform) {
    return null;
  }

  const platform = titleCase(row.publisher_platform.replace(/_/g, " "));
  const position = row.platform_position && row.platform_position !== "unknown"
    ? titleCase(row.platform_position.replace(/_/g, " ").replace(/^facebook |^instagram /i, ""))
    : "";

  return position && !platform.toLowerCase().includes(position.toLowerCase())
    ? `${platform} ${position}`
    : platform;
}

function deviceLabel(row: MetaBreakdownRow): string | null {
  const device = row.impression_device?.toLowerCase();

  if (!device) {
    return null;
  }

  if (device.includes("tablet") || device === "ipad") {
    return "Tablet";
  }

  if (device.includes("desktop")) {
    return "Desktop";
  }

  return "Mobile";
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function mapAdStatus(effectiveStatus: string | null | undefined): MetaAdStatus {
  const status = effectiveStatus?.toUpperCase() ?? "";

  if (status === "ACTIVE") {
    return "ACTIVE";
  }

  if (status.includes("PAUSED")) {
    return "PAUSED";
  }

  if (status === "ARCHIVED" || status === "DELETED") {
    return "ARCHIVED";
  }

  return "UNKNOWN";
}

function mapCreativeType(creative: MetaAdEntity["creative"]): MetaAdPerformance["creative"]["type"] {
  if (!creative) {
    return "UNKNOWN";
  }

  if (creative.video_id || creative.object_type === "VIDEO") {
    return "VIDEO";
  }

  if (creative.object_type === "CAROUSEL") {
    return "CAROUSEL";
  }

  if (creative.image_url || creative.thumbnail_url || creative.object_type === "PHOTO" || creative.object_type === "SHARE") {
    return "IMAGE";
  }

  return "UNKNOWN";
}

function resolveSuburbValue(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 1 && trimmed.toLowerCase() !== "unknown" ? trimmed : null;
}

function toAuDate(createdAt: string): string {
  const date = new Date(createdAt);

  // AEST (UTC+10) to match resolveMonitorDateRange's AU dashboard days.
  return new Date(date.getTime() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
