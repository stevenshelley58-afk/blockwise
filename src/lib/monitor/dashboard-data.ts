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

export type MonitorLeadRow = {
  id: string;
  name: string;
  suburb: string;
  source: "Meta" | "Google" | "CSV" | "Manual";
  quality: "Valid" | "Nurture" | "Duplicate" | "Unqualified";
  createdAt: string;
  attribution: string;
};

export type MonitorLeadSource = MonitorLeadRow["source"];

export type MonitorDashboardBundle = {
  workspaceId: string;
  generatedAt: string;
  range: MonitorDateRange;
  currencyCode: "AUD";
  totals: MonitorMetrics;
  providers: MonitorProviderReport[];
  topRows: MonitorPerformanceRow[];
  daily: MonitorDailyPoint[];
  validCplTrend: Array<{ date: string; validCplAud: number }>;
  spendByCampaign: Array<{ name: string; spendAud: number; provider: MonitorProvider }>;
  recommendations: Array<{ tone: "green" | "amber" | "rose" | "blue"; title: string; detail: string }>;
  leads: {
    rows: MonitorLeadRow[];
    duplicateCount: number;
    sourceSplit: Array<{ source: MonitorLeadRow["source"]; leads: number; validLeads: number }>;
    dedupeSummary: string;
  };
};

type DemoOptions = {
  workspaceId: string;
  range?: MonitorRange;
  now?: Date;
};

type ProviderFixture = Omit<MonitorProviderReport, "metrics" | "daily" | "rows" | "creativePreviews"> & {
  metrics: Omit<MonitorMetrics, "validLeadRate" | "cplAud" | "validCplAud">;
  daily?: MonitorDailyPoint[];
  rows: Array<Omit<MonitorPerformanceRow, "validLeadRate" | "cplAud" | "validCplAud" | "ctr" | "cpcAud">>;
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

const DEMO_PROVIDER_FIXTURES: Record<MonitorRange, ProviderFixture[]> = {
  today: [
    createProviderFixture("meta", 260, 18_200, 420, 14, 9),
    createProviderFixture("google", 180, 4_800, 138, 5, 3),
  ],
  yesterday: [
    createProviderFixture("meta", 310, 20_400, 465, 16, 11),
    createProviderFixture("google", 220, 5_200, 150, 6, 4),
  ],
  last_7: [
    createProviderFixture("meta", 2560, 126_000, 2960, 78, 55),
    createProviderFixture("google", 2040, 38_500, 980, 44, 28),
  ],
  last_30: [
    createProviderFixture("meta", 3560, 248_000, 5940, 112, 78),
    createProviderFixture("google", 2380, 86_500, 2180, 64, 40),
  ],
};

const DEMO_LEADS: MonitorLeadRow[] = [
  {
    id: "lead_001",
    name: "Amelia Hart",
    suburb: "Subiaco",
    source: "Meta",
    quality: "Valid",
    createdAt: "2026-05-27T02:20:00.000Z",
    attribution: "Suburb appraisal pulse",
  },
  {
    id: "lead_002",
    name: "Daniel Ng",
    suburb: "Leederville",
    source: "Google",
    quality: "Nurture",
    createdAt: "2026-05-26T09:40:00.000Z",
    attribution: "Appraisal search / Leederville",
  },
  {
    id: "lead_003",
    name: "Sofia Lane",
    suburb: "Mount Lawley",
    source: "Meta",
    quality: "Valid",
    createdAt: "2026-05-25T12:10:00.000Z",
    attribution: "Downsizer decision guide",
  },
  {
    id: "lead_004",
    name: "Oliver Reid",
    suburb: "Cottesloe",
    source: "Google",
    quality: "Valid",
    createdAt: "2026-05-24T06:55:00.000Z",
    attribution: "Seller guide search",
  },
  {
    id: "lead_005",
    name: "Priya Sethi",
    suburb: "Subiaco",
    source: "CSV",
    quality: "Duplicate",
    createdAt: "2026-05-23T03:15:00.000Z",
    attribution: "Manual import",
  },
  {
    id: "lead_006",
    name: "Marcus Bell",
    suburb: "Fremantle",
    source: "Manual",
    quality: "Unqualified",
    createdAt: "2026-05-22T11:00:00.000Z",
    attribution: "Phone enquiry",
  },
];

export function resolveMonitorDateRange(range: MonitorRange = "last_30", now = new Date()): MonitorDateRange {
  const normalizedNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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

export function buildDemoMonitorDashboardBundle(options: DemoOptions): MonitorDashboardBundle {
  const rangeKey = options.range ?? "last_30";
  const now = options.now ?? new Date();
  const range = resolveMonitorDateRange(rangeKey, now);
  const providers = DEMO_PROVIDER_FIXTURES[rangeKey].map((fixture) => normalizeProviderReport(fixture, range));

  return buildBundleFromProviders({
    workspaceId: options.workspaceId,
    generatedAt: now.toISOString(),
    range,
    providers,
    leadRows: DEMO_LEADS,
  });
}

const PROVIDER_LEAD_SOURCE: Record<MonitorProvider, MonitorLeadSource> = {
  meta: "Meta",
  google: "Google",
};

// Lead sources that are not tied to an ad provider and should always be shown.
const NON_PROVIDER_LEAD_SOURCES: ReadonlySet<MonitorLeadSource> = new Set(["CSV", "Manual"]);

/**
 * Rebuilds a demo bundle limited to the providers a workspace has actually connected.
 * Provider cards and provider-sourced demo leads (Meta/Google) are dropped unless that
 * provider is connected; non-provider leads (CSV/Manual) are always retained. Totals,
 * top rows, charts and lead source splits are recomputed from the filtered set.
 */
export function scopeDemoBundleToProviders(
  demo: MonitorDashboardBundle,
  connectedProviders: ReadonlySet<MonitorProvider>,
): MonitorDashboardBundle {
  const allowedLeadSources: Set<MonitorLeadSource> = new Set(NON_PROVIDER_LEAD_SOURCES);
  for (const provider of connectedProviders) {
    allowedLeadSources.add(PROVIDER_LEAD_SOURCE[provider]);
  }

  return buildBundleFromProviders({
    workspaceId: demo.workspaceId,
    generatedAt: demo.generatedAt,
    range: demo.range,
    providers: demo.providers.filter((provider) => connectedProviders.has(provider.provider)),
    leadRows: demo.leads.rows.filter((lead) => allowedLeadSources.has(lead.source)),
  });
}

export function mergeProviderReportsWithDemo(
  demo: MonitorDashboardBundle,
  providerReports: NormalizableProviderReport[],
): MonitorDashboardBundle {
  const liveByProvider = new Map(providerReports.map((report) => [report.provider, report]));
  const providers = demo.providers.map((provider) => {
    const live = liveByProvider.get(provider.provider);

    if (!live) {
      return provider;
    }

    return normalizeProviderReport({
      ...live,
      metrics: live.metrics,
      rows: live.rows,
      creativePreviews: live.creativePreviews,
    }, demo.range);
  });

  return buildBundleFromProviders({
    workspaceId: demo.workspaceId,
    generatedAt: new Date().toISOString(),
    range: demo.range,
    providers,
    leadRows: demo.leads.rows,
  });
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

function buildBundleFromProviders({
  workspaceId,
  generatedAt,
  range,
  providers,
  leadRows,
}: {
  workspaceId: string;
  generatedAt: string;
  range: MonitorDateRange;
  providers: MonitorProviderReport[];
  leadRows: MonitorLeadRow[];
}): MonitorDashboardBundle {
  const totals = withDerivedMetrics(
    providers.reduce(
      (acc, provider) => ({
        spendAud: acc.spendAud + provider.metrics.spendAud,
        impressions: acc.impressions + provider.metrics.impressions,
        clicks: acc.clicks + provider.metrics.clicks,
        leads: acc.leads + provider.metrics.leads,
        validLeads: acc.validLeads + provider.metrics.validLeads,
      }),
      { spendAud: 0, impressions: 0, clicks: 0, leads: 0, validLeads: 0 },
    ),
  );
  const topRows = providers
    .flatMap((provider) => provider.rows)
    .sort((a, b) => b.spendAud - a.spendAud)
    .slice(0, 8);
  const daily = mergeDailyPoints(providers.flatMap((provider) => provider.daily));
  const spendByCampaign = topRows.slice(0, 6).map((row) => ({
    name: row.name,
    spendAud: row.spendAud,
    provider: row.provider,
  }));

  return {
    workspaceId,
    generatedAt,
    range,
    currencyCode: "AUD",
    totals,
    providers,
    topRows,
    daily,
    validCplTrend: daily.map((point) => ({ date: point.date, validCplAud: point.validCplAud })),
    spendByCampaign,
    recommendations: buildRecommendations(totals, providers),
    leads: {
      rows: leadRows,
      duplicateCount: leadRows.filter((lead) => lead.quality === "Duplicate").length,
      sourceSplit: buildLeadSourceSplit(leadRows),
      dedupeSummary: "1 duplicate candidate is held from exports until reviewed.",
    },
  };
}

function createProviderFixture(
  provider: MonitorProvider,
  spendAud: number,
  impressions: number,
  clicks: number,
  leads: number,
  validLeads: number,
): ProviderFixture {
  const isMeta = provider === "meta";
  const rows = isMeta
    ? [
        createRow("meta_ad_suburb_pulse", provider, "Suburb appraisal pulse", "Seller lead ads", "active", spendAud * 0.42, impressions * 0.42, clicks * 0.43, leads * 0.45, validLeads * 0.49, "Suburb-specific seller hooks are driving the strongest valid CPL."),
        createRow("meta_ad_downsizer", provider, "Downsizer decision guide", "Seller lead ads", "active", spendAud * 0.32, impressions * 0.34, clicks * 0.33, leads * 0.31, validLeads * 0.29, "Lead quality is steady but creative fatigue is starting to show."),
        createRow("meta_ad_home_value", provider, "Home value checklist", "Appraisal lead magnet", "paused", spendAud * 0.26, impressions * 0.24, clicks * 0.24, leads * 0.24, validLeads * 0.22, "Keep as fallback creative for owners still researching."),
      ]
    : [
        createRow("google_campaign_appraisal", provider, "Appraisal search / Subiaco", "High-intent search", "active", spendAud * 0.48, impressions * 0.34, clicks * 0.46, leads * 0.5, validLeads * 0.52, "Strong intent, but query cleanup should protect valid CPL."),
        createRow("google_campaign_seller_report", provider, "Seller guide search", "High-intent search", "active", spendAud * 0.31, impressions * 0.38, clicks * 0.32, leads * 0.28, validLeads * 0.27, "Good lead quality for suburb guide terms."),
        createRow("google_campaign_broad", provider, "Broad property appraisal", "Discovery search", "active", spendAud * 0.21, impressions * 0.28, clicks * 0.22, leads * 0.22, validLeads * 0.21, "Broader phrases need negative keyword review."),
      ];

  return {
    provider,
    status: "not_connected",
    source: "demo",
    accountName: isMeta ? "Sample Meta Ads" : "Sample Google Ads",
    lastSyncAt: null,
    issue: "Sample data shown until this provider is connected.",
    metrics: { spendAud, impressions, clicks, leads, validLeads },
    rows,
    creativePreviews: isMeta
      ? [
          {
            id: "creative_suburb_pulse",
            provider: "meta",
            title: "What changed in your suburb this month?",
            body: "A clean seller report creative with suburb price movement and appraisal CTA.",
            status: "Active sample",
            spendAud: roundMoney(spendAud * 0.42),
            validLeads: Math.round(validLeads * 0.49),
          },
          {
            id: "creative_downsizer",
            provider: "meta",
            title: "Thinking of downsizing in 2026?",
            body: "Checklist-led creative for homeowners comparing sell, hold, or renovate.",
            status: "Review sample",
            spendAud: roundMoney(spendAud * 0.32),
            validLeads: Math.round(validLeads * 0.29),
          },
        ]
      : [],
  };
}

function createRow(
  id: string,
  provider: MonitorProvider,
  name: string,
  campaignName: string,
  status: MonitorPerformanceRow["status"],
  spendAud: number,
  impressions: number,
  clicks: number,
  leads: number,
  validLeads: number,
  insight: string,
): Omit<MonitorPerformanceRow, "validLeadRate" | "cplAud" | "validCplAud" | "ctr" | "cpcAud"> {
  return {
    id,
    provider,
    type: provider === "meta" ? "ad" : "ad_group",
    name,
    campaignName,
    status,
    spendAud: roundMoney(spendAud),
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    leads: Math.round(leads),
    validLeads: Math.round(validLeads),
    insight,
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

function mergeDailyPoints(points: MonitorDailyPoint[]): MonitorDailyPoint[] {
  const byDate = new Map<string, MonitorDailyPoint>();

  for (const point of points) {
    const existing = byDate.get(point.date) ?? { date: point.date, spendAud: 0, leads: 0, validLeads: 0, validCplAud: 0 };
    byDate.set(point.date, {
      date: point.date,
      spendAud: existing.spendAud + point.spendAud,
      leads: existing.leads + point.leads,
      validLeads: existing.validLeads + point.validLeads,
      validCplAud: 0,
    });
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).map(withDerivedDailyPoint);
}

function buildRecommendations(totals: MonitorMetrics, providers: MonitorProviderReport[]) {
  const recommendations: MonitorDashboardBundle["recommendations"] = [];

  if (totals.validCplAud > 55) {
    recommendations.push({
      tone: "amber",
      title: "Valid CPL is above target",
      detail: "Move budget toward suburb-specific appraisal hooks and pause broad ad groups with weak valid lead rates.",
    });
  } else {
    recommendations.push({
      tone: "green",
      title: "Valid CPL is controlled",
      detail: "Keep testing new suburb angles while current valid CPL is within the working target band.",
    });
  }

  if (totals.validLeadRate < 0.6) {
    recommendations.push({
      tone: "rose",
      title: "Lead quality needs attention",
      detail: "Review forms and search queries before scaling spend.",
    });
  }

  for (const provider of providers.filter((item) => item.status === "degraded" || item.status === "needs_attention")) {
    recommendations.push({
      tone: "amber",
      title: `${provider.provider === "meta" ? "Meta" : "Google"} sync needs attention`,
      detail: provider.issue ?? "Reconnect the provider to restore live reporting.",
    });
  }

  return recommendations.slice(0, 4);
}

function buildLeadSourceSplit(rows: MonitorLeadRow[]) {
  const sources: MonitorLeadRow["source"][] = ["Meta", "Google", "CSV", "Manual"];

  return sources
    .map((source) => {
      const sourceRows = rows.filter((row) => row.source === source);

      return {
        source,
        leads: sourceRows.length,
        validLeads: sourceRows.filter((row) => row.quality === "Valid").length,
      };
    })
    .filter((entry) => entry.leads > 0);
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
