import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { AuditCharts } from "@/components/research/audit-charts";
import { AuditPdfButton } from "@/components/research/audit-pdf-button";
import { AuditSuggestionsPanel } from "@/components/research/audit-suggestions";
import { buildAdAudit, type AdAuditResult } from "@/lib/research/ad-audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import "../audit.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Local Ad Market Audit",
  description:
    "A free, data-backed audit of the real estate Meta ads running in your suburb and surrounding area: key stats, longest-running campaigns, and AI marketing recommendations.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const numberFormat = new Intl.NumberFormat("en-AU");

export default async function AuditPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
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
          <div className="audit-topbar-actions">
            <Link href="/#radar" className="audit-topbar-link">Run another audit</Link>
            <Link href="/signup?source=audit" className="lp-btn lp-btn-primary lp-btn-sm">Start free trial</Link>
          </div>
        </div>
      </header>

      {failed || !audit ? (
        <ErrorState location={location} />
      ) : audit.stats.totals.detected === 0 ? (
        <EmptyState audit={audit} />
      ) : (
        <Report audit={audit} />
      )}
    </div>
  );
}

function Report({ audit }: { audit: AdAuditResult }) {
  const { stats, location } = audit;
  const generatedDate = formatDate(audit.generatedAt);
  const reportId = buildReportId(location.label, audit.generatedAt);
  const activePct = Math.round(stats.totals.activeRate * 100);
  const topAdvertiser = stats.topAdvertisers[0];

  return (
    <main className="audit-shell audit-main">
      <section className="audit-letterhead">
        <div className="audit-letterhead-copy">
          <p className="audit-kicker"><span className="audit-kicker-dot" aria-hidden />Local Ad Market Audit</p>
          <h1>{location.label} &mdash; Real Estate Ad Audit</h1>
          <p className="audit-lead">
            A live scan of the Meta (Facebook &amp; Instagram) ads running across {location.label} and surrounding
            suburbs, sourced from the public Meta Ad Library.
          </p>
          <dl className="audit-meta">
            <div><dt>Prepared</dt><dd>{generatedDate}</dd></div>
            <div><dt>Coverage</dt><dd>{location.label} + surrounds</dd></div>
            <div><dt>Source</dt><dd>Meta Ad Library (live)</dd></div>
            <div><dt>Report ID</dt><dd>{reportId}</dd></div>
          </dl>
        </div>
        <div className="audit-letterhead-actions">
          <AuditPdfButton location={location.label} />
          <span className="audit-letterhead-note">Free &middot; branded PDF</span>
        </div>
      </section>

      <section className="audit-stats" aria-label="Key statistics">
        <StatCard value={numberFormat.format(stats.totals.detected)} label="Ads detected" hint="In your area + surrounds" />
        <StatCard value={numberFormat.format(stats.totals.active)} label="Active right now" hint={`${activePct}% of detected ads`} accent />
        <StatCard value={numberFormat.format(stats.advertiserCount)} label="Agencies advertising" hint="Distinct advertisers" />
        <StatCard value={numberFormat.format(stats.longestRunningDays)} label="Longest run (days)" hint="Top continuously-running ad" />
        <StatCard value={numberFormat.format(stats.newLast30Days)} label="New in 30 days" hint="Fresh creative launched" />
      </section>

      <p className="audit-snapshot">
        <strong>Snapshot:</strong> We detected {numberFormat.format(stats.totals.detected)} property ads across{" "}
        {location.label}, {numberFormat.format(stats.totals.active)} still live ({activePct}%), from{" "}
        {numberFormat.format(stats.advertiserCount)} advertiser{stats.advertiserCount === 1 ? "" : "s"}.
        {topAdvertiser ? ` ${topAdvertiser.name} is the most active with ${numberFormat.format(topAdvertiser.ads)} ads detected.` : ""}
        {stats.capped ? " Figures are based on the most recently active ads in a high-volume market." : ""}
      </p>

      <Section title="Market activity" subtitle="The shape of advertising in your area at a glance.">
        <AuditCharts
          active={stats.totals.active}
          inactive={stats.totals.inactive}
          activeRate={stats.totals.activeRate}
          advertisers={stats.topAdvertisers.slice(0, 6).map((a) => ({ name: a.name, ads: a.ads }))}
          launches={stats.launchesByMonth.map((b) => ({ label: b.label, count: b.count }))}
        />
      </Section>

      <Section title="What is working: longest-running ads" subtitle="Ads that run for months are almost always converting. These are the campaigns proven in your market.">
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr><th>#</th><th>Advertiser</th><th>Ad</th><th>Angle</th><th className="audit-num">Running</th><th>Status</th></tr>
            </thead>
            <tbody>
              {stats.longestRunning.map((ad, index) => (
                <tr key={ad.id}>
                  <td className="audit-rank">{index + 1}</td>
                  <td className="audit-strong">{ad.pageName}</td>
                  <td className="audit-ad-copy">{ad.headline ?? ad.body ?? ad.cta ?? "Creative ad"}</td>
                  <td>{ad.adType ?? "-"}</td>
                  <td className="audit-num">{numberFormat.format(ad.daysRunning)} days</td>
                  <td><StatusPill status={ad.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Who is advertising most" subtitle="The agencies investing most consistently in Meta ads locally.">
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr><th>#</th><th>Agency</th><th className="audit-num">Ads detected</th><th className="audit-num">Active</th><th className="audit-num">Longest run</th></tr>
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
      </Section>

      <Section title="How the market advertises" subtitle="Formats, platforms and messaging your competitors lean on.">
        <div className="audit-breakdown">
          <BreakdownBars title="Formats" items={stats.formats} />
          <BreakdownBars title="Platforms" items={stats.platforms} />
          <BreakdownChips title="Most-used calls to action" items={stats.topCtas} />
          <BreakdownChips title="Common angles and hooks" items={mergeAngles(stats.adTypes, stats.commonHooks)} />
        </div>
      </Section>

      <section className="audit-section audit-ai-section">
        <div className="audit-section-head">
          <h2>Marketing recommendations</h2>
          <p>AI strategy built from the live data above: what to copy, where the gaps are, and what to launch.</p>
        </div>
        <AuditSuggestionsPanel location={location.label} />
      </section>

      <CtaBand location={location.label} />
      <Methodology />
    </main>
  );
}

function EmptyState({ audit }: { audit: AdAuditResult }) {
  return (
    <main className="audit-shell audit-main">
      <section className="audit-letterhead">
        <div className="audit-letterhead-copy">
          <p className="audit-kicker"><span className="audit-kicker-dot" aria-hidden />Local Ad Market Audit</p>
          <h1>{audit.location.label} &mdash; Real Estate Ad Audit</h1>
          <p className="audit-lead">
            We did not find active Meta ads for this exact area yet &mdash; our coverage is still expanding here.
            That is also an opening: very few competitors are advertising in this pocket right now.
          </p>
          <dl className="audit-meta">
            <div><dt>Prepared</dt><dd>{formatDate(audit.generatedAt)}</dd></div>
            <div><dt>Coverage</dt><dd>{audit.location.label} + surrounds</dd></div>
            <div><dt>Source</dt><dd>Meta Ad Library (live)</dd></div>
          </dl>
        </div>
      </section>
      <section className="audit-section audit-ai-section">
        <div className="audit-section-head">
          <h2>Marketing recommendations</h2>
          <p>Where to start when the local feed is wide open.</p>
        </div>
        <AuditSuggestionsPanel location={audit.location.label} />
      </section>
      <CtaBand location={audit.location.label} />
      <Methodology />
    </main>
  );
}

function ErrorState({ location }: { location: string }) {
  return (
    <main className="audit-shell audit-main">
      <section className="audit-section audit-error">
        <h1>We could not build your audit</h1>
        <p>The live ad scan is temporarily unavailable. Please try again in a moment.</p>
        <Link href={`/audit?location=${encodeURIComponent(location)}`} className="lp-btn lp-btn-primary">Retry audit</Link>
      </section>
    </main>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="audit-section">
      <div className="audit-section-head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function StatCard({ value, label, hint, accent }: { value: string; label: string; hint: string; accent?: boolean }) {
  return (
    <div className={accent ? "audit-stat audit-stat-accent" : "audit-stat"}>
      <strong>{value}</strong>
      <span className="audit-stat-label">{label}</span>
      <span className="audit-stat-hint">{hint}</span>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "inactive" | "unknown" }) {
  const label = status === "active" ? "Active" : status === "inactive" ? "Inactive" : "Unknown";
  return <span className={`audit-pill audit-pill-${status}`}>{label}</span>;
}

function BreakdownBars({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  const top = items.slice(0, 5);
  const max = top.reduce((value, item) => Math.max(value, item.count), 0) || 1;
  return (
    <div className="audit-breakdown-card">
      <h3>{title}</h3>
      {top.length > 0 ? (
        <ul className="audit-bars">
          {top.map((item) => (
            <li key={item.label}>
              <span className="audit-bar-label">{item.label}</span>
              <span className="audit-bar-track"><span className="audit-bar-fill" style={{ width: `${Math.round((item.count / max) * 100)}%` }} /></span>
              <span className="audit-bar-count">{numberFormat.format(item.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="audit-breakdown-empty">No data.</p>
      )}
    </div>
  );
}

function BreakdownChips({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  const top = items.slice(0, 8);
  return (
    <div className="audit-breakdown-card">
      <h3>{title}</h3>
      {top.length > 0 ? (
        <div className="audit-chips">
          {top.map((item) => (
            <span className="audit-chip" key={item.label}>{item.label}<i>{numberFormat.format(item.count)}</i></span>
          ))}
        </div>
      ) : (
        <p className="audit-breakdown-empty">No data.</p>
      )}
    </div>
  );
}

function CtaBand({ location }: { location: string }) {
  const href = `/signup?source=audit&market=${encodeURIComponent(location)}`;
  return (
    <section className="audit-cta">
      <div>
        <h2>Turn this audit into campaigns that run.</h2>
        <p>Blockwise builds the ads, lead forms and approvals for {location} from the angles already working here.</p>
      </div>
      <div className="audit-cta-actions">
        <Link href={href} className="lp-btn lp-btn-light lp-btn-big">Start free trial</Link>
        <AuditPdfButton location={location} className="lp-btn lp-btn-ghost-light" label="Download this report" />
      </div>
    </section>
  );
}

function Methodology() {
  return (
    <footer className="audit-methodology">
      <h3>Methodology and notes</h3>
      <p>
        Data is sourced from the public Meta Ad Library at the time of the scan and covers ads detected for the
        searched suburb plus surrounding suburbs and postcodes. Longest-running is measured from each ad delivery
        start date and is used as a proxy for performance: advertisers rarely keep ads live for months unless they
        convert. Figures reflect ads detected at scan time and may not capture every advertiser.
      </p>
      <p className="audit-disclaimer">
        Blockwise is an independent tool and is not affiliated with or endorsed by Meta Platforms, Inc. Advertiser and
        agency names are shown for competitive research only. Copyright {new Date().getFullYear()} Blockwise.
      </p>
    </footer>
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

function mergeAngles(
  adTypes: Array<{ label: string; count: number }>,
  hooks: Array<{ label: string; count: number }>,
): Array<{ label: string; count: number }> {
  const map = new Map<string, { label: string; count: number }>();
  for (const item of [...adTypes, ...hooks]) {
    const key = item.label.toLowerCase();
    const entry = map.get(key) ?? { label: item.label, count: 0 };
    entry.count += item.count;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
