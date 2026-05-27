export type AdProvider = "meta" | "google";

export type ProviderConnectionStatus = "connected" | "needs_attention" | "not_connected";

export type ReportingSnapshot = {
  workspaceId: string;
  provider: AdProvider;
  dateRange: "last_30_days";
  metrics: {
    spendAud: number;
    impressions: number;
    clicks: number;
    leads: number;
    validLeadRate: number;
    cplAud: number;
  };
  topCampaign: {
    name: string;
    status: "active" | "draft" | "paused";
    insight: string;
  };
};

export type ProviderSyncSummary = {
  workspaceId: string;
  provider: AdProvider;
  status: ProviderConnectionStatus;
  lastSyncAt: string | null;
  issue?: string;
};

export type ProviderAdapter = {
  provider: AdProvider;
  getReportingSnapshot(workspaceId: string): Promise<ReportingSnapshot>;
  getSyncSummary(workspaceId: string): Promise<ProviderSyncSummary>;
};

const SNAPSHOTS: Record<AdProvider, Omit<ReportingSnapshot, "workspaceId">> = {
  meta: {
    provider: "meta",
    dateRange: "last_30_days",
    metrics: {
      spendAud: 1840,
      impressions: 128_400,
      clicks: 3210,
      leads: 92,
      validLeadRate: 0.72,
      cplAud: 20,
    },
    topCampaign: {
      name: "Perth appraisal guide",
      status: "active",
      insight: "Short-form homeowner value hooks are producing the lowest CPL.",
    },
  },
  google: {
    provider: "google",
    dateRange: "last_30_days",
    metrics: {
      spendAud: 1245,
      impressions: 28_100,
      clicks: 870,
      leads: 30,
      validLeadRate: 0.63,
      cplAud: 41.5,
    },
    topCampaign: {
      name: "Suburb appraisal search",
      status: "active",
      insight: "High-intent suburb appraisal keywords need tighter negative keyword review.",
    },
  },
};

const SYNC_SUMMARIES: Record<AdProvider, Omit<ProviderSyncSummary, "workspaceId">> = {
  meta: {
    provider: "meta",
    status: "connected",
    lastSyncAt: "2026-05-26T06:30:00.000Z",
  },
  google: {
    provider: "google",
    status: "needs_attention",
    lastSyncAt: "2026-05-25T23:10:00.000Z",
    issue: "Refresh token expires soon. Reconnect before live publishing is enabled.",
  },
};

export function createMockProviderAdapter(provider: AdProvider): ProviderAdapter {
  return {
    provider,
    async getReportingSnapshot(workspaceId: string): Promise<ReportingSnapshot> {
      return {
        workspaceId,
        ...SNAPSHOTS[provider],
      };
    },
    async getSyncSummary(workspaceId: string): Promise<ProviderSyncSummary> {
      return {
        workspaceId,
        ...SYNC_SUMMARIES[provider],
      };
    },
  };
}

export async function listProviderSyncSummaries(workspaceId: string): Promise<ProviderSyncSummary[]> {
  const adapters = [createMockProviderAdapter("meta"), createMockProviderAdapter("google")];

  return Promise.all(adapters.map((adapter) => adapter.getSyncSummary(workspaceId)));
}

export async function listReportingSnapshots(workspaceId: string): Promise<ReportingSnapshot[]> {
  const adapters = [createMockProviderAdapter("meta"), createMockProviderAdapter("google")];

  return Promise.all(adapters.map((adapter) => adapter.getReportingSnapshot(workspaceId)));
}
