import {
  normalizeProviderReport,
  type MonitorDateRange,
  type MonitorPerformanceRow,
  type MonitorProviderReport,
} from "../monitor/dashboard-data.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

export type MetaActionMetric = {
  action_type?: string;
  value?: string | number;
};

export type MetaInsightRow = {
  ad_id?: string;
  ad_name?: string | null;
  campaign_id?: string;
  campaign_name?: string | null;
  adset_id?: string;
  adset_name?: string | null;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  ctr?: string | number;
  cpc?: string | number;
  frequency?: string | number;
  actions?: MetaActionMetric[];
  date_start?: string;
};

export type MetaCreativeNode = {
  id?: string;
  name?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  body?: string | null;
  title?: string | null;
};

type MetaDatePreset = "today" | "yesterday";

type MetaListResponse<T> = {
  data?: T[];
  paging?: {
    next?: string | null;
  } | null;
};

const META_LEAD_ACTIONS = new Set([
  "lead",
  "omni_lead",
  "onsite_conversion.lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "leadgen_grouped",
]);

export function extractMetaLeadCount(actions: MetaActionMetric[] | null | undefined): number {
  return (actions ?? []).reduce((sum, action) => {
    if (!action.action_type || !META_LEAD_ACTIONS.has(action.action_type)) {
      return sum;
    }

    return sum + toNumber(action.value);
  }, 0);
}

export function normalizeMetaInsightRows(
  rows: MetaInsightRow[],
  options: { accountName?: string; accountId?: string; lastSyncAt?: string | null; status?: MonitorProviderReport["status"] } = {},
): MonitorProviderReport {
  const performanceRows = rows.map((row): MonitorPerformanceRow => {
    const spendAud = toMoney(row.spend);
    const impressions = Math.round(toNumber(row.impressions));
    const clicks = Math.round(toNumber(row.clicks));
    const leads = Math.round(extractMetaLeadCount(row.actions));
    const validLeads = 0;

    return {
      id: row.ad_id ?? `${row.campaign_id ?? "meta"}-${row.date_start ?? "row"}`,
      provider: "meta",
      type: "ad",
      name: row.ad_name ?? "Meta ad",
      campaignName: row.campaign_name ?? row.adset_name ?? "Meta campaign",
      status: "active",
      spendAud,
      impressions,
      clicks,
      leads,
      validLeads,
      validLeadRate: 0,
      cplAud: 0,
      validCplAud: 0,
      ctr: toNumber(row.ctr) > 1 ? toNumber(row.ctr) / 100 : toNumber(row.ctr),
      cpcAud: toMoney(row.cpc),
      insight: "Live Meta lead-ad reporting normalized for valid-lead review.",
    };
  });
  const metrics = performanceRows.reduce(
    (acc, row) => ({
      spendAud: acc.spendAud + row.spendAud,
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      leads: acc.leads + row.leads,
      validLeads: acc.validLeads + row.validLeads,
    }),
    { spendAud: 0, impressions: 0, clicks: 0, leads: 0, validLeads: 0 },
  );

  return normalizeProviderReport(
    {
      provider: "meta",
      status: options.status ?? "connected",
      source: "live",
      accountName: options.accountName ?? "Meta Ads",
      accountId: options.accountId,
      lastSyncAt: options.lastSyncAt ?? new Date().toISOString(),
      metrics,
      daily: buildDailyFromRows(rows, performanceRows),
      rows: performanceRows,
      creativePreviews: [],
    },
    inferRangeFromRows(rows),
  );
}

export async function fetchMetaReporting(input: {
  accessToken: string;
  accountId: string;
  accountName?: string;
  range: MonitorDateRange;
}): Promise<MonitorProviderReport> {
  const accountId = input.accountId.startsWith("act_") ? input.accountId : `act_${input.accountId}`;
  const insights = await fetchMetaList<MetaInsightRow>(`/${accountId}/insights`, input.accessToken, {
    level: "ad",
    time_increment: "1",
    ...resolveInsightDateParams(input.range),
    fields: [
      "ad_id",
      "ad_name",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "cpc",
      "actions",
      "date_start",
    ].join(","),
    limit: "200",
  });
  const normalized = normalizeMetaInsightRows(insights, {
    accountId,
    accountName: input.accountName,
    lastSyncAt: new Date().toISOString(),
  });

  return {
    ...normalized,
    creativePreviews: await fetchMetaCreativePreviews(input.accessToken, accountId, normalized.rows).catch(() => []),
  };
}

export async function fetchMetaAdAccounts(accessToken: string): Promise<Array<{ id: string; name: string; currency?: string; timezone?: string }>> {
  const accounts = await fetchMetaList<{ id?: string; account_id?: string; name?: string | null; currency?: string; timezone_name?: string }>(
    "/me/adaccounts",
    accessToken,
    {
    fields: "id,account_id,name,currency,timezone_name",
    limit: "25",
    },
  );

  return accounts
    .filter((account) => account.id || account.account_id)
    .map((account) => ({
      id: account.id ?? `act_${account.account_id}`,
      name: account.name ?? account.id ?? "Meta ad account",
      currency: account.currency,
      timezone: account.timezone_name,
    }));
}

async function fetchMetaCreativePreviews(
  accessToken: string,
  accountId: string,
  rows: MonitorPerformanceRow[],
): Promise<MonitorProviderReport["creativePreviews"]> {
  if (rows.length === 0) {
    return [];
  }

  const ads = await fetchMetaList<{
    id?: string;
    name?: string | null;
    creative?: MetaCreativeNode | null;
    effective_status?: string | null;
  }>(`/${accountId}/ads`, accessToken, {
    fields: "id,name,effective_status,creative{thumbnail_url,image_url,name,title,body}",
    limit: "50",
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));

  return ads.slice(0, 8).flatMap((ad) => {
    const row = ad.id ? rowById.get(ad.id) : undefined;

    if (!ad.id || !row) {
      return [];
    }

    return [
      {
        id: ad.id,
        provider: "meta" as const,
        title: ad.creative?.title ?? ad.creative?.name ?? ad.name ?? row.name,
        body: ad.creative?.body ?? row.insight,
        imageUrl: ad.creative?.thumbnail_url ?? ad.creative?.image_url ?? undefined,
        status: ad.effective_status ?? row.status,
        spendAud: row.spendAud,
        validLeads: row.validLeads,
      },
    ];
  });
}

export type MetaAdEntity = {
  id?: string;
  name?: string | null;
  effective_status?: string | null;
  preview_shareable_link?: string | null;
  creative?: (MetaCreativeNode & {
    object_type?: string | null;
    video_id?: string | null;
    object_story_spec?: {
      link_data?: { link?: string | null; message?: string | null; description?: string | null } | null;
      video_data?: { link_description?: string | null; message?: string | null } | null;
    } | null;
  }) | null;
};

export type MetaBreakdownRow = {
  ad_id?: string;
  impressions?: string | number;
  publisher_platform?: string;
  platform_position?: string;
  impression_device?: string;
};

/** Raw per-ad-per-day insight rows for the Meta monitor. Additive export; does not alter fetchMetaReporting. */
export async function fetchMetaInsightRows(input: {
  accessToken: string;
  accountId: string;
  since: string;
  until: string;
  datePreset?: MetaDatePreset;
}): Promise<MetaInsightRow[]> {
  const accountId = normalizeAccountId(input.accountId);

  return fetchMetaList<MetaInsightRow>(`/${accountId}/insights`, input.accessToken, {
    level: "ad",
    time_increment: "1",
    ...resolveInsightDateParams(input),
    fields: [
      "ad_id",
      "ad_name",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "spend",
      "impressions",
      "clicks",
      "actions",
      "frequency",
      "date_start",
    ].join(","),
    limit: "500",
  });
}

/** Ad entities with creative + status + permalink for the Meta monitor ad cards. */
export async function fetchMetaAdEntities(input: {
  accessToken: string;
  accountId: string;
}): Promise<MetaAdEntity[]> {
  const accountId = normalizeAccountId(input.accountId);

  return fetchMetaList<MetaAdEntity>(`/${accountId}/ads`, input.accessToken, {
    fields:
      "id,name,effective_status,preview_shareable_link,creative{thumbnail_url,image_url,title,body,object_type,video_id,object_story_spec}",
    limit: "200",
  });
}

/** One Insights breakdown per call — combinations are not always valid, so callers pick one. */
export async function fetchMetaInsightBreakdown(input: {
  accessToken: string;
  accountId: string;
  since: string;
  until: string;
  datePreset?: MetaDatePreset;
  breakdowns: "publisher_platform,platform_position" | "impression_device";
}): Promise<MetaBreakdownRow[]> {
  const accountId = normalizeAccountId(input.accountId);

  return fetchMetaList<MetaBreakdownRow>(`/${accountId}/insights`, input.accessToken, {
    level: "ad",
    ...resolveInsightDateParams(input),
    fields: "ad_id,impressions",
    breakdowns: input.breakdowns,
    limit: "1000",
  });
}

function resolveInsightDateParams(input: { key?: string; since: string; until: string; datePreset?: MetaDatePreset }): Record<string, string> {
  const datePreset = input.datePreset ?? (input.key === "today" || input.key === "yesterday" ? input.key : null);

  if (datePreset) {
    return { date_preset: datePreset };
  }

  return { time_range: JSON.stringify({ since: input.since, until: input.until }) };
}

function normalizeAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

async function fetchMetaList<T>(path: string, accessToken: string, params: Record<string, string>): Promise<T[]> {
  const allRows: T[] = [];
  let nextUrl: string | null = buildMetaUrl(path, accessToken, params);

  while (nextUrl) {
    const response = await fetch(nextUrl, { cache: "no-store" });
    const payload = (await response.json()) as MetaListResponse<T> & { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Meta request failed with ${response.status}.`);
    }

    allRows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return allRows;
}

function buildMetaUrl(path: string, accessToken: string, params: Record<string, string>): string {
  const url = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}${path}`);
  url.searchParams.set("access_token", accessToken);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function buildDailyFromRows(rows: MetaInsightRow[], performanceRows: MonitorPerformanceRow[]) {
  const byDate = new Map<string, { spendAud: number; leads: number; validLeads: number }>();

  rows.forEach((row, index) => {
    const date = row.date_start ?? new Date().toISOString().slice(0, 10);
    const performance = performanceRows[index];
    const existing = byDate.get(date) ?? { spendAud: 0, leads: 0, validLeads: 0 };
    byDate.set(date, {
      spendAud: existing.spendAud + (performance?.spendAud ?? 0),
      leads: existing.leads + (performance?.leads ?? 0),
      validLeads: existing.validLeads + (performance?.validLeads ?? 0),
    });
  });

  return Array.from(byDate.entries()).map(([date, point]) => ({
    date,
    spendAud: point.spendAud,
    leads: point.leads,
    validLeads: point.validLeads,
    validCplAud: 0,
  }));
}

function inferRangeFromRows(rows: MetaInsightRow[]): MonitorDateRange {
  const dates = rows.map((row) => row.date_start).filter((date): date is string => Boolean(date)).sort();
  const since = dates[0] ?? new Date().toISOString().slice(0, 10);
  const until = dates.at(-1) ?? since;

  return {
    key: "last_30",
    label: "Live range",
    since,
    until,
    days: Math.max(1, dates.length || 1),
  };
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: string | number | null | undefined): number {
  return Math.round(toNumber(value) * 100) / 100;
}
