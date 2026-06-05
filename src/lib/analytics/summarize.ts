export type PageViewEvent = {
  occurred_at: string;
  path: string;
  referrer: string | null;
  visitor_hash: string;
  device: string | null;
  country: string | null;
};

export type AnalyticsSummary = {
  totals: {
    pageViews: number;
    visitors: number;
    sessions: number;
    bounceRate: number;
    viewsPerSession: number;
  };
  daily: Array<{ date: string; pageViews: number; visitors: number }>;
  topPages: Array<{ path: string; views: number; visitors: number }>;
  referrers: Array<{ host: string; views: number }>;
  devices: Array<{ device: string; views: number; share: number }>;
  countries: Array<{ country: string; views: number }>;
};

const SESSION_GAP_MS = 30 * 60 * 1000;
const TOP_LIMIT = 10;

/** Aggregates raw page-view rows into the operator dashboard summary. Pure and deterministic. */
export function summarizePageViews(rows: PageViewEvent[], days: number, now: Date = new Date()): AnalyticsSummary {
  const dayKeys: string[] = [];
  const dayMs = 86_400_000;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i -= 1) {
    dayKeys.push(new Date(todayUtc - i * dayMs).toISOString().slice(0, 10));
  }

  const dailyViews = new Map<string, number>();
  const dailyVisitors = new Map<string, Set<string>>();
  const pageViewsByPath = new Map<string, { views: number; visitors: Set<string> }>();
  const referrerViews = new Map<string, number>();
  const deviceViews = new Map<string, number>();
  const countryViews = new Map<string, number>();
  const visitors = new Set<string>();
  const timesByVisitor = new Map<string, number[]>();

  for (const row of rows) {
    const time = Date.parse(row.occurred_at);
    if (Number.isNaN(time)) continue;
    const day = new Date(time).toISOString().slice(0, 10);

    dailyViews.set(day, (dailyViews.get(day) ?? 0) + 1);
    let dayVisitors = dailyVisitors.get(day);
    if (!dayVisitors) {
      dayVisitors = new Set();
      dailyVisitors.set(day, dayVisitors);
    }
    dayVisitors.add(row.visitor_hash);

    let page = pageViewsByPath.get(row.path);
    if (!page) {
      page = { views: 0, visitors: new Set() };
      pageViewsByPath.set(row.path, page);
    }
    page.views += 1;
    page.visitors.add(row.visitor_hash);

    if (row.referrer) referrerViews.set(row.referrer, (referrerViews.get(row.referrer) ?? 0) + 1);
    const device = row.device ?? "unknown";
    deviceViews.set(device, (deviceViews.get(device) ?? 0) + 1);
    if (row.country) countryViews.set(row.country, (countryViews.get(row.country) ?? 0) + 1);

    visitors.add(row.visitor_hash);
    const times = timesByVisitor.get(row.visitor_hash);
    if (times) {
      times.push(time);
    } else {
      timesByVisitor.set(row.visitor_hash, [time]);
    }
  }

  let sessions = 0;
  let bouncedSessions = 0;
  for (const times of timesByVisitor.values()) {
    times.sort((a, b) => a - b);
    let sessionViews = 0;
    let previous: number | null = null;
    for (const time of times) {
      if (previous === null || time - previous > SESSION_GAP_MS) {
        if (sessionViews === 1) bouncedSessions += 1;
        sessions += 1;
        sessionViews = 0;
      }
      sessionViews += 1;
      previous = time;
    }
    if (sessionViews === 1) bouncedSessions += 1;
  }

  const pageViews = rows.length;
  const totals = {
    pageViews,
    visitors: visitors.size,
    sessions,
    bounceRate: sessions === 0 ? 0 : bouncedSessions / sessions,
    viewsPerSession: sessions === 0 ? 0 : pageViews / sessions,
  };

  return {
    totals,
    daily: dayKeys.map((date) => ({
      date,
      pageViews: dailyViews.get(date) ?? 0,
      visitors: dailyVisitors.get(date)?.size ?? 0,
    })),
    topPages: [...pageViewsByPath.entries()]
      .map(([path, value]) => ({ path, views: value.views, visitors: value.visitors.size }))
      .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
      .slice(0, TOP_LIMIT),
    referrers: [...referrerViews.entries()]
      .map(([host, views]) => ({ host, views }))
      .sort((a, b) => b.views - a.views || a.host.localeCompare(b.host))
      .slice(0, TOP_LIMIT),
    devices: [...deviceViews.entries()]
      .map(([device, views]) => ({ device, views, share: pageViews === 0 ? 0 : views / pageViews }))
      .sort((a, b) => b.views - a.views || a.device.localeCompare(b.device)),
    countries: [...countryViews.entries()]
      .map(([country, views]) => ({ country, views }))
      .sort((a, b) => b.views - a.views || a.country.localeCompare(b.country))
      .slice(0, TOP_LIMIT),
  };
}
