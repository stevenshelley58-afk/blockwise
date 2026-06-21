import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import {
  AuditAnalytics,
  AuditCtaButton,
  InViewTracker,
  MobileCta,
  TrackedAnchor,
  TrackedDetails,
} from "@/components/research/audit-conversion";
import { AuditLeadForm } from "@/components/research/audit-lead-form";
import {
  buildAdAudit,
  type AdAuditResult,
  type AdAuditStats,
  type ExcludedAdvertiser,
} from "@/lib/research/ad-audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import "../audit.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Local Ad Market Audit",
  description:
    "See which real estate advertisers are running ads around your suburb and get a simple campaign plan from Blockwise.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const numberFormat = new Intl.NumberFormat("en-AU");

type AnalyticsData = {
  location: string;
  filtered_ads_detected: number;
  filtered_active_ads: number;
  filtered_advertisers: number;
  top_angle: string;
  top_platform: string;
  top_format: string;
};

type Metrics = {
  detected: number;
  active: number;
  advertisers: number;
  topPlatform: string;
  topFormat: string;
  topAngles: string;
};

type CampaignCard = {
  title: string;
  purpose: string;
  cta: string;
  bullets: string[];
  detected: boolean;
};

const ANGLE_CAMPAIGNS: Record<string, Omit<CampaignCard, "detected">> = {
  "Just Sold": {
    title: "Just Sold Proof",
    purpose: "Build seller confidence with recent local activity.",
    cta: "See recent results",
    bullets: [
      "One result-led image or short video",
      "Primary CTA: See recent results",
      "Broad local audience, no restricted targeting",
    ],
  },
  "Just Listed": {
    title: "Just Listed",
    purpose: "Capture buyer interest and create visible seller proof.",
    cta: "View the property",
    bullets: [
      "One property-led image creative",
      "Primary CTA: View the property",
      "Broad local audience, no restricted targeting",
    ],
  },
  "Free Appraisal": {
    title: "Free Appraisal",
    purpose: "Capture vendor leads from owners considering a sale.",
    cta: "Get my appraisal",
    bullets: [
      "Meta lead form with suburb and property type",
      "Primary CTA: Get my appraisal",
      "Broad local audience, no restricted targeting",
    ],
  },
  "Market Update": {
    title: "Market Update",
    purpose: "Give owners local context before they commit to an appraisal.",
    cta: "Send me the update",
    bullets: [
      "Lead magnet: suburb price and activity snapshot",
      "Primary CTA: Send me the update",
      "Broad local audience, no restricted targeting",
    ],
  },
  "Open Home": {
    title: "Open Home",
    purpose: "Drive local attendance and capture buyer enquiry.",
    cta: "See inspection times",
    bullets: [
      "One property-led image creative",
      "Primary CTA: See inspection times",
      "Broad local audience, no restricted targeting",
    ],
  },
  "Property Management": {
    title: "Property Management",
    purpose: "Win new managements from local landlords.",
    cta: "Request a rental appraisal",
    bullets: [
      "Lead form for local landlords",
      "Primary CTA: Request a rental appraisal",
      "Broad local audience, no restricted targeting",
    ],
  },
};

const DEFAULT_ANGLE_ORDER = ["Just Listed", "Free Appraisal", "Just Sold"];

function signupHref(market: string): string {
  return `/signup?source=audit&market=${encodeURIComponent(market)}`;
}

function shortArea(label: string): string {
  return label.split(",")[0]?.trim() || label;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "today";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function buildCampaignPack(stats: AdAuditStats | null): CampaignCard[] {
  const detectedAngles = (stats?.adTypes ?? [])
    .map((angle) => angle.label)
    .filter((label) => Boolean(ANGLE_CAMPAIGNS[label]));
  const chosen: string[] = [];
  for (const angle of detectedAngles) {
    if (!chosen.includes(angle)) chosen.push(angle);
    if (chosen.length === 3) break;
  }
  for (const angle of DEFAULT_ANGLE_ORDER) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(angle)) chosen.push(angle);
  }
  return chosen.slice(0, 3).map((angle) => ({
    ...ANGLE_CAMPAIGNS[angle],
    detected: detectedAngles.includes(angle),
  }));
}

export default async function AuditPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const location = pickParam(params.location ?? params.q) || "Perth, WA";

  let audit: AdAuditResult | null = null;
  try {
    audit = await buildAdAudit(createSupabaseServiceClient(), { location });
  } catch (error) {
    console.error("audit page build failed", error);
  }

  const label = audit?.location.label ?? location;
  const area = shortArea(label);
  const prepared = audit ? formatDate(audit.generatedAt) : formatDate(new Date().toISOString());
  const stats = audit?.stats ?? null;
  const hasData = Boolean(stats && stats.totals.detected > 0);

  const detected = stats?.totals.detected ?? 0;
  const active = stats?.totals.active ?? 0;
  const advertisers = stats?.advertiserCount ?? 0;
  const topPlatform = stats?.platforms[0]?.label ?? "Facebook";
  const topFormat = stats?.formats[0]?.label ?? "Image";
  const topAngles = (stats?.adTypes ?? []).slice(0, 3).map((angle) => angle.label);
  const topAngle = topAngles[0] ?? "Just Listed";

  const pack = buildCampaignPack(stats);
  const href = signupHref(label);

  const analytics: AnalyticsData = {
    location: label,
    filtered_ads_detected: detected,
    filtered_active_ads: active,
    filtered_advertisers: advertisers,
    top_angle: topAngle,
    top_platform: topPlatform,
    top_format: topFormat,
  };

  return (
    <div className="audit-page">
      <header className="site-header">
        <div className="container nav">
          <Link className="brand" href="/" aria-label="Blockwise home"><BlockwiseLogo /></Link>
          <nav className="nav-links" aria-label="Audit sections">
            <a href="#plan">Campaign plan</a>
            <a href="#evidence">Competitor evidence</a>
            <TrackedAnchor href="#lead" event="primary_cta_clicked" data={{ ...analytics, placement: "nav" }} className="lp-btn lp-btn-primary lp-btn-sm">Build my campaign</TrackedAnchor>
          </nav>
        </div>
      </header>

      <main>
        <Hero area={area} hasData={hasData} detected={detected} active={active} advertisers={advertisers} analytics={analytics} />
        {hasData && stats ? <Stats area={area} stats={stats} /> : null}
        {hasData ? <WhatThisMeans area={area} topPlatform={topPlatform} topFormat={topFormat} topAngles={topAngles} /> : null}
        <InViewTracker event="campaign_pack_viewed" data={analytics}>
          <CampaignPack area={area} pack={pack} />
        </InViewTracker>
        <ExamplePreview area={area} />
        <LeadSection
          area={area}
          label={label}
          href={href}
          analytics={analytics}
          metrics={{ detected, active, advertisers, topPlatform, topFormat, topAngles: topAngles.join(", ") }}
        />
        {hasData && stats ? <Evidence stats={stats} excluded={audit?.excludedAdvertisers ?? []} analytics={analytics} /> : null}
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Link className="brand" href="/"><BlockwiseLogo /></Link>
            <p className="fine-print">Real estate Meta ads workflow: scan, campaign creation, approval, export and reporting.</p>
          </div>
          <div>
            <p className="fine-print">{area} audit prepared {prepared}. Figures reflect ads detected at scan time.</p>
          </div>
        </div>
      </footer>

      <MobileCta href="#lead" label={`Build my ${area} campaign plan`} data={analytics} />
      <AuditAnalytics data={analytics} />
    </div>
  );
}

function Hero({
  area,
  hasData,
  detected,
  active,
  advertisers,
  analytics,
}: {
  area: string;
  hasData: boolean;
  detected: number;
  active: number;
  advertisers: number;
  analytics: AnalyticsData;
}) {
  const headline = hasData
    ? `${numberFormat.format(advertisers)} real estate advertisers are running ads around ${area}.`
    : `Almost no agencies are advertising around ${area} yet.`;
  const lede = hasData
    ? `Blockwise found ${numberFormat.format(detected)} local real estate ads, including ${numberFormat.format(active)} still active. Based on the strongest public signals, we recommend three simple campaign angles your agency can launch first.`
    : `We found few or no local real estate ads here right now. That is an opening to be first in the local feed. Get a simple campaign plan to start.`;
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" />{area} ad radar</div>
          <h1>{headline}</h1>
          <p className="hero-lede">{lede}</p>
          <div className="cta-row">
            <TrackedAnchor href="#lead" event="primary_cta_clicked" data={{ ...analytics, placement: "hero" }} className="lp-btn lp-btn-primary lp-btn-big">Build my {area} campaign plan</TrackedAnchor>
            <TrackedAnchor href={hasData ? "#evidence" : "#plan"} event="secondary_cta_clicked" data={{ ...analytics, placement: "hero" }} className="lp-btn lp-btn-ghost lp-btn-big">{hasData ? "See competitor evidence" : "See the campaign pack"}</TrackedAnchor>
          </div>
          <div className="trust-row">
            <span className="trust-item"><span className="trust-dot" />7-day trial</span>
            <span className="trust-item"><span className="trust-dot" />10 ad packs</span>
            <span className="trust-item"><span className="trust-dot" />No card required</span>
            <span className="trust-item"><span className="trust-dot" />Approve before export</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stats({ area, stats }: { area: string; stats: AdAuditStats }) {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <h2>What the scan found</h2>
          <p>Public Meta Ad Library signals for {area} and surrounding suburbs, measured at scan time.</p>
        </div>
        <div className="stats-grid">
          <article className="stat-card"><strong>{numberFormat.format(stats.totals.detected)}</strong><span>Local real estate ads detected</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.totals.active)}</strong><span>Still active at scan time</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.advertiserCount)}</strong><span>Real estate advertisers</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.longestRunningDays)}</strong><span>Longest run in days (public signal)</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.newLast30Days)}</strong><span>New in the last 30 days</span></article>
        </div>
      </div>
    </section>
  );
}

function WhatThisMeans({
  area,
  topPlatform,
  topFormat,
  topAngles,
}: {
  area: string;
  topPlatform: string;
  topFormat: string;
  topAngles: string[];
}) {
  const anglesText = topAngles.length > 0 ? topAngles.join(", ") : "Just Listed and Free Appraisal";
  return (
    <section className="section">
      <div className="container insight">
        <div>
          <p className="card-kicker">What this means</p>
          <h2>Competitors are buying local attention now.</h2>
          <p>Competitors are already buying local attention around {area}. The useful question is not whether ads exist, it is which campaign is simplest to launch first.</p>
        </div>
        <ul className="insight-list">
          <li><strong>Start with {topPlatform}.</strong><span>{topPlatform} has the strongest detected platform coverage around {area}.</span></li>
          <li><strong>Lead with {topFormat.toLowerCase()} ads.</strong><span>{topFormat} is the dominant detected format, so production stays simple and fast.</span></li>
          <li><strong>Use the top detected angles.</strong><span>{anglesText} are the clearest repeat angles in the public data.</span></li>
        </ul>
      </div>
    </section>
  );
}

function CampaignPack({ area, pack }: { area: string; pack: CampaignCard[] }) {
  let counter = 0;
  const items = pack.map((card) => ({
    ...card,
    pill: card.detected ? `Campaign ${(counter += 1)}` : "Suggested differentiator",
  }));
  return (
    <section className="section" id="plan">
      <div className="container">
        <div className="section-head">
          <h2>Recommended campaign pack for {area}</h2>
          <p>Three simple angles, matched to the strongest public signals in your area.</p>
        </div>
        <div className="campaign-grid">
          {items.map((card) => (
            <article className="campaign-card" key={card.title}>
              <span className={card.detected ? "campaign-pill" : "campaign-pill is-suggested"}>{card.pill}</span>
              <h3>{card.title}</h3>
              <p>{card.purpose}</p>
              <ul>
                {card.bullets.map((bullet) => (<li key={bullet}>{bullet}</li>))}
              </ul>
            </article>
          ))}
        </div>
        <p className="compliance-note">Real estate campaigns may fall under the Meta Housing Special Ad Category. Blockwise keeps audiences broad, avoids restricted targeting options, and keeps every campaign review-ready before export.</p>
      </div>
    </section>
  );
}

function ExamplePreview({ area }: { area: string }) {
  return (
    <section className="section">
      <div className="container preview-grid">
        <div className="preview-panel">
          <p className="card-kicker">Your campaign, ready to review</p>
          <h2>Example campaign preview</h2>
          <p>Every audit turns into a campaign you approve before anything goes live.</p>
          <article className="mock-ad">
            <div className="mock-head">
              <div className="avatar" aria-hidden="true" />
              <div><strong>Your Agency</strong><span>Sponsored &middot; Facebook</span></div>
            </div>
            <p className="mock-copy">Thinking of selling in {area}? See how recent buyer demand and local sales activity could affect your next move.</p>
            <div className="mock-visual"><strong>Get a {area} property appraisal</strong></div>
            <div className="mock-actions"><span>Free Appraisal campaign</span><span className="mock-button">Get estimate</span></div>
          </article>
        </div>
        <div className="output-list">
          <article className="output-item"><strong>Ad copy</strong><p>Headline, primary text and CTA written for the chosen campaign angle.</p></article>
          <article className="output-item"><strong>Creative direction</strong><p>Image or short-video direction matched to the offer and your branding.</p></article>
          <article className="output-item"><strong>Lead form questions</strong><p>Qualification questions and a thank-you message for appraisal or buyer campaigns.</p></article>
          <article className="output-item"><strong>Budget and schedule</strong><p>A simple daily spend, duration and approval checks before export.</p></article>
          <article className="output-item"><strong>Approval checklist</strong><p>Brand, claims and pricing review prompts before anything leaves draft.</p></article>
        </div>
      </div>
    </section>
  );
}

function LeadSection({
  area,
  label,
  href,
  analytics,
  metrics,
}: {
  area: string;
  label: string;
  href: string;
  analytics: AnalyticsData;
  metrics: Metrics;
}) {
  return (
    <section className="section" id="lead">
      <div className="container lead-wrap">
        <div className="lead-panel">
          <p className="card-kicker">Your campaign plan</p>
          <h2>Get your {area} campaign plan.</h2>
          <p>Tell us your goal and we build the angle, ad copy and lead form. Start a trial after, or book a 15-minute setup.</p>
          <AuditLeadForm area={area} label={label} signupHref={href} metrics={metrics} analytics={analytics} />
        </div>
        <aside className="proof-box">
          <h3>What happens after you submit</h3>
          <ul>
            <li>Blockwise drafts the campaign angle, ad copy and lead form.</li>
            <li>Your team reviews everything before it is exported.</li>
            <li>Campaigns run from your own Meta ad account.</li>
            <li>The trial includes 10 ad packs and no card is required.</li>
          </ul>
          <div className="cta-row">
            <AuditCtaButton href={href} event="signup_clicked" data={analytics} className="lp-btn lp-btn-light">Start a free trial instead</AuditCtaButton>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Evidence({
  stats,
  excluded,
  analytics,
}: {
  stats: AdAuditStats;
  excluded: ExcludedAdvertiser[];
  analytics: AnalyticsData;
}) {
  return (
    <section className="section" id="evidence">
      <div className="container">
        <div className="section-head">
          <h2>Competitor evidence</h2>
          <p>The detail behind the plan, kept below the recommendation so you can launch first and verify second.</p>
        </div>
        <div className="evidence-panel">
          <TrackedDetails summary="Most active real estate advertisers" data={analytics} defaultOpen>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Advertiser</th><th>Ads detected</th><th>Active ads</th><th>Longest run</th><th>Top angle</th></tr></thead>
                <tbody>
                  {stats.topAdvertisers.map((advertiser) => (
                    <tr key={advertiser.name}>
                      <td>{advertiser.name}</td>
                      <td>{numberFormat.format(advertiser.ads)}</td>
                      <td>{numberFormat.format(advertiser.active)}</td>
                      <td>{numberFormat.format(advertiser.longestRunningDays)} days</td>
                      <td>{advertiser.topAngle ?? "Mixed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TrackedDetails>
          <TrackedDetails summary="Longest-running real estate ad signals" data={analytics}>
            <p className="signal-note">Long-running ads are public signals only. They do not prove ROAS, CPA, lead quality, or listing wins.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Advertiser</th><th>Ad</th><th>Run length</th><th>Status</th></tr></thead>
                <tbody>
                  {stats.longestRunning.map((ad) => (
                    <tr key={ad.id}>
                      <td>{ad.pageName}</td>
                      <td>{ad.headline ?? ad.adType ?? "Creative ad"}</td>
                      <td>{numberFormat.format(ad.daysRunning)} days</td>
                      <td><span className={ad.status === "active" ? "status" : "status status-muted"}>{ad.status === "active" ? "Active" : "Inactive"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TrackedDetails>
          <TrackedDetails summary="Formats, platforms and angles" data={analytics}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Detected signal</th></tr></thead>
                <tbody>
                  {stats.formats.slice(0, 3).map((format) => (<tr key={`f-${format.label}`}><td>Format</td><td>{format.label}: {numberFormat.format(format.count)} detected</td></tr>))}
                  {stats.platforms.slice(0, 3).map((platform) => (<tr key={`p-${platform.label}`}><td>Platform</td><td>{platform.label}: {numberFormat.format(platform.count)} detected</td></tr>))}
                  {stats.adTypes.slice(0, 4).map((angle) => (<tr key={`t-${angle.label}`}><td>Angle</td><td>{angle.label}: {numberFormat.format(angle.count)} detected</td></tr>))}
                </tbody>
              </table>
            </div>
          </TrackedDetails>
          {excluded.length > 0 ? (
            <TrackedDetails summary="Excluded advertisers (not counted as real estate)" data={analytics}>
              <p className="signal-note">Detected in the area but not counted as real estate, so they are excluded from every headline number above. Shown for transparency only.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Advertiser</th><th>Ads detected</th><th>Classification</th></tr></thead>
                  <tbody>
                    {excluded.map((advertiser) => (
                      <tr key={advertiser.name}>
                        <td>{advertiser.name}</td>
                        <td>{numberFormat.format(advertiser.ads)}</td>
                        <td>{advertiser.classification.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TrackedDetails>
          ) : null}
          <TrackedDetails summary="Methodology and notes" data={analytics}>
            <div className="method-note">
              <p>Data is sourced from the public Meta Ad Library at scan time and covers ads detected for the searched suburb plus surrounding suburbs and postcodes. Only advertisers classified as real estate are counted in the headline numbers.</p>
              <p>Long-running ads are public signals only. They are not proof of ROAS, CPA, lead quality, or listing wins.</p>
              <p>Blockwise is independent and is not affiliated with Meta Platforms, Inc. Advertiser names are shown for competitive research only.</p>
            </div>
          </TrackedDetails>
        </div>
      </div>
    </section>
  );
}

function pickParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}
