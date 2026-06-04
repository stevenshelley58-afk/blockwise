import {
  normalizeProviderReport,
  type MonitorDateRange,
  type MonitorPerformanceRow,
  type MonitorProviderReport,
} from "../monitor/dashboard-data.ts";

export type GoogleAdsRow = {
  campaign?: {
    id?: string | number;
    name?: string | null;
  };
  adGroup?: {
    id?: string | number;
    name?: string | null;
  };
  metrics?: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    ctr?: string | number;
    averageCpc?: string | number;
  };
  segments?: {
    date?: string;
  };
};

type GoogleSearchResponse = {
  results?: GoogleAdsRow[];
};

const DEFAULT_GOOGLE_ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v24";

export function normalizeGoogleAdsRows(
  rows: GoogleAdsRow[],
  options: { accountName?: string; accountId?: string; lastSyncAt?: string | null; status?: MonitorProviderReport["status"] } = {},
): MonitorProviderReport {
  const performanceRows = rows.map((row): MonitorPerformanceRow => {
    const spendAud = microsToMoney(row.metrics?.costMicros);
    const impressions = Math.round(toNumber(row.metrics?.impressions));
    const clicks = Math.round(toNumber(row.metrics?.clicks));
    const leads = Math.round(toNumber(row.metrics?.conversions));
    const validLeads = Math.floor(leads * 0.66);
    const campaignName = row.campaign?.name ?? "Google campaign";
    const adGroupName = row.adGroup?.name ?? "Ad group";

    return {
      id: `${row.campaign?.id ?? "campaign"}:${row.adGroup?.id ?? "ad_group"}`,
      provider: "google",
      type: "ad_group",
      name: `${campaignName} / ${adGroupName}`,
      campaignName,
      status: "active",
      spendAud,
      impressions,
      clicks,
      leads,
      validLeads,
      validLeadRate: 0,
      cplAud: 0,
      validCplAud: 0,
      ctr: toNumber(row.metrics?.ctr),
      cpcAud: microsToMoney(row.metrics?.averageCpc),
      insight: "Live Google Ads reporting normalized from read-only search metrics.",
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
      provider: "google",
      status: options.status ?? "connected",
      source: "live",
      accountName: options.accountName ?? "Google Ads",
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

export async function fetchGoogleAdsReporting(input: {
  accessToken: string;
  customerId: string;
  accountName?: string;
  range: MonitorDateRange;
}): Promise<MonitorProviderReport> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!developerToken) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is required for Google Ads reporting.");
  }

  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM ad_group
    WHERE segments.date BETWEEN '${input.range.since}' AND '${input.range.until}'
  `;
  const response = await fetch(
    `https://googleads.googleapis.com/${DEFAULT_GOOGLE_ADS_VERSION}/customers/${stripCustomerPrefix(input.customerId)}/googleAds:search`,
    {
      method: "POST",
      cache: "no-store",
      headers: buildGoogleAdsHeaders(input.accessToken, developerToken),
      body: JSON.stringify({ query }),
    },
  );
  const payload = (await response.json()) as GoogleSearchResponse & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Google Ads request failed with ${response.status}.`);
  }

  return normalizeGoogleAdsRows(payload.results ?? [], {
    accountId: input.customerId,
    accountName: input.accountName,
    lastSyncAt: new Date().toISOString(),
  });
}

export async function fetchGoogleAccessibleCustomers(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!developerToken) {
    return [];
  }

  const response = await fetch(`https://googleads.googleapis.com/${DEFAULT_GOOGLE_ADS_VERSION}/customers:listAccessibleCustomers`, {
    cache: "no-store",
    headers: buildGoogleAdsHeaders(accessToken, developerToken),
  });
  const payload = (await response.json()) as { resourceNames?: string[]; error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Google Ads customer lookup failed with ${response.status}.`);
  }

  return (payload.resourceNames ?? []).map((resourceName) => ({
    id: resourceName.replace(/^customers\//, ""),
    name: resourceName,
  }));
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json()) as { access_token?: string; error_description?: string; error?: string };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "Google token refresh failed.");
  }

  return payload.access_token;
}

function buildGoogleAdsHeaders(accessToken: string, developerToken: string): HeadersInit {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "content-type": "application/json",
  };

  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers["login-customer-id"] = stripCustomerPrefix(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  }

  return headers;
}

function buildDailyFromRows(rows: GoogleAdsRow[], performanceRows: MonitorPerformanceRow[]) {
  const byDate = new Map<string, { spendAud: number; leads: number; validLeads: number }>();

  rows.forEach((row, index) => {
    const date = row.segments?.date ?? new Date().toISOString().slice(0, 10);
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

function inferRangeFromRows(rows: GoogleAdsRow[]): MonitorDateRange {
  const dates = rows.map((row) => row.segments?.date).filter((date): date is string => Boolean(date)).sort();
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

function stripCustomerPrefix(value: string): string {
  return value.replace(/^customers\//, "").replaceAll("-", "");
}

function microsToMoney(value: string | number | null | undefined): number {
  return Math.round((toNumber(value) / 1_000_000) * 100) / 100;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}
