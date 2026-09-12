import { resolveMonitorDateRange, type MonitorCustomRange } from "../monitor/dashboard-data.ts";
import { safeCpl, safeRate } from "./calculations.ts";
import type { MetaAdPerformance, MetaDailyPoint, MetaMonitorPayload, MonitorRange } from "./types.ts";

/**
 * Demo fixtures shown when NEXT_PUBLIC_BLOCKWISE_SAMPLE_DATA === "true", or as
 * the default "demo data" experience for workspaces with no Meta connection.
 * Internally consistent over 30 days: spend Σ $5,940 · 176 leads · 118 valid ·
 * about 7,400 clicks, which keeps the demo cost per click near $0.80.
 * Demo data is dropped automatically the moment a real connection exists.
 */

const SPEND_30 = [155, 170, 190, 240, 280, 310, 250, 205, 185, 160, 175, 210, 230, 195, 170, 150, 165, 185, 220, 260, 250, 205, 180, 165, 190, 215, 245, 205, 95, 85];
const VALID_30 = [3, 2, 4, 5, 7, 6, 4, 3, 2, 0, 3, 4, 6, 5, 4, 3, 2, 3, 4, 5, 6, 4, 3, 0, 4, 5, 9, 7, 3, 2];
const LEADS_30 = [5, 3, 6, 7, 10, 9, 6, 4, 3, 1, 4, 6, 9, 7, 6, 4, 3, 5, 6, 7, 9, 6, 4, 1, 6, 7, 13, 10, 5, 4];

/** Keeps sample cost per click near the $0.80 the demo copy implies. */
const SAMPLE_CLICK_SPEND_RATIO = 1.25;

/**
 * Day-to-day drift on that ratio, one entry per weekday and summing to zero so
 * the week's own cost per click still reads $0.80. A ratio that never moved left
 * the demo's cost per click flat, and a flat week has no line to draw: the card
 * looked like a missing chart rather than a steady one.
 */
const SAMPLE_CLICK_RATIO_DRIFT = [0.06, -0.05, 0.02, -0.06, 0.05, -0.04, 0.02];

/**
 * The same weekday drift for delivery. Reach and impressions follow spend, so
 * without it both lines would be a copy of the spend chart; keeping the two in
 * step holds the demo's frequency steady, which is what a real week looks like.
 */
const SAMPLE_DELIVERY_RATIO_DRIFT = [0.04, -0.03, 0.02, -0.04, 0.03, -0.02, 0];

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
  reach: number;
  impressions: number;
  leads: number;
  validLeads: number;
  placements: Array<[string, number]>;
  devices: Array<[string, number]>;
};

const SAMPLE_ADS: SampleAd[] = [
  {
    adId: "120208746201302", adName: "Lover (Image)", suburb: "Carlingford", status: "ACTIVE",
    creativeType: "IMAGE", headline: "What's your home really worth?",
    spend: 1495, reach: 143200, impressions: 334500, leads: 50, validLeads: 38,
    placements: [["Facebook Feed", 72], ["Instagram Feed", 18], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 86], ["Desktop", 11], ["Tablet", 3]],
  },
  {
    adId: "120208746201303", adName: "40% OFF (Image)", suburb: "Carlingford", status: "ACTIVE",
    creativeType: "IMAGE", headline: "Limited appraisal offer",
    spend: 1142, reach: 121600, impressions: 278300, leads: 32, validLeads: 21,
    placements: [["Facebook Feed", 70], ["Instagram Feed", 20], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 84], ["Desktop", 13], ["Tablet", 3]],
  },
  {
    adId: "120208746201304", adName: "Property Checklist (Video)", suburb: "Parramatta", status: "ACTIVE",
    creativeType: "VIDEO", headline: "Selling? Start with this checklist",
    spend: 1139, reach: 107800, impressions: 245900, leads: 35, validLeads: 23,
    placements: [["Facebook Feed", 68], ["Instagram Feed", 22], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 83], ["Desktop", 14], ["Tablet", 3]],
  },
  {
    adId: "120208746201305", adName: "Home Value (Image)", suburb: "Subiaco", status: "PAUSED",
    creativeType: "IMAGE", headline: "Free home value report",
    spend: 926, reach: 89400, impressions: 198400, leads: 27, validLeads: 17,
    placements: [["Facebook Feed", 74], ["Instagram Feed", 16], ["Instagram Stories", 7], ["Audience Network", 3]],
    devices: [["Mobile", 88], ["Desktop", 9], ["Tablet", 3]],
  },
  {
    adId: "120208746201306", adName: "Seller Guide (Image)", suburb: "Eastwood", status: "ACTIVE",
    creativeType: "IMAGE", headline: "The 2026 seller's guide",
    spend: 738, reach: 76300, impressions: 176200, leads: 18, validLeads: 11,
    placements: [["Facebook Feed", 69], ["Instagram Feed", 21], ["Instagram Stories", 7], ["Audience Network", 3]],
    devices: [["Mobile", 85], ["Desktop", 12], ["Tablet", 3]],
  },
  {
    adId: "120208746201307", adName: "House Sold (Image)", suburb: "Marsfield", status: "ACTIVE",
    creativeType: "IMAGE", headline: "Just sold near you",
    spend: 500, reach: 68800, impressions: 142300, leads: 14, validLeads: 8,
    placements: [["Facebook Feed", 71], ["Instagram Feed", 19], ["Instagram Stories", 8], ["Audience Network", 2]],
    devices: [["Mobile", 87], ["Desktop", 10], ["Tablet", 3]],
  },
];

const SAMPLE_CREATIVES = ["/ads/ad-northstar.jpg", "/ads/ad-coastline.jpg", "/ads/ad-hillview.jpg", "/ads/ad-hillco.jpg"];

export function buildSampleMetaMonitorPayload(
  input: { range?: MonitorRange; customRange?: MonitorCustomRange; now?: Date; connected?: boolean } = {},
): MetaMonitorPayload {
  const range = resolveMonitorDateRange(input.range ?? "last_30", input.now ?? new Date(), input.customRange);
  const days = Math.min(range.days, 30);
  const spendSeries = SPEND_30.slice(30 - days);
  const validSeries = VALID_30.slice(30 - days);
  const leadsSeries = LEADS_30.slice(30 - days);
  const scale = sum(spendSeries) / sum(SPEND_30);
  const spend = sum(spendSeries);
  // Delivery per dollar, taken from the ads' own totals so a chart of
  // impressions or reach lands near the figure the summary reports.
  const impressionsPerDollar = (sum(SAMPLE_ADS.map((ad) => ad.impressions)) * scale) / spend;
  const reachPerDollar = (sum(SAMPLE_ADS.map((ad) => ad.reach)) * scale) / spend;

  // The demo holds one month. Build all of it, anchored to the end of the range
  // so wide ranges (Maximum, long custom spans) still chart the most recent 30
  // sample days, then take the window that was asked for: a week's figures and
  // the week before it come out of the same series, so two surfaces showing
  // that week also agree on what it is being compared against.
  const monthStart = addDays(range.until, -29);
  const monthDaily: MetaDailyPoint[] = SPEND_30.map((spend, index) => {
    const drift = 1 + SAMPLE_DELIVERY_RATIO_DRIFT[index % SAMPLE_DELIVERY_RATIO_DRIFT.length];
    const impressions = spend > 0 ? Math.max(1, Math.round(spend * impressionsPerDollar * drift)) : 0;

    return {
      date: addDays(monthStart, index),
      spend,
      // Derived from the day's spend so the sample stays internally consistent:
      // Σ daily clicks is SAMPLE_CLICK_SPEND_RATIO × Σ spend, give or take the
      // weekday drift that keeps the demo cost per click moving.
      clicks:
        spend > 0
          ? Math.max(
              1,
              Math.round(
                spend *
                  SAMPLE_CLICK_SPEND_RATIO *
                  (1 + SAMPLE_CLICK_RATIO_DRIFT[index % SAMPLE_CLICK_RATIO_DRIFT.length]),
              ),
            )
          : 0,
      impressions,
      // Reach can never exceed impressions on the same day.
      reach: impressions > 0 ? Math.min(impressions, Math.max(1, Math.round(spend * reachPerDollar * drift))) : 0,
      leads: LEADS_30[index],
      validLeads: VALID_30[index],
      validCpl: safeCpl(spend, VALID_30[index]),
    };
  });
  const daily = monthDaily.slice(30 - days);

  const leads = sum(leadsSeries);
  const validLeads = sum(validSeries);

  const ads: MetaAdPerformance[] = SAMPLE_ADS.map((ad, adIndex) => {
    const creativeImage = SAMPLE_CREATIVES[adIndex % SAMPLE_CREATIVES.length];
    const adSpend = round2(ad.spend * scale);
    const reach = Math.round(ad.reach * scale);
    const adLeads = Math.round(ad.leads * scale);
    const adValid = Math.min(Math.round(ad.validLeads * scale), adLeads);
    const impressions = Math.round(ad.impressions * scale);
    // The ad's own clicks follow its own spend by the ratio the daily series
    // uses, so an ad's cost per click and the account's are the same number.
    // Hand-written counts once drifted 4× from the series and left the demo's
    // click-through rate card disagreeing with its own click-through chart.
    const clicks = Math.round(adSpend * SAMPLE_CLICK_SPEND_RATIO);

    return {
      adId: ad.adId,
      adName: ad.adName,
      campaignId: `c-${ad.suburb.toLowerCase()}`,
      campaignName: `Suburb Appraisal - ${ad.suburb}`,
      adsetId: `as-${ad.suburb.toLowerCase()}`,
      adsetName: `Suburb - ${ad.suburb}`,
      suburb: ad.suburb,
      status: ad.status,
      landingPageUrl: null,
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
        reach,
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
      management: {
        managedByBlockwise: adIndex !== SAMPLE_ADS.length - 1,
        adsetDailyBudgetDollars: adIndex === SAMPLE_ADS.length - 1 ? null : 35 + adIndex * 5,
      },
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
      reach: sum(ads.map((ad) => ad.metrics.reach)),
      spend,
      impressions: sum(ads.map((ad) => ad.metrics.impressions)),
      clicks: sum(ads.map((ad) => ad.metrics.clicks)),
      leads,
      validLeads,
      previousPeriod: previousPeriodFor(monthDaily, days, {
        reach: sum(ads.map((ad) => ad.metrics.reach)),
        impressions: sum(ads.map((ad) => ad.metrics.impressions)),
        clicks: sum(ads.map((ad) => ad.metrics.clicks)),
        spend,
        leads,
        validLeads,
      }),
    },
    daily,
    suburbPerformance,
    ads,
  };
}

/**
 * What the window is compared against. The demo's own earlier days answer that
 * whenever the month holds a full window before the one on screen, which is what
 * keeps a week shown on two surfaces reporting one direction. Only a window
 * wider than half the month has no earlier days left to use, and there the demo
 * falls back to the ratios its fixture notes describe.
 */
function previousPeriodFor(
  monthDaily: MetaDailyPoint[],
  days: number,
  current: {
    reach: number;
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    validLeads: number;
  },
): NonNullable<MetaMonitorPayload["summary"]>["previousPeriod"] {
  if (days * 2 <= monthDaily.length) {
    const prior = monthDaily.slice(monthDaily.length - days * 2, monthDaily.length - days);
    const priorSpend = round2(sum(prior.map((point) => point.spend)));
    const priorLeads = sum(prior.map((point) => point.leads));
    const priorValidLeads = sum(prior.map((point) => point.validLeads));

    return {
      reach: sum(prior.map((point) => point.reach)),
      impressions: sum(prior.map((point) => point.impressions)),
      clicks: sum(prior.map((point) => point.clicks)),
      spend: priorSpend,
      leads: priorLeads,
      validLeads: priorValidLeads,
      validLeadRate: safeRate(priorValidLeads, priorLeads),
      validCpl: safeCpl(priorSpend, priorValidLeads),
    };
  }

  return {
    reach: Math.round(current.reach / 1.14),
    impressions: Math.round(current.impressions / 1.11),
    clicks: Math.round(current.clicks / 1.08),
    spend: round2(current.spend / 1.124),
    leads: Math.round(current.leads / 1.183),
    validLeads: Math.round(current.validLeads / 1.082),
    validLeadRate: safeRate(Math.round(current.validLeads / 1.082), Math.round(current.leads / 1.183)),
    validCpl: safeCpl(round2(current.spend / 1.124), Math.round(current.validLeads / 1.082)),
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
