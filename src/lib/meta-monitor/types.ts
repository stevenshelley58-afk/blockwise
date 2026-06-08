import type { MonitorDateRange, MonitorRange } from "../monitor/dashboard-data.ts";

export type { MonitorDateRange, MonitorRange };

export type MetaMonitorSummary = {
  dateRange: { start: string; end: string; label: string };
  lastSyncedAt: string | null;
  budget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  validLeads: number;
  previousPeriod?: {
    spend: number;
    leads: number;
    validLeads: number;
    validLeadRate: number | null;
    validCpl: number | null;
  };
};

export type MetaDailyPoint = {
  date: string;
  spend: number;
  leads: number;
  validLeads: number;
  validCpl: number | null;
};

export type SuburbPerformance = {
  suburb: string;
  spend: number;
  leads: number;
  validLeads: number;
  validCpl: number | null;
};

export type MetaAdStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "UNKNOWN";

export type MetaAdPerformance = {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  suburb: string | null;
  status: MetaAdStatus;
  landingPageUrl: string | null;
  metaPermalinkUrl: string | null;
  creative: {
    type: "IMAGE" | "VIDEO" | "CAROUSEL" | "UNKNOWN";
    thumbnailUrl: string | null;
    imageUrl: string | null;
    videoThumbnailUrl: string | null;
    primaryText: string | null;
    headline: string | null;
    description: string | null;
  };
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
    leads: number;
    validLeads: number;
    validRate: number | null;
    validCpl: number | null;
    frequency: number | null;
    landingPageViews: number | null;
  };
  placementBreakdown?: Array<{ label: string; impressions: number; percentage: number }>;
  deviceBreakdown?: Array<{ label: string; impressions: number; percentage: number }>;
};

export type MetaMonitorPayload = {
  connected: boolean;
  source: "live" | "sample";
  currencyCode: "AUD";
  range: MonitorDateRange;
  /** Populated when a connected account failed to load. UI shows an error state, never fake data. */
  issue: string | null;
  summary: MetaMonitorSummary | null;
  daily: MetaDailyPoint[];
  suburbPerformance: SuburbPerformance[];
  ads: MetaAdPerformance[];
};

export type BudgetPacingResult = {
  budget: number;
  spend: number;
  spendPercent: number;
  expectedSpendToDate: number;
  forecastSpend: number;
  status: "Overspending" | "On pace" | "Under pacing";
};
