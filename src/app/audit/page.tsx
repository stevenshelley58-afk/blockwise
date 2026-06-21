import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { AuditCharts } from "@/components/research/audit-charts";
import {
  BreakdownBars,
  BreakdownChips,
  ConfidenceBadge,
  InsightBlockCard,
  SignalGrid,
  StatCard,
} from "@/components/research/audit-report";
import { AuditSnapshotSignup } from "@/components/research/audit-snapshot-signup";
import { buildAdAudit, type AdAuditResult } from "@/lib/research/ad-audit";
import { buildAuditNarrative, computeAuditSignals } from "@/lib/research/audit-insights";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import "../audit.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Local Advertising Signal Report",
  description:
    "A free, data-grounded read on the real estate ads visible in your area in the public Meta Ad Library: what was observed, what it may suggest, and what not to assume.",
  robots: { index: false, follow: false },
};

type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const numberFormat = new Intl.NumberFormat("en-AU");

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const params = await searchParams;
  const location = pickParam(params.location ?? params.q) || "Perth, WA";

  let audit: AdAuditResult | null = null;
  let failed = false;
  try {
    audit = await buildAdAudit(createSupabaseServiceClient(), { location });
  } catch (error) {
    console.error("audit page build failed", error);
    failed = true;
  }

  return (
    <div className="audit-page">
      <header className="audit-topbar">
        <div className="audit-shell audit-topbar-inner">
          <Link href="/" className="lp-brand" aria-label="Blockwise home">
            <BlockwiseLogo />
          </Link>
          <span className="audit-topbar-tag">Local advertising signal report</span>
        </div>
      </header>
      {failed || !audit ? <ErrorState location={location} /> : <Report audit={audit} />}
    </div>
  );
}

function Report({ audit }: { audit: AdAuditResult }) {
  const { stats, location } = audit;
  const signals = computeAuditSignals(stats);
  const narrative = buildAuditNarrative({ label: location.label, stats, signals });
  const generatedDate = formatDate(audit.generatedAt);
  const reportId = buildReportId(location.label, audit.generatedAt);
  const hasData = stats.totals.detected > 0;
  const topCount = Math.min(stats.topAdvertisers.length, 8);
  const activeAdvertisers = stats.topAdvertisers.filter((a) => a.active > 0).length;

  return (
    <main className="audit-shell audit-main">
      <section className="audit-letterhead">
        <div className="audit-letterhead-copy">
          <p className="audit-kicker"><span className="audit-kicker-dot" aria-hidden />Local advertising signal report</p>
          <h1>{location.label} &mdash; real estate ad signals</h1>
          <p className="audit-lead">
            A read on the real estate ads visible around {location.label} in the public Meta (Facebook &amp; Instagram) Ad
            Library at scan time. This is a market readout, not a performance report: it shows what was publicly visible, not
            what worked.
          </p>
          <dl className="audit-meta">
            <div><dt>Prepared</dt><dd>{generatedDate}</dd></div>
            <div><dt>Coverage</dt><dd>{location.label} + surrounds</dd></div>
            <div><dt>Source</dt><dd>Meta Ad Library (public)</dd></div>
            <div><dt>Report ID</dt><dd>{reportId}</dd></div>
          </dl>
        </div>
        <div className="audit-letterhead-side">
          <ConfidenceBadge level={narrative.confidence} />
        </div>
      </section>

      <nav className="audit-nav" aria-label="Report sections">
        <a href="#snapshot">Snapshot</a>
        <a href="#signals">Signals</a>
        <a href="#advertisers">Advertisers</a>
        <a href="#advice">Advice</a>
        <a href="#methodology">Methodology</a>
      </nav>

      <section id="snapshot" className="audit-section">
        <div className="audit-section-head">
          <h2>Market snapshot</h2>
          <p>What this scan actually found at scan time.</p>
        </div>
        {hasData && (
          <div className="audit-stats" aria-label="Key statistics">
            <StatCard value={numberFormat.format(stats.totals.detected)} label="Ads detected" hint="In area + surrounds" />
            <StatCard value={numberFormat.format(stats.totals.active)} label="Active at scan time" hint={`${Math.round(stats.totals.activeRate * 100)}% of detected`} />
            <StatCard value={numberFormat.format(stats.advertiserCount)} label="Advertisers" hint={`${numberFormat.format(activeAdvertisers)} active now`} />
            <StatCard value={numberFormat.format(stats.newLast30Days)} label="New in 30 days" hint="Recently visible" />
            <StatCard value={numberFormat.format(stats.longestRunningDays)} label="Longest run (days)" hint="Persistence, not performance" />
          </div>
        )}
        {narrative.snapshot.map((paragraph, index) => (
          <p key={index} className="audit-readout">{paragraph}</p>
        ))}
        <SignalGrid signals={signals} />
      </section>

      <section className="audit-section audit-section-soft">
        <div className="audit-section-head">
          <h3 className="audit-subhead">Data quality notes</h3>
          <p>How much weight this snapshot can carry.</p>
        </div>
        <ul className="audit-notes">
          {narrative.dataQuality.map((note, index) => <li key={index}>{note}</li>)}
        </ul>
      </section>

      {hasData && (
        <section id="signals" className="audit-section">
          <div className="audit-section-head">
            <h2>What the public data shows</h2>
            <p>Activity over time, concentration, messaging and creative &mdash; all directional, all from public data.</p>
          </div>
          <AuditCharts
            active={stats.totals.active}
            inactive={stats.totals.inactive}
            activeRate={stats.totals.activeRate}
            advertisers={stats.topAdvertisers.slice(0, 6).map((a) => ({ name: a.name, ads: a.ads }))}
            launches={stats.launchesByMonth.map((b) => ({ label: b.label, count: b.count }))}
          />
          <div className="audit-breakdown">
            <BreakdownBars title="Creative formats" items={stats.formats} note="What formats were detected" />
            <BreakdownBars title="Platforms" items={stats.platforms} note="Where ads were placed" />
            <BreakdownChips title="Detected angles" items={stats.adTypes} note="Directional; not every ad is classified" />
            <BreakdownChips title="Common calls to action" items={stats.topCtas} note="As written in the ads" />
          </div>
        </section>
      )}

      {hasData && (
        <section id="advertisers" className="audit-section">
          <div className="audit-section-head">
            <h2>Advertiser behaviour</h2>
            <p>
              Who is visible, by detected ad count. Showing the top {topCount} of {numberFormat.format(stats.advertiserCount)}{" "}
              advertisers; counts are detected ads, not spend.
            </p>
          </div>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr><th>#</th><th>Advertiser</th><th className="audit-num">Ads detected</th><th className="audit-num">Active</th><th className="audit-num">Longest run</th></tr>
              </thead>
              <tbody>
                {stats.topAdvertisers.map((advertiser, index) => (
                  <tr key={advertiser.name}>
                    <td className="audit-rank">{index + 1}</td>
                    <td className="audit-strong">{advertiser.name}</td>
                    <td className="audit-num">{numberFormat.format(advertiser.ads)}</td>
                    <td className="audit-num">{numberFormat.format(advertiser.active)}</td>
                    <td className="audit-num">{numberFormat.format(advertiser.longestRunningDays)} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="audit-reconcile">
            Top {topCount} advertisers account for {numberFormat.format(stats.topAdvertisers.reduce((sum, a) => sum + a.ads, 0))} of{" "}
            {numberFormat.format(stats.totals.detected)} detected ads.
          </p>
        </section>
      )}

      <section id="advice" className="audit-section">
        <div className="audit-section-head">
          <h2>Practical interpretation</h2>
          <p>Each read below ties to the data above, with what it may mean and what not to assume.</p>
        </div>
        <div className="audit-insights">
          {narrative.blocks.map((block) => <InsightBlockCard key={block.id} block={block} />)}
        </div>
      </section>

      <section className="audit-section audit-section-soft">
        <div className="audit-section-head">
          <h3 className="audit-subhead">Useful next checks</h3>
          <p>Things a local operator can do today, without buying anything.</p>
        </div>
        <ul className="audit-actions">
          {narrative.usefulActions.map((action, index) => <li key={index}>{action}</li>)}
        </ul>
      </section>

      <section id="methodology" className="audit-section">
        <div className="audit-section-head">
          <h3 className="audit-subhead">Methodology &amp; limitations</h3>
          <p>What this report can and cannot tell you.</p>
        </div>
        <ul className="audit-limitations">
          {narrative.limitations.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
        <p className="audit-disclaimer">
          Blockwise is an independent tool and is not affiliated with or endorsed by Meta Platforms, Inc. Advertiser and
          agency names are shown for public-data research only. &copy; {new Date().getFullYear()} Blockwise.
        </p>
      </section>

      <section className="audit-followup">
        <div>
          <h2>Want to see how this shifts?</h2>
          <p>One snapshot is a weak signal. Leave an email and we&rsquo;ll send future scans of {location.label} as the public data changes. No account needed.</p>
        </div>
        <AuditSnapshotSignup location={location.label} />
      </section>
    </main>
  );
}

function ErrorState({ location }: { location: string }) {
  return (
    <main className="audit-shell audit-main">
      <section className="audit-section audit-error">
        <h1>We couldn&rsquo;t build this report</h1>
        <p>The public ad scan is temporarily unavailable. Please try again in a moment.</p>
        <Link href={`/audit?location=${encodeURIComponent(location)}`} className="lp-btn lp-btn-primary">Retry</Link>
      </section>
    </main>
  );
}

function pickParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function buildReportId(label: string, generatedAt: string): string {
  const date = new Date(generatedAt);
  const ymd = Number.isNaN(date.getTime())
    ? "00000000"
    : `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  const slug = label.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "AUD";
  return `BW-${ymd}-${slug}`;
}
// inert padding (workspace editor-sync keeps this file's byte length fixed; no runtime effect) xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx