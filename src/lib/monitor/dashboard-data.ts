export type MonitorRange = "today" | "yesterday" | "last_7" | "last_30";
export type MonitorProvider = "meta" | "google";
export type MonitorProviderStatus = "connected" | "needs_attention" | "not_connected" | "degraded";
export type MonitorDataSource = "demo" | "live";

export type MonitorDateRange = {
  key: MonitorRange;
  label: string;
  since: string;
  until: string;
  days: number;
};

export type MonitorMetrics = {
  spendAud: number;
  impressions: number;
  clicks: number;
  leads: number;
  validLeads: number;
  validLeadRate: number;
  cplAud: number;
  validCplAud: number;
};

export type MonitorDailyPoint = {
  date: string;
  spendAud: number;
  leads: number;
  validLeads: number;
  validCplAud: number;
};

export type MonitorPerformanceRow = {
  id: string;
  provider: MonitorProvider;
  type: "campaign" | "ad" | "ad_group";
  name: string;
  campaignName: string;
  status: "active" | "paused" | "draft" | "unknown";
  spendAud: number;
  impressions: number;
  clicks: number;
  leads: number;
  validLeads: number;
  validLeadRate: number;
  cplAud: number;
  validCplAud: number;
  ctr: number;
  cpcAud: number;
  insight: string;
};

export type MonitorCreativePreview = {
  id: string;
  provider: "meta";
  title: string;
  body: string;
  imageUrl?: string;
  status: string;
  spendAud: number;
  validLeads: number;
};

export type MonitorProviderReport = {
  provider: MonitorProvider;
  status: MonitorProviderStatus;
  source: MonitorDataSource;
  accountName: string;
  accountId?: string;
  lastSyncAt: string | null;
  issue?: string;
  metrics: MonitorMetrics;
  daily: MonitorDailyPoint[];
  rows: MonitorPerformanceRow[];
  creativePreviews: MonitorCreativePreview[];
};

type NormalizablePerformanceRow =
  | MonitorPerformanceRow
  | Omit<MonitorPerformanceRow, "validLeadRate" | "cplAud" | "validCplAud" | "ctr" | "cpcAud">;

type NormalizableProviderReport = Omit<MonitorProviderReport, "metrics" | "daily" | "rows"> & {
  daily?: MonitorDailyPoint[];
  metrics: Partial<MonitorMetrics> & Pick<MonitorMetrics, "spendAud" | "impressions" | "clicks" | "leads" | "validLeads">;
  rows: NormalizablePerformanceRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const AU_DASHBOARD_OFFSET_MS = 10 * 60 * 60 * 1000;

const RANGE_LABELS: Record<MonitorRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
};

const RANGE_DAYS: Record<MonitorRange, number> = {
  today: 1,
  yesterday: 1,
  last_7: 7,
  last_30: 30,
};

export function resolveMonitorDateRange(range: MonitorRange = "last_30", now = new Date()): MonitorDateRange {
  const normalizedNow = parseDateKey(toAuDashboardDateKey(now));
  const days = RANGE_DAYS[range];
  let end = normalizedNow;

  if (range === "yesterday") {
    end = new Date(normalizedNow.getTime() - DAY_MS);
  }

  const start = range === "today" || range === "yesterday" ? end : new Date(end.getTime() - (days - 1) * DAY_MS);

  return {
    key: range,
    label: RANGE_LABELS[range],
    since: toDateKey(start),
    until: toDateKey(end),
    days,
  };
}

export function parseMonitorRange(value: string | null | undefined): MonitorRange {
  if (value === "today" || value === "yesterday" || value === "last_7" || value === "last_30") {
    return value;
  }

  return "last_30";
}

export function calculateValidLeadRate(leads: number, validLeads: number): number {
  return leads > 0 ? validLeads / leads : 0;
}

export function calculateValidCpl(spendAud: number, validLeads: number): number {
  return validLeads > 0 ? roundMoney(spendAud / validLeads) : 0;
}

export function normalizeProviderReport(
  report: NormalizableProviderReport,
  range: MonitorDateRange,
): MonitorProviderReport {
  const metrics = withDerivedMetrics(report.metrics);
  const daily = report.daily?.length ? report.daily.map(withDerivedDailyPoint) : buildDailyPoints(range, metrics);
  const rows = report.rows.map((row) => withDerivedPerformanceRow(row));

  return {
    ...report,
    metrics,
    daily,
    rows,
  };
}

export function withDerivedMetrics(
  metrics: Partial<MonitorMetrics> & Pick<MonitorMetrics, "spendAud" | "impressions" | "clicks" | "leads" | "validLeads">,
): MonitorMetrics {
  return {
    spendAud: roundMoney(metrics.spendAud),
    impressions: Math.round(metrics.impressions),
    clicks: Math.round(metrics.clicks),
    leads: Math.round(metrics.leads),
    validLeads: Math.round(metrics.validLeads),
    validLeadRate: roundRate(metrics.validLeadRate ?? calculateValidLeadRate(metrics.leads, metrics.validLeads)),
    cplAud: metrics.leads > 0 ? roundMoney(metrics.spendAud / metrics.leads) : 0,
    validCplAud: calculateValidCpl(metrics.spendAud, metrics.validLeads),
  };
}

export function withDerivedPerformanceRow(
  row: Omit<MonitorPerformanceRow, "validLeadRate" | "cplAud" | "validCplAud" | "ctr" | "cpcAud"> | MonitorPerformanceRow,
): MonitorPerformanceRow {
  const existing = row as Partial<MonitorPerformanceRow>;

  return {
    ...row,
    spendAud: roundMoney(row.spendAud),
    validLeadRate: roundRate(existing.validLeadRate ?? calculateValidLeadRate(row.leads, row.validLeads)),
    cplAud: row.leads > 0 ? roundMoney(row.spendAud / row.leads) : 0,
    validCplAud: calculateValidCpl(row.spendAud, row.validLeads),
    ctr: existing.ctr ?? roundRate(row.impressions > 0 ? row.clicks / row.impressions : 0),
    cpcAud: existing.cpcAud ?? (row.clicks > 0 ? roundMoney(row.spendAud / row.clicks) : 0),
  };
}

function buildDailyPoints(range: MonitorDateRange, metrics: MonitorMetrics): MonitorDailyPoint[] {
  const start = parseDateKey(range.since);
  const weights = Array.from({ length: range.days }, (_, index) => 0.78 + ((index * 17) % 9) / 20);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let spent = 0;
  let leadsAssigned = 0;
  let validAssigned = 0;

  return weights.map((weight, index) => {
    const isLast = index === weights.length - 1;
    const spendAud = isLast ? roundMoney(metrics.spendAud - spent) : roundMoney((metrics.spendAud * weight) / weightTotal);
    const leads = isLast ? metrics.leads - leadsAssigned : Math.round((metrics.leads * weight) / weightTotal);
    const validLeads = isLast ? metrics.validLeads - validAssigned : Math.round((metrics.validLeads * weight) / weightTotal);
    spent = roundMoney(spent + spendAud);
    leadsAssigned += leads;
    validAssigned += validLeads;

    return withDerivedDailyPoint({
      date: toDateKey(new Date(start.getTime() + index * DAY_MS)),
      spendAud,
      leads,
      validLeads,
      validCplAud: 0,
    });
  });
}

function withDerivedDailyPoint(point: MonitorDailyPoint): MonitorDailyPoint {
  return {
    ...point,
    spendAud: roundMoney(point.spendAud),
    validCplAud: calculateValidCpl(point.spendAud, point.validLeads),
  };
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toAuDashboardDateKey(date: Date): string {
  return new Date(date.getTime() + AU_DASHBOARD_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 10_000) / 10_000;
}
