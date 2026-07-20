import type { MonitorCustomRange, MonitorDateRange, MonitorRange } from "../monitor/dashboard-data.ts";

export type { MonitorCustomRange, MonitorDateRange, MonitorRange };

export type MetaMonitorSummary = {
  dateRange: { start: string; end: string; label: string };
  lastSyncedAt: string | null;
  budget: number | null;
  reach: number;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  validLeads: number;
  previousPeriod?: {
    reach: number;
    impressions: number;
    clicks: number;
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

/** Variant metadata parsed from the `| bw:v=…;a=…;t=…` ad-name suffix Ad Studio appends at publish. */
export type AdVariantTags = {
  variantId: string;
  angle: string;
  template: string | null;
};

/** Per-angle aggregate built from A3 ad-name tags. Untagged ads group under "Untagged". */
export type AnglePerformance = {
  angle: string;
  template: string | null;
  ads: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
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
    reach: number;
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
  management: {
    managedByBlockwise: boolean;
    adsetDailyBudgetDollars: number | null;
  };
  /** Parsed Ad Studio variant tags from the ad name; null/absent for untagged ads. Additive. */
  variantTags?: AdVariantTags | null;
  /** True when frequency > 2.5 and 7-day CTR dropped >=30% vs the prior 7 days (>=1k impressions per window). Additive. */
  fatigued?: boolean;
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
  /** Per-angle aggregates from A3 ad-name tags. Absent/empty when no tagged ads exist. Additive. */
  anglePerformance?: AnglePerformance[];
};

export type BudgetPacingResult = {
  budget: number;
  spend: number;
  spendPercent: number;
  expectedSpendToDate: number;
  forecastSpend: number;
  status: "Overspending" | "On pace" | "Under pacing";
};
