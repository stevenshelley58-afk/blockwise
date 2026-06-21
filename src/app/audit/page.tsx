import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { AuditCtaButton, AuditViewTracker } from "@/components/research/audit-conversion";
import { AuditLeadForm } from "@/components/research/audit-lead-form";
import { buildAdAudit, type AdAuditResult, type AdAuditStats } from "@/lib/research/ad-audit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import "../audit.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Local Ad Market Audit",
  description:
    "See which agencies are advertising around your suburb and get a ready-to-build campaign plan from Blockwise.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const numberFormat = new Intl.NumberFormat("en-AU");

function signupHref(market: string): string {
  return `/signup?source=audit&market=${encodeURIComponent(market)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "today";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }).format(date);
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
  const prepared = audit ? formatDate(audit.generatedAt) : formatDate(new Date().toISOString());

  return (
    <div className="audit-page">
      <header className="site-header">
        <div className="container nav">
          <Link className="brand" href="/" aria-label="Blockwise home"><BlockwiseLogo /></Link>
          <nav className="nav-links">
            <a href="#plan">Campaign plan</a>
            <a href="#evidence">Competitor evidence</a>
            <a href="#lead" className="lp-btn lp-btn-primary lp-btn-sm">Build my {label} campaign</a>
          </nav>
        </div>
      </header>

      <main>
        <Hero label={label} prepared={prepared} stats={audit?.stats ?? null} />
        {audit && audit.stats.totals.detected > 0 ? <Stats stats={audit.stats} /> : null}
        {audit && audit.stats.totals.detected > 0 ? <Insight label={label} stats={audit.stats} /> : null}
        <CampaignPack label={label} />
        <OutputPreview label={label} />
        <LeadSection label={label} />
        {audit && audit.stats.totals.detected > 0 ? <Evidence stats={audit.stats} /> : null}
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Link className="brand" href="/"><BlockwiseLogo /></Link>
            <p className="fine-print">Real estate Meta ads workflow: scan, campaign creation, approval, export and reporting.</p>
          </div>
          <div>
            <p className="fine-print">{label} audit prepared {prepared}. Figures reflect ads detected at scan time.</p>
          </div>
        </div>
      </footer>

      <div className="mobile-cta">
        <a className="lp-btn lp-btn-primary lp-btn-wide" href="#lead">Build my {label} campaign</a>
      </div>

      <AuditViewTracker market={label} />
    </div>
  );
}

function Hero({ label, prepared, stats }: { label: string; prepared: string; stats: AdAuditStats | null }) {
  const detected = stats?.totals.detected ?? 0;
  const active = stats?.totals.active ?? 0;
  const advertisers = stats?.advertiserCount ?? 0;
  const longest = stats?.longestRunningDays ?? 0;
  const headline =
    advertisers > 0
      ? `${numberFormat.format(advertisers)} agencies are advertising around ${label}.`
      : `Almost no one is advertising in ${label} yet.`;
  const lede =
    detected > 0
      ? `Blockwise found ${numberFormat.format(detected)} local real estate ads, including ${numberFormat.format(active)} still active. Use the strongest public signals to launch a simpler Facebook and Instagram campaign pack for your agency.`
      : `Few or no competitors are advertising here right now. That is the opening: be the first agent owning the local feed and capture sellers before your competitors show up.`;

  return (
    <section className="hero">
      <div className="container hero-grid">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" />{label} ad radar</div>
          <h1>{headline}</h1>
          <p className="hero-lede">{lede}</p>
          <div className="cta-row">
            <a className="lp-btn lp-btn-primary lp-btn-big" href="#lead">Build my {label} campaign</a>
            <a className="lp-btn lp-btn-ghost lp-btn-big" href={detected > 0 ? "#evidence" : "#plan"}>
              {detected > 0 ? "See competitor evidence" : "See the campaign pack"}
            </a>
          </div>
          <div className="trust-row">
            <span className="trust-item"><span className="trust-dot" />7-day trial</span>
            <span className="trust-item"><span className="trust-dot" />10 ad packs</span>
            <span className="trust-item"><span className="trust-dot" />No card required</span>
            <span className="trust-item"><span className="trust-dot" />Approve before export</span>
          </div>
        </div>
        <aside className="audit-card">
          <p className="card-kicker">Prepared {prepared}</p>
          <h2>What the scan found</h2>
          <p>The market is already active. The fastest conversion path is not more analysis &mdash; it is a clear campaign plan based on the signals below.</p>
          <div className="mini-stats">
            <div className="mini-stat"><strong>{numberFormat.format(detected)}</strong><span>competitor ads found</span></div>
            <div className="mini-stat"><strong>{numberFormat.format(active)}</strong><span>still live now</span></div>
            <div className="mini-stat"><strong>{numberFormat.format(advertisers)}</strong><span>agencies competing</span></div>
            <div className="mini-stat"><strong>{numberFormat.format(longest)}</strong><span>day longest-run signal</span></div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Stats({ stats }: { stats: AdAuditStats }) {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <h2>Keep the numbers. Make the next step obvious.</h2>
          <p>The only metrics you need before the recommended campaign pack.</p>
        </div>
        <div className="stats-grid">
          <article className="stat-card"><strong>{numberFormat.format(stats.totals.detected)}</strong><span>Competitor ads found in your area and surrounds</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.totals.active)}</strong><span>Ads still active at scan time</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.advertiserCount)}</strong><span>Distinct agencies advertising locally</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.longestRunningDays)}</strong><span>Longest-running ad signal in days</span></article>
          <article className="stat-card"><strong>{numberFormat.format(stats.newLast30Days)}</strong><span>New ads detected in the last 30 days</span></article>
        </div>
      </div>
    </section>
  );
}

function Insight({ label, stats }: { label: string; stats: AdAuditStats }) {
  const topPlatform = stats.platforms[0]?.label ?? "Facebook";
  const topFormat = stats.formats[0]?.label ?? "Image";
  const topAngles = stats.adTypes.slice(0, 2).map((a) => a.label);
  const anglesText = topAngles.length > 0 ? topAngles.join(" and ") : "Just Listed and Free Appraisal";
  return (
    <section className="section">
      <div className="container insight">
        <div>
          <p className="card-kicker">What this means</p>
          <h2>Competitors are buying local attention now.</h2>
          <p>A good audit does not make you interpret charts &mdash; it tells you what to launch. Around {label}, the clearest repeat angles are {anglesText} campaigns.</p>
        </div>
        <ul className="insight-list">
          <li><strong>Use {topPlatform} first.</strong><span>{topPlatform} has the strongest detected coverage here, so start there before adding complexity.</span></li>
          <li><strong>Use {topFormat.toLowerCase()} ads first.</strong><span>{topFormat} is the dominant detected format, which keeps production simple and fast.</span></li>
          <li><strong>Lead with seller intent.</strong><span>Free Appraisal and Market Update campaigns are the clearest path to vendor leads.</span></li>
        </ul>
      </div>
    </section>
  );
}

function CampaignPack({ label }: { label: string }) {
  return (
    <section className="section" id="plan">
      <div className="container">
        <div className="section-head">
          <h2>Recommended campaign pack for {label}</h2>
          <p>Three campaigns are enough. More options create friction &mdash; this gives you a direct choice and a clear next step.</p>
        </div>
        <div className="campaign-grid">
          <article className="campaign-card">
            <span className="campaign-pill">Campaign 1</span>
            <h3>Free Appraisal</h3>
            <p>Vendor lead capture from homeowners weighing a sale but not ready to call yet.</p>
            <ul>
              <li>Meta lead form with suburb and property-type questions</li>
              <li>Primary CTA: Get my estimate</li>
              <li>Best audience: homeowners and local property intenders</li>
            </ul>
          </article>
          <article className="campaign-card">
            <span className="campaign-pill">Campaign 2</span>
            <h3>Just Listed</h3>
            <p>Buyer demand, seller proof and retargeting. Shows local activity without a hard sell.</p>
            <ul>
              <li>One property-led image creative</li>
              <li>Primary CTA: View property</li>
              <li>Best audience: local buyers, lookalikes and retargeting</li>
            </ul>
          </article>
          <article className="campaign-card">
            <span className="campaign-pill">Campaign 3</span>
            <h3>Market Update</h3>
            <p>The lower-pressure campaign for owners who want local context before an appraisal.</p>
            <ul>
              <li>Lead magnet: suburb price and activity snapshot</li>
              <li>Primary CTA: Send me the update</li>
              <li>Best audience: owners in {label} and surrounding suburbs</li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

function OutputPreview({ label }: { label: string }) {
  return (
    <section className="section">
      <div className="container preview-grid">
        <div className="preview-panel">
          <p className="card-kicker">Example output</p>
          <h2>Show the ad, not another chart.</h2>
          <p>The audit converts into a ready-to-review campaign preview &mdash; the missing bridge between the scan and account creation.</p>
          <article className="mock-ad">
            <div className="mock-head">
              <div className="avatar" aria-hidden="true" />
              <div><strong>Your Agency</strong><span>Sponsored &middot; Facebook</span></div>
            </div>
            <div className="mock-visual"><strong>Thinking of selling in {label}?</strong></div>
            <p className="mock-copy">Get a local appraisal backed by current buyer demand and recent campaign activity around your suburb.</p>
            <div className="mock-actions"><span>Free Appraisal campaign</span><span className="mock-button">Learn more</span></div>
          </article>
        </div>
        <div className="output-list">
          <article className="output-item"><strong>1. Ad copy and creative direction</strong><p>Headlines, primary text, CTA and image direction matched to the chosen campaign angle.</p></article>
          <article className="output-item"><strong>2. Lead form</strong><p>Recommended questions, thank-you message and qualification fields for appraisal or buyer campaigns.</p></article>
          <article className="output-item"><strong>3. Budget and schedule</strong><p>A simple launch setup with daily spend, duration and approval checks before export.</p></article>
          <article className="output-item"><strong>4. Approval checklist</strong><p>Brand, claims, pricing language and final review prompts before anything leaves draft.</p></article>
        </div>
      </div>
    </section>
  );
}

function LeadSection({ label }: { label: string }) {
  const href = signupHref(label);
  return (
    <section className="section" id="lead">
      <div className="container lead-wrap">
        <div className="lead-panel">
          <p className="card-kicker">Low-friction conversion</p>
          <h2>Get the {label} campaign plan.</h2>
          <p>Tell us the goal and we will build the angle, ad copy and lead form. Start a trial after, or book a 15-minute setup.</p>
          <AuditLeadForm location={label} signupHref={href} />
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
            <AuditCtaButton href={href} market={label} className="lp-btn lp-btn-light">Start free trial instead</AuditCtaButton>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Evidence({ stats }: { stats: AdAuditStats }) {
  return (
    <section className="section" id="evidence">
      <div className="container">
        <div className="section-head">
          <h2>Competitor evidence</h2>
          <p>Below the recommendation on purpose. It supports trust; it should not be the first thing you decode.</p>
        </div>
        <div className="evidence-panel">
          <details open>
            <summary>Most active advertisers</summary>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agency</th><th>Ads detected</th><th>Active</th><th>Longest run</th></tr></thead>
                <tbody>
                  {stats.topAdvertisers.map((a) => (
                    <tr key={a.name}><td>{a.name}</td><td>{numberFormat.format(a.ads)}</td><td>{numberFormat.format(a.active)}</td><td>{numberFormat.format(a.longestRunningDays)} days</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Longest-running ad signals</summary>
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
          </details>
          <details>
            <summary>Detected formats, platforms and angles</summary>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Detected signal</th></tr></thead>
                <tbody>
                  {stats.formats.slice(0, 3).map((f) => (<tr key={`f-${f.label}`}><td>Format</td><td>{f.label}: {numberFormat.format(f.count)} detected</td></tr>))}
                  {stats.platforms.slice(0, 3).map((p) => (<tr key={`p-${p.label}`}><td>Platform</td><td>{p.label}: {numberFormat.format(p.count)} detected</td></tr>))}
                  {stats.adTypes.slice(0, 4).map((t) => (<tr key={`t-${t.label}`}><td>Angle</td><td>{t.label}: {numberFormat.format(t.count)} detected</td></tr>))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Methodology and notes</summary>
            <div className="method-note">
              <p>Data is sourced from the public Meta Ad Library at scan time and covers ads detected for the searched suburb plus surrounding suburbs and postcodes. Longest-running ads are public signals only &mdash; not proof of ROAS, CPA, lead quality or listing wins.</p>
              <p>Blockwise is independent and is not affiliated with Meta Platforms, Inc. Advertiser names are shown for competitive research only.</p>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

function pickParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}
