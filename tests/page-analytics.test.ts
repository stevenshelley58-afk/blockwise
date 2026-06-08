import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyDevice, externalReferrerHost, isTrackablePath, normalizeTrackedPath } from "../src/lib/analytics/events.ts";
import { summarizePageViews, type PageViewEvent } from "../src/lib/analytics/summarize.ts";
import { dailyVisitorHash } from "../src/lib/analytics/visitor.ts";

const migration = "supabase/migrations/202606050003_page_analytics.sql";

test("page analytics migration creates a server-owned page_views table", () => {
  const sql = readFileSync(migration, "utf8");

  assert.match(sql, /create table if not exists public\.page_views\b/i);
  assert.match(sql, /alter table public\.page_views enable row level security/i);
  assert.match(sql, /create index if not exists page_views_occurred_at_idx/i);
  assert.match(sql, /create index if not exists page_views_path_idx/i);
  // Server-owned by omission: RLS on, zero policies, so only service role has access.
  assert.doesNotMatch(sql, /create policy/i);
  // Privacy contract: nothing in the schema stores raw IPs or user agents.
  assert.doesNotMatch(sql, /ip_address|user_agent/i);
});

test("isTrackablePath excludes operator, api, and internal asset paths", () => {
  assert.equal(isTrackablePath("/"), true);
  assert.equal(isTrackablePath("/monitor"), true);
  assert.equal(isTrackablePath("/operator"), false);
  assert.equal(isTrackablePath("/operator/analytics"), false);
  assert.equal(isTrackablePath("/approvals"), false);
  assert.equal(isTrackablePath("/model-control"), false);
  assert.equal(isTrackablePath("/api/track"), false);
  assert.equal(isTrackablePath("/_next/static/x.js"), false);
  // Prefix matching must not swallow legitimate marketing paths.
  assert.equal(isTrackablePath("/operators-guide"), true);
});

test("normalizeTrackedPath validates input and preserves only the PWA source marker", () => {
  assert.equal(normalizeTrackedPath("/pricing?utm_source=meta#top"), "/pricing");
  assert.equal(normalizeTrackedPath("/pwa?source=pwa"), "/pwa?source=pwa");
  assert.equal(normalizeTrackedPath("/pwa?source=offline"), "/pwa?source=offline");
  assert.equal(normalizeTrackedPath("/pwa?source=meta"), "/pwa");
  assert.equal(normalizeTrackedPath(" /pricing "), "/pricing");
  assert.equal(normalizeTrackedPath("pricing"), null);
  assert.equal(normalizeTrackedPath("//evil.example"), null);
  assert.equal(normalizeTrackedPath(42), null);
  assert.equal(normalizeTrackedPath(`/${"a".repeat(600)}`), null);
});

test("classifyDevice buckets bots, phones, tablets, and desktops", () => {
  assert.equal(classifyDevice("Mozilla/5.0 (compatible; Googlebot/2.1)"), "bot");
  assert.equal(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(classifyDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/120 Mobile Safari/537.36"), "mobile");
  assert.equal(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1"), "tablet");
  assert.equal(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"), "desktop");
  assert.equal(classifyDevice(""), "unknown");
  assert.equal(classifyDevice(null), "unknown");
});

test("externalReferrerHost keeps external hosts and drops same-site referrers", () => {
  assert.equal(externalReferrerHost("https://www.google.com/search?q=x", "blockwise.sale"), "google.com");
  assert.equal(externalReferrerHost("https://blockwise.sale/pricing", "blockwise.sale"), null);
  assert.equal(externalReferrerHost("https://app.blockwise.sale/x", "blockwise.sale"), null);
  assert.equal(externalReferrerHost("javascript:alert(1)", "blockwise.sale"), null);
  assert.equal(externalReferrerHost("not a url", "blockwise.sale"), null);
  assert.equal(externalReferrerHost(null, "blockwise.sale"), null);
});

test("dailyVisitorHash is salted, day-scoped, and irreversible-shaped", () => {
  const day1 = new Date("2026-06-05T10:00:00Z");
  const sameDay = new Date("2026-06-05T23:00:00Z");
  const day2 = new Date("2026-06-06T01:00:00Z");

  const a = dailyVisitorHash("1.2.3.4", "ua", "salt", day1);
  assert.equal(a, dailyVisitorHash("1.2.3.4", "ua", "salt", sameDay));
  assert.notEqual(a, dailyVisitorHash("1.2.3.4", "ua", "salt", day2));
  assert.notEqual(a, dailyVisitorHash("1.2.3.5", "ua", "salt", day1));
  assert.notEqual(a, dailyVisitorHash("1.2.3.4", "ua", "other-salt", day1));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes("1.2.3.4"));
});

test("summarizePageViews aggregates totals, sessions, and bounce rate", () => {
  const now = new Date("2026-06-05T12:00:00Z");
  const rows: PageViewEvent[] = [
    // Visitor A: two views 5 minutes apart (one session, not bounced)…
    { occurred_at: "2026-06-05T01:00:00Z", path: "/", referrer: "google.com", visitor_hash: "a", device: "desktop", country: "AU" },
    { occurred_at: "2026-06-05T01:05:00Z", path: "/pricing", referrer: null, visitor_hash: "a", device: "desktop", country: "AU" },
    // …then returns 2 hours later for a single-page session (bounced).
    { occurred_at: "2026-06-05T03:30:00Z", path: "/", referrer: null, visitor_hash: "a", device: "desktop", country: "AU" },
    // Visitor B: one view the day before (bounced).
    { occurred_at: "2026-06-04T09:00:00Z", path: "/", referrer: "facebook.com", visitor_hash: "b", device: "mobile", country: "NZ" },
  ];

  const summary = summarizePageViews(rows, 7, now);

  assert.equal(summary.totals.pageViews, 4);
  assert.equal(summary.totals.visitors, 2);
  assert.equal(summary.totals.sessions, 3);
  assert.equal(summary.totals.bounceRate, 2 / 3);
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.daily.at(-1)?.date, "2026-06-05");
  assert.equal(summary.daily.at(-1)?.pageViews, 3);
  assert.equal(summary.daily.at(-2)?.pageViews, 1);
  assert.deepEqual(summary.topPages[0], { path: "/", views: 3, visitors: 2 });
  assert.deepEqual(summary.referrers, [
    { host: "facebook.com", views: 1 },
    { host: "google.com", views: 1 },
  ]);
  assert.equal(summary.devices[0]?.device, "desktop");
  assert.equal(summary.devices[0]?.views, 3);
  assert.deepEqual(summary.countries, [
    { country: "AU", views: 3 },
    { country: "NZ", views: 1 },
  ]);
});

test("summarizePageViews handles an empty range without dividing by zero", () => {
  const summary = summarizePageViews([], 7, new Date("2026-06-05T12:00:00Z"));

  assert.equal(summary.totals.pageViews, 0);
  assert.equal(summary.totals.bounceRate, 0);
  assert.equal(summary.totals.viewsPerSession, 0);
  assert.equal(summary.daily.length, 7);
  assert.deepEqual(summary.topPages, []);
});
