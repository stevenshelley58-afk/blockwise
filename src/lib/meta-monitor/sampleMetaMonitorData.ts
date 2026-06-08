import { resolveMonitorDateRange } from "../monitor/dashboard-data.ts";
import { safeCpl, safeRate } from "./calculations.ts";
import type { MetaAdPerformance, MetaDailyPoint, MetaMonitorPayload, MonitorRange } from "./types.ts";

/**
 * Demo fixtures shown when NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA === "true", or as
 * the default "demo data" experience for workspaces with no Meta connection.
 * Internally consistent over 30 days: spend Σ $5,940 · 176 leads · 118 valid.
 * Demo data is dropped automatically the moment a real connection exists.
 */

const SPEND_30 = [155, 170, 190, 240, 280, 310, 250, 205, 185, 160, 175, 210, 230, 195, 170, 150, 165, 185, 220, 260, 250, 205, 180, 165, 190, 215, 245, 205, 95, 85];
const VALID_30 = [3, 2, 4, 5, 7, 6, 4, 3, 2, 0, 3, 4, 6, 5, 4, 3, 2, 3, 4, 5, 6, 4, 3, 0, 4, 5, 9, 7, 3, 2];
const LEADS_30 = [5, 3, 6, 7, 10, 9, 6, 4, 3, 1, 4, 6, 9, 7, 6, 4, 3, 5, 6, 7, 9, 6, 4, 1, 6, 7, 13, 10, 5, 4];

const SAMPLE_BUDGET = 7500;

const SUBURB_VALID: Array<[string, number]> = [
  ["Carlingford", 30],
  ["Subiaco", 21],
  ["Parramatta", 17],
  ["Eastwood", 13],
  ["Marsfield", 11],
  ["North Ryde", 8],
  ["Epping", 6],
  ["Denistone", 5],
  ["West Ryde", 4],
  ["Meadowbank", 3],
];

type SampleAd = {
  adId: string;
  adName: string;
  suburb: string;
  status: MetaAdPerformance["status"];
  creativeType: MetaAdPerformance["creative"]["type"];
  headline: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  validLeads: number;
  placements: Array<[string, number]>;
  devices: Array<[string, number]>;
};

const SAMPLE_ADS: SampleAd[] = [
  {
    adId: "120208746201302", adName: "Lover (Image)", suburb: "Carlingford", status: "ACTIVE",
    creativeType: "IMAGE", headline: "What's your home really worth?",
    spend: 1495, impressions: 334500, clicks: 8120, leads: 50, validLeads: 38,
    placements: [["Facebook Feed", 72], ["Instagram Feed", 18], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 86], ["Desktop", 11], ["Tablet", 3]],
  },
  {
    adId: "120208746201303", adName: "40% OFF (Image)", suburb: "Carlingford", status: "ACTIVE",
    creativeType: "IMAGE", headline: "Limited appraisal offer",
    spend: 1142, impressions: 278300, clicks: 6512, leads: 32, validLeads: 21,
    placements: [["Facebook Feed", 70], ["Instagram Feed", 20], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 84], ["Desktop", 13], ["Tablet", 3]],
  },
  {
    adId: "120208746201304", adName: "Property Checklist (Video)", suburb: "Parramatta", status: "ACTIVE",
    creativeType: "VIDEO", headline: "Selling? Start with this checklist",
    spend: 1139, impressions: 245900, clicks: 5813, leads: 35, validLeads: 23,
    placements: [["Facebook Feed", 68], ["Instagram Feed", 22], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 83], ["Desktop", 14], ["Tablet", 3]],
  },
  {
    adId: "120208746201305", adName: "Home Value (Image)", suburb: "Subiaco", status: "PAUSED",
    creativeType: "IMAGE", headline: "Free home value report",
    spend: 926, impressions: 198400, clicks: 4721, leads: 27, validLeads: 17,
    placements: [["Facebook Feed", 74], ["Instagram Feed", 16], ["Instagram Stories", 7], ["Audience Network", 3]],
    devices: [["Mobile", 88], ["Desktop", 9], ["Tablet", 3]],
  },
  {
    adId: "120208746201306", adName: "Seller Guide (Image)", suburb: "Eastwood", status: "ACTIVE",
    creativeType: "IMAGE", headline: "The 2026 seller's guide",
    spend: 738, impressions: 176200, clicks: 4112, leads: 18, validLeads: 11,
    placements: [["Facebook Feed", 69], ["Instagram Feed", 21], ["Instagram Stories", 7], ["Audience Network", 3]],
    devices: [["Mobile", 85], ["Desktop", 12], ["Tablet", 3]],
  },
  {
    adId: "120208746201307", adName: "House Sold (Image)", suburb: "Marsfield", status: "ACTIVE",
    creativeType: "IMAGE", headline: "Just sold near you",
    spend: 500, impressions: 142300, clicks: 3128, leads: 14, validLeads: 8,
    placements: [["Facebook Feed", 71], ["Instagram Feed", 19], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 87], ["Desktop", 10], ["Tablet", 3]],
  },
];

const SAMPLE_CREATIVES = ["/ads/ad-northstar.jpg", "/ads/ad-coastline.jpg", "/ads/ad-hillview.jpg", "/ads/ad-hillco.jpg"];

export function buildSampleMetaMonitorPayload(
  input: { range?: MonitorRange; now?: Date; connected?: boolean } = {},
): MetaMonitorPayload {
  const range = resolveMonitorDateRange(input.range ?? "last_30", input.now ?? new Date());
  const days = Math.min(range.days, 30);
  const spendSeries = SPEND_30.slice(30 - days);
  const validSeries = VALID_30.slice(30 - days);
  const leadsSeries = LEADS_30.slice(30 - days);
  const scale = sum(spendSeries) / sum(SPEND_30);

  const daily: MetaDailyPoint[] = spendSeries.map((spend, index) => {
    const date = addDays(range.since, index);

    return {
      date,
      spend,
      leads: leadsSeries[index],
      validLeads: validSeries[index],
      validCpl: safeCpl(spend, validSeries[index]),
    };
  });

  const spend = sum(spendSeries);
  const leads = sum(leadsSeries);
  const validLeads = sum(validSeries);

  const ads: MetaAdPerformance[] = SAMPLE_ADS.map((ad, adIndex) => {
    const creativeImage = SAMPLE_CREATIVES[adIndex % SAMPLE_CREATIVES.length];
    const adSpend = round2(ad.spend * scale);
    const adLeads = Math.round(ad.leads * scale);
    const adValid = Math.min(Math.round(ad.validLeads * scale), adLeads);
    const impressions = Math.round(ad.impressions * scale);
    const clicks = Math.round(ad.clicks * scale);

    return {
      adId: ad.adId,
      adName: ad.adName,
      campaignId: `c-${ad.suburb.toLowerCase()}`,
      campaignName: `Suburb Appraisal - ${ad.suburb}`,
      adsetId: `as-${ad.suburb.toLowerCase()}`,
      adsetName: `Suburb - ${ad.suburb}`,
      suburb: ad.suburb,
      status: ad.status,
      landingPageUrl: "https://example.com/appraisal",
      metaPermalinkUrl: null,
      creative: {
        type: ad.creativeType,
        thumbnailUrl: null,
        imageUrl: ad.creativeType === "IMAGE" ? creativeImage : null,
        videoThumbnailUrl: ad.creativeType === "VIDEO" ? creativeImage : null,
        primaryText: null,
        headline: ad.headline,
        description: null,
      },
      metrics: {
        spend: adSpend,
        impressions,
        clicks,
        ctr: safeRate(clicks, impressions),
        leads: adLeads,
        validLeads: adValid,
        validRate: safeRate(adValid, adLeads),
        validCpl: safeCpl(adSpend, adValid),
        frequency: null,
        landingPageViews: null,
      },
      placementBreakdown: ad.placements.map(([label, percentage]) => ({
        label,
        impressions: Math.round((impressions * percentage) / 100),
        percentage,
      })),
      deviceBreakdown: ad.devices.map(([label, percentage]) => ({
        label,
        impressions: Math.round((impressions * percentage) / 100),
        percentage,
      })),
    };
  });

  const suburbSpendByName = new Map<string, number>();

  for (const ad of ads) {
    if (ad.suburb) {
      suburbSpendByName.set(ad.suburb, (suburbSpendByName.get(ad.suburb) ?? 0) + ad.metrics.spend);
    }
  }

  const suburbPerformance = SUBURB_VALID.map(([suburb, valid]) => {
    const suburbValid = Math.round(valid * scale);
    const suburbSpend = suburbSpendByName.get(suburb) ?? 0;

    return {
      suburb,
      spend: suburbSpend,
      leads: Math.round((valid / 0.67) * scale),
      validLeads: suburbValid,
      validCpl: suburbSpend > 0 ? safeCpl(suburbSpend, suburbValid) : null,
    };
  }).filter((row) => row.validLeads > 0);

  return {
    connected: input.connected ?? true,
    source: "sample",
    currencyCode: "AUD",
    range,
    issue: null,
    summary: {
      dateRange: { start: range.since, end: range.until, label: range.label },
      lastSyncedAt: new Date((input.now ?? new Date()).getTime() - 4 * 60 * 1000).toISOString(),
      budget: SAMPLE_BUDGET,
      spend,
      impressions: sum(ads.map((ad) => ad.metrics.impressions)),
      clicks: sum(ads.map((ad) => ad.metrics.clicks)),
      leads,
      validLeads,
      previousPeriod: {
        spend: round2(spend / 1.124),
        leads: Math.round(leads / 1.183),
        validLeads: Math.round(validLeads / 1.082),
        validLeadRate: safeRate(Math.round(validLeads / 1.082), Math.round(leads / 1.183)),
        validCpl: safeCpl(round2(spend / 1.124), Math.round(validLeads / 1.082)),
      },
    },
    daily,
    suburbPerformance,
    ads,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}
