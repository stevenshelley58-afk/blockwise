import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { AuditCtaButton, AuditViewTracker } from "@/components/research/audit-conversion";
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
    "See the real estate Meta ads running in your suburb, what is working, and the exact campaign to run next.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const numberFormat = new Intl.NumberFormat("en-AU");

function signupHref(market: string): string {
  return `/signup?source=audit&market=${encodeURIComponent(market)}`;
}

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
          <AuditCtaButton href={signupHref(location)} market={location} className="lp-btn lp-btn-primary lp-btn-sm">
            Start free trial
          </AuditCtaButton>
        </div>
      </header>

      {failed || !audit ? (
        <ErrorState location={location} />
      ) : audit.stats.totals.detected === 0 ? (
        <EmptyState audit={audit} />
      ) : (
        <Report audit={audit} />
      )}

      {audit ? <AuditViewTracker market={audit.location.label} /> : null}
    </div>
  );
}

function Report({ audit }: { audit: AdAuditResult }) {
  const { stats, location } = audit;
  const href = signupHref(location.label);
  const top = stats.topAdvertisers[0];
  const wins = stats.longestRunning.slice(0, 3);
  const angles = stats.adTypes.slice(0, 4);

  const sting = top
    ? `${top.name} is running ${numberFormat.format(top.ads)} ads in your area${stats.longestRunningDays > 0 ? `, and the top one has been live ${numberFormat.format(stats.longestRunningDays)} days` : ""}. Long-running ads are the offers winning your sellers - here is what is working, and how to run it yourself.`
    : `${numberFormat.format(stats.totals.detected)} property ads are running across ${location.label}. Here is what is working, and how to run it yourself.`;

  return (
    <main className="audit-shell audit-main">
      <section className="audit-hero">
        <p className="audit-kicker"><span className="audit-kicker-dot" aria-hidden />Local Ad Market Audit &middot; {location.label}</p>
        <h1>Here is who is winning the ads in {location.label}.</h1>
        <p className="audit-hero-sting">{sting}</p>
        <div className="audit-hero-cta">
          <AuditCtaButton href={href} market={location.label} className="lp-btn lp-btn-primary lp-btn-big">
            Build my campaign &mdash; start free
          </AuditCtaButton>
          <span className="audit-hero-note">7-day trial &middot; no card required</span>
        </div>
      </section>

      <section className="audit-stats audit-stats-3" aria-label="Key statistics">
        <StatCard value={numberFormat.format(stats.totals.active)} label="Ads running now" hint="In your suburb + surrounds" accent />
        <StatCard value={numberFormat.format(stats.advertiserCount)} label="Agencies competing" hint="Advertising against you" />
        <StatCard value={numberFormat.format(stats.longestRunningDays)} label="Longest-running ad" hint="Days live = it converts" />
      </section>

      {wins.length > 0 ? (
        <section className="audit-section">
          <div className="audit-section-head">
            <h2>What is working in {location.label}</h2>
            <p>The ads that have run longest &mdash; almost always the ones converting.</p>
          </div>
          <div className="audit-wins">
            {wins.map((ad, index) => (
              <article className="audit-win" key={ad.id}>
                <span className="audit-win-rank">{index + 1}</span>
                <div className="audit-win-body">
                  <strong>{ad.pageName}</strong>
                  <p>{ad.headline ?? ad.body ?? ad.cta ?? "Creative ad"}</p>
                  <div className="audit-win-meta">
                    <span className="audit-win-days">{numberFormat.format(ad.daysRunning)} days live</span>
                    {ad.adType ? <span className="audit-chip">{ad.adType}</span> : null}
                    <StatusPill status={ad.status} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {angles.length > 0 ? (
        <section className="audit-section">
          <div className="audit-section-head">
            <h2>The offers getting traction</h2>
            <p>Angles your competitors run most &mdash; your fastest path to leads.</p>
          </div>
          <AngleBars items={angles} />
        </section>
      ) : null}

      <section className="audit-section audit-ai-section">
        <div className="audit-section-head">
          <h2>Your plan: what to run next</h2>
          <p>Built from the live data above.</p>
        </div>
        <AuditSuggestionsPanel location={location.label} />
      </section>

      <section className="audit-cta">
        <div>
          <h2>Blockwise builds these ads for {location.label}.</h2>
          <p>Pick an angle, we draft the ad, lead form and targeting. You approve, then launch from your own ad account.</p>
        </div>
        <div className="audit-cta-actions">
          <AuditCtaButton href={href} market={location.label} className="lp-btn lp-btn-light lp-btn-big">Start free trial</AuditCtaButton>
          <AuditPdfButton location={location.label} className="lp-btn lp-btn-ghost-light" label="Save as PDF" />
        </div>
      </section>

      <Methodology />
    </main>
  );
}

function EmptyState({ audit }: { audit: AdAuditResult }) {
  const href = signupHref(audit.location.label);
  return (
    <main className="audit-shell audit-main">
      <section className="audit-hero">
        <p className="audit-kicker"><span className="audit-kicker-dot" aria-hidden />Local Ad Market Audit &middot; {audit.location.label}</p>
        <h1>Almost no one is advertising in {audit.location.label}.</h1>
        <p className="audit-hero-sting">
          We did not find active Meta ads for this exact pocket yet. That is the opening: be the first agent
          owning the local feed and capture sellers before your competitors show up.
        </p>
        <div className="audit-hero-cta">
          <AuditCtaButton href={href} market={audit.location.label} className="lp-btn lp-btn-primary lp-btn-big">
            Claim your suburb &mdash; start free
          </AuditCtaButton>
          <span className="audit-hero-note">7-day trial &middot; no card required</span>
        </div>
      </section>
      <section className="audit-section audit-ai-section">
        <div className="audit-section-head">
          <h2>Your plan: where to start</h2>
          <p>The angles that win when the local feed is wide open.</p>
        </div>
        <AuditSuggestionsPanel location={audit.location.label} />
      </section>
      <section className="audit-cta">
        <div>
          <h2>Get in first in {audit.location.label}.</h2>
          <p>Blockwise drafts your first appraisal or just-listed ad in minutes. You approve and launch.</p>
        </div>
        <div className="audit-cta-actions">
          <AuditCtaButton href={href} market={audit.location.label} className="lp-btn lp-btn-light lp-btn-big">Start free trial</AuditCtaButton>
        </div>
      </section>
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

function AngleBars({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = items.reduce((value, item) => Math.max(value, item.count), 0) || 1;
  return (
    <div className="audit-breakdown-card">
      <ul className="audit-bars">
        {items.map((item) => (
          <li key={item.label}>
            <span className="audit-bar-label">{item.label}</span>
            <span className="audit-bar-track"><span className="audit-bar-fill" style={{ width: `${Math.round((item.count / max) * 100)}%` }} /></span>
            <span className="audit-bar-count">{numberFormat.format(item.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Methodology() {
  return (
    <footer className="audit-methodology">
      <p>
        Data from the public Meta Ad Library at scan time, covering the searched suburb plus surrounding suburbs and
        postcodes. Longest-running is a proxy for performance. Blockwise is independent and not affiliated with Meta
        Platforms, Inc.; advertiser names are shown for competitive research only.
      </p>
    </footer>
  );
}

function pickParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}
