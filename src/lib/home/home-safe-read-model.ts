import type { HomeData } from "@/components/self-serve/home-dashboard";
import type { MetaDailyPoint, MetaMonitorPayload } from "@/lib/meta-monitor/types";

/**
 * Client-safe half of the home dashboard read model.
 *
 * These helpers are the contract between the server payload and the browser
 * cache in `components/self-serve/home-dashboard-read-model.tsx`. They live in
 * their own module because the loader beside them
 * (`lib/home/home-dashboard-data.ts`) reaches `node:crypto` through the
 * reporting snapshot layer. A client component that value-imported from that
 * file dragged Buffer/stream/crypto polyfills into the browser bundle: the
 * /self-serve route shipped ~450 KB of Node shims for two pure functions.
 *
 * Everything here is a pure transform over already-fetched data. It must never
 * gain a value import of a server-only module, or the polyfill graph returns.
 */

export type HomeSafeReadModel = Pick<
  HomeData,
  | "workspaceName"
  | "hasBrand"
  | "hasProvider"
  | "activation"
  | "meta"
  | "booking"
  | "ads"
  | "performance"
  | "creativeSuggestions"
  | "leads"
  | "perthAds"
>;

export function mergeHomeSafeReadModel(
  current: HomeData,
  safe: HomeSafeReadModel,
): HomeData {
  return { ...current, ...safe };
}

export function homeSafeReadModelFromData(data: HomeData): HomeSafeReadModel {
  return {
    workspaceName: data.workspaceName,
    hasBrand: data.hasBrand,
    hasProvider: data.hasProvider,
    activation: data.activation,
    meta: data.meta,
    booking: data.booking,
    ads: data.ads,
    performance: data.performance,
    creativeSuggestions: data.creativeSuggestions,
    leads: data.leads,
    perthAds: data.perthAds,
  };
}

/**
 * The trailing seven points of the series, which is the last seven days because
 * the reporting builder emits a contiguous point per day. The home metrics band
 * is explicitly a weekly view, so it must not re-label the snapshot's 30 day
 * totals as a week.
 */
export function trailingWeekTotals(daily: MetaDailyPoint[]): {
  spend: number;
  clicks: number;
} {
  const ordered = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const week = ordered.slice(-7);

  return {
    spend: week.reduce((total, point) => total + point.spend, 0),
    clicks: week.reduce((total, point) => total + point.clicks, 0),
  };
}

export function homeDailyPoints(daily: MetaDailyPoint[]): NonNullable<HomeData["performance"]>["daily"] {
  return daily.map((point) => ({
    date: point.date,
    leads: point.leads,
    spend: point.spend,
    clicks: point.clicks,
  }));
}

export function homePerformanceFromReporting(
  results: MetaMonitorPayload | null,
): { adsLive: number; performance: NonNullable<HomeData["performance"]> } | null {
  const summary = results?.summary;
  if (
    !results ||
    (results.source !== "live" && results.source !== "sample") ||
    !results.connected ||
    !summary ||
    results.range.key !== "last_30" ||
    summary.dateRange.start !== results.range.since ||
    summary.dateRange.end !== results.range.until
  ) {
    return null;
  }

  const providerLeads = results.ads.reduce(
    (total, ad) => total + ad.metrics.leads,
    0,
  );
  const providerSpend = results.ads.reduce(
    (total, ad) => total + ad.metrics.spend,
    0,
  );
  const totalsMatch =
    providerLeads === summary.leads &&
    Math.abs(providerSpend - summary.spend) < 0.01;
  const isSample = results.source === "sample";
  // Sample leads are fixtures, not captures, so they must never be presented as
  // the workspace's own lead count.
  const leads = isSample ? providerLeads : summary.leads;
  const week = trailingWeekTotals(results.daily);

  return {
    adsLive: results.ads.filter((ad) => ad.status === "ACTIVE").length,
    performance: {
      leads,
      cpl: totalsMatch && providerLeads > 0 ? summary.spend / providerLeads : null,
      previousLeads: isSample ? null : summary.previousPeriod?.leads ?? null,
      previousCpl: null,
      daily: homeDailyPoints(results.daily),
      weekly: {
        spend: week.spend,
        clicks: week.clicks,
        cpc: week.clicks > 0 ? week.spend / week.clicks : null,
      },
      isSample,
      lastSyncedAt: summary.lastSyncedAt,
    },
  };
}
