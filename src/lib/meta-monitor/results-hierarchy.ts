import { safeCpl, safeRate } from "./calculations.ts";
import type { MetaAdPerformance, MetaAdStatus } from "./types.ts";

export type ResultsHierarchyStatus = MetaAdStatus | "MIXED";

export type ResultsHierarchyMetrics = {
  reach: number;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  leads: number;
  validLeads: number;
  validRate: number | null;
  validCpl: number | null;
};

export type ResultsAdRow = {
  type: "ad";
  id: string;
  ad: MetaAdPerformance;
  name: string;
  status: MetaAdStatus;
  metrics: ResultsHierarchyMetrics;
  managedByBlockwise: boolean;
  fatigued: boolean;
};

export type ResultsAdSetRow = {
  type: "adset";
  id: string;
  adsetId: string;
  campaignId: string;
  name: string;
  status: ResultsHierarchyStatus;
  metrics: ResultsHierarchyMetrics;
  managedByBlockwise: boolean;
  dailyBudgetDollars: number | null;
  fatigued: boolean;
  ads: ResultsAdRow[];
};

export type ResultsCampaignRow = {
  type: "campaign";
  id: string;
  campaignId: string;
  name: string;
  status: ResultsHierarchyStatus;
  metrics: ResultsHierarchyMetrics;
  managedByBlockwise: boolean;
  fatigued: boolean;
  adSets: ResultsAdSetRow[];
};

type MutableAdSet = Omit<ResultsAdSetRow, "status" | "metrics" | "managedByBlockwise" | "dailyBudgetDollars" | "fatigued"> & {
  budgets: number[];
};

type MutableCampaign = Omit<ResultsCampaignRow, "status" | "metrics" | "managedByBlockwise" | "fatigued" | "adSets"> & {
  adSets: Map<string, MutableAdSet>;
};

export function buildResultsHierarchy(ads: MetaAdPerformance[]): ResultsCampaignRow[] {
  const campaigns = new Map<string, MutableCampaign>();

  for (const ad of ads) {
    const campaignKey = keyFor("campaign", ad.campaignId, ad.campaignName);
    const campaign = campaigns.get(campaignKey) ?? {
      type: "campaign",
      id: campaignKey,
      campaignId: ad.campaignId,
      name: ad.campaignName || "Meta campaign",
      adSets: new Map(),
    };

    const adSetKey = `${campaignKey}:${keyFor("adset", ad.adsetId, ad.adsetName)}`;
    const adSet = campaign.adSets.get(adSetKey) ?? {
      type: "adset",
      id: adSetKey,
      adsetId: ad.adsetId,
      campaignId: ad.campaignId,
      name: ad.adsetName || "Meta ad set",
      ads: [],
      budgets: [],
    };

    adSet.ads.push({
      type: "ad",
      id: ad.adId,
      ad,
      name: ad.adName || "Meta ad",
      status: ad.status,
      metrics: metricsFromAds([ad]),
      managedByBlockwise: ad.management.managedByBlockwise,
      fatigued: Boolean(ad.fatigued),
    });

    if (ad.management.adsetDailyBudgetDollars != null) {
      adSet.budgets.push(ad.management.adsetDailyBudgetDollars);
    }

    campaign.adSets.set(adSetKey, adSet);
    campaigns.set(campaignKey, campaign);
  }

  return Array.from(campaigns.values())
    .map((campaign): ResultsCampaignRow => {
      const adSets = Array.from(campaign.adSets.values())
        .map(finalizeAdSet)
        .sort((a, b) => b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name));
      const campaignAds = adSets.flatMap((adSet) => adSet.ads.map((row) => row.ad));

      return {
        type: "campaign",
        id: campaign.id,
        campaignId: campaign.campaignId,
        name: campaign.name,
        status: aggregateStatus(campaignAds),
        metrics: metricsFromAds(campaignAds),
        managedByBlockwise: adSets.some((adSet) => adSet.managedByBlockwise),
        fatigued: adSets.some((adSet) => adSet.fatigued),
        adSets,
      };
    })
    .sort((a, b) => b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name));
}

function finalizeAdSet(adSet: MutableAdSet): ResultsAdSetRow {
  const ads = adSet.ads.sort((a, b) => b.metrics.spend - a.metrics.spend || a.name.localeCompare(b.name));
  const sourceAds = ads.map((row) => row.ad);

  return {
    type: "adset",
    id: adSet.id,
    adsetId: adSet.adsetId,
    campaignId: adSet.campaignId,
    name: adSet.name,
    status: aggregateStatus(sourceAds),
    metrics: metricsFromAds(sourceAds),
    managedByBlockwise: ads.some((ad) => ad.managedByBlockwise),
    dailyBudgetDollars: firstStableBudget(adSet.budgets),
    fatigued: ads.some((ad) => ad.fatigued),
    ads,
  };
}

function metricsFromAds(ads: MetaAdPerformance[]): ResultsHierarchyMetrics {
  const totals = ads.reduce(
    (next, ad) => ({
      reach: next.reach + ad.metrics.reach,
      spend: next.spend + ad.metrics.spend,
      impressions: next.impressions + ad.metrics.impressions,
      clicks: next.clicks + ad.metrics.clicks,
      leads: next.leads + ad.metrics.leads,
      validLeads: next.validLeads + ad.metrics.validLeads,
    }),
    { reach: 0, spend: 0, impressions: 0, clicks: 0, leads: 0, validLeads: 0 },
  );

  return {
    ...totals,
    spend: round2(totals.spend),
    ctr: safeRate(totals.clicks, totals.impressions),
    validRate: safeRate(totals.validLeads, totals.leads),
    validCpl: safeCpl(round2(totals.spend), totals.validLeads),
  };
}

function aggregateStatus(ads: MetaAdPerformance[]): ResultsHierarchyStatus {
  const statuses = new Set(ads.map((ad) => ad.status));
  if (statuses.size === 1) return ads[0]?.status ?? "UNKNOWN";
  if (statuses.size === 0) return "UNKNOWN";

  return "MIXED";
}

function firstStableBudget(values: number[]): number | null {
  const first = values.find((value) => Number.isFinite(value) && value > 0);

  return first == null ? null : first;
}

function keyFor(scope: string, id: string, name: string): string {
  if (id) return `${scope}:${id}`;

  return `${scope}:missing:${name.trim().toLowerCase() || "unknown"}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
