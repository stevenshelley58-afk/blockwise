import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { DemoForm } from "@/components/landing/demo-form";
import { SignInLink } from "@/components/landing/sign-in-link";

/**
 * Landing page — "Executive Precision" design (source: /stitch export, wired
 * to real app flows). Product-facts reference (informational, not a gate):
 * docs/landing-copy-spec.md. Copy is freely editable.
 *
 * Hero (2026-06-05): photo background from /public/hero/hero-wide.jpg (desktop)
 * and hero-tall.jpg (≤720px), referenced from landing.css. Perf-card numbers
 * are labeled example data.
 */

function TrustPoint({ label }: { label: string }) {
  return (
    <span className="lp-trust">
      <span className="lp-trust-check" aria-hidden>
        <Check size={11} strokeWidth={3.5} />
      </span>
      {label}
    </span>
  );
}

type RadarCardProps = {
  agency: string;
  platform: string;
  headline: string;
  suburb: string;
  running: string;
  image: string;
};

function RadarCard({ agency, platform, headline, suburb, running, image }: RadarCardProps) {
  return (
    <article className="lp-radar-card">
      <div
        className="lp-radar-thumb"
        style={{ backgroundImage: `url("${image}")` }}
        role="img"
        aria-label={`${suburb} property ad preview`}
      />
      <div className="lp-radar-body">
        <div className="lp-radar-source">
          <strong>{agency}</strong>
          <span>{platform}</span>
        </div>
        <h3>{headline}</h3>
        <div className="lp-radar-meta">
          <span>{suburb}</span>
          <span>Running {running}</span>
        </div>
        <CtaLink location="radar-use-angle" href="/signup" className="lp-radar-link">
          Use this angle →
        </CtaLink>
      </div>
    </article>
  );
}

type StepProps = { n: number; title: string; copy: string; icon: React.ReactNode };

function Step({ n, title, copy, icon }: StepProps) {
  return (
    <article className="lp-step">
      <span className="lp-step-pill">Step {n}</span>
      <div className="lp-step-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

type FeatureProps = { title: string; copy: string; icon: React.ReactNode };

function Feature({ title, copy, icon }: FeatureProps) {
  return (
    <article className="lp-feature">
      <div className="lp-feature-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

const TABLE_ROWS = [
  { name: "Mt Lawley Appraisal Campaign", status: "Active", clicks: "247", leads: "18", spend: "$324" },
  { name: "Subiaco Just Listed Campaign", status: "Active", clicks: "182", leads: "11", spend: "$210" },
  { name: "Cottesloe Open Home Campaign", status: "Paused", clicks: "93", leads: "7", spend: "$98" },
  { name: "South Perth Auction Campaign", status: "Active", clicks: "145", leads: "9", spend: "$176" },
] as const;

export default function HomePage() {
  return (
    <div className="lp">
      <header className="lp-nav-wrap">
        <div className="lp-shell lp-nav">
          <Link className="lp-brand" href="/" aria-label="Blockwise home">
            <BlockwiseLogo />
          </Link>
          <nav className="lp-nav-links" aria-label="Primary">
            <a href="#radar">Ad Radar</a>
            <a href="#campaigns">Campaigns</a>
            <a href="#how">How it works</a>
            <a href="#trial">Free trial</a>
          </nav>
          <div className="lp-nav-actions">
            <SignInLink />
            <CtaLink location="nav" href="/signup" className="lp-btn lp-btn-primary">
              Start free trial
            </CtaLink>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-shell lp-hero-grid">
            <div className="lp-hero-copy">
              <h1 id="hero-title">
                Your next lead is local.
                <span className="lp-hero-h1-sub">Run the ads that reach them first.</span>
              </h1>
              <p className="lp-lead lp-lead-light">
                Create and track local Meta ads without opening Ads Manager.
              </p>
            </div>

            <div className="lp-perf" aria-label="Campaign performance preview (example data)">
              <div className="lp-perf-top">
                <h3>Campaign Performance</h3>
                <div className="lp-perf-top-right">
                  <span className="lp-badge lp-badge-neutral">Example data</span>
                  <span className="lp-perf-range">
                    This Week
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="lp-perf-chart">
                <svg viewBox="0 0 320 120" role="img" aria-label="Example chart: leads climbing across the week to 23">
                  <path
                    d="M10 106C28 99 44 88 60 84C78 79 94 73 110 68C128 62 144 63 160 58C178 52 196 42 210 36"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <circle cx="60" cy="84" r="3.5" fill="#2563eb" stroke="#fff" strokeWidth="1.5" />
                  <circle cx="110" cy="68" r="3.5" fill="#2563eb" stroke="#fff" strokeWidth="1.5" />
                  <circle cx="160" cy="58" r="3.5" fill="#2563eb" stroke="#fff" strokeWidth="1.5" />
                  <circle cx="210" cy="36" r="5" fill="#2563eb" stroke="#fff" strokeWidth="2" />
                </svg>
                <span className="lp-perf-tag">23 Leads</span>
              </div>
              <div className="lp-perf-axis" aria-hidden>
                <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
              </div>
              <div className="lp-perf-stats">
                <div className="lp-perf-stat"><span>Leads</span><strong>23</strong></div>
                <div className="lp-perf-stat"><span>Cost per Lead</span><strong>$18</strong></div>
                <div className="lp-perf-stat"><span>Amount Spent</span><strong>$414</strong></div>
              </div>
            </div>

            <div className="lp-hero-actions">
              <div className="lp-cta-row">
                <CtaLink location="hero" href="/signup" className="lp-btn lp-btn-hero lp-btn-big">
                  Free Trial
                  <ArrowRight aria-hidden size={18} />
                </CtaLink>
              </div>
              <div className="lp-trust-row" aria-label="Product trust points">
                <TrustPoint label="Use your own ad account" />
                <TrustPoint label="Agent approval required" />
                <TrustPoint label="Budget controlled by you" />
                <TrustPoint label="Reporting inside Blockwise" />
              </div>
            </div>
          </div>
        </section>

        <section id="radar" className="lp-section">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow">Local Ad Radar</p>
              <h2 className="lp-h2">See what agencies are advertising in your market.</h2>
              <p className="lp-lead">
                Search by suburb, postcode, agency or ad copy. Blockwise shows active real estate ads
                in your area so you can understand the market before launching your own campaign.
              </p>
              <div className="lp-radar-box">
                <div className="lp-location-pill">
                  <span>Perth, WA</span>
                </div>
                <p className="lp-radar-note">Showing example ads around Perth, WA.</p>
                <CtaLink location="radar-scan" href="/signup" className="lp-btn lp-btn-primary lp-btn-wide">
                  Scan my suburb
                </CtaLink>
              </div>
            </div>
            <div className="lp-radar-list">
              <RadarCard
                agency="Coastline Property"
                platform="Meta"
                headline="Open home campaign for coastal family living."
                suburb="Cottesloe"
                running="20 days"
                image="/ads/ad-coastline.jpg"
              />
              <RadarCard
                agency="Hillview Agents"
                platform="Instagram"
                headline="Just listed campaign with city lifestyle angle."
                suburb="Subiaco"
                running="14 days"
                image="/ads/ad-hillview.jpg"
              />
              <RadarCard
                agency="Northstar Realty"
                platform="Meta"
                headline="Appraisal campaign aimed at local sellers."
                suburb="Mount Lawley"
                running="32 days"
                image="/ads/ad-northstar.jpg"
              />
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-surface">
          <div className="lp-shell">
            <div className="lp-center-head">
              <p className="lp-eyebrow">How it works</p>
              <h2 className="lp-h2">From brief to live campaign in four steps.</h2>
            </div>
            <div className="lp-steps">
              <Step
                n={1}
                title="Create the campaign brief"
                copy="Choose the campaign type, suburb, goal and property details."
                icon={
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                }
              />
              <Step
                n={2}
                title="Generate the campaign"
                copy="Blockwise drafts the ads, creative variants, lead form and campaign settings."
                icon={
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z" /><path d="M5 15l.9 2.1L8 18l-2.1.9L5 21l-.9-2.1L2 18l2.1-.9Z" /></svg>
                }
              />
              <Step
                n={3}
                title="Review and approve"
                copy="Your team checks every claim, disclaimer, image and budget before launch."
                icon={
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>
                }
              />
              <Step
                n={4}
                title="Launch from Blockwise"
                copy="Connect your ad account, publish the campaign and track performance inside the app."
                icon={
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4Z" /></svg>
                }
              />
            </div>
          </div>
        </section>

        <section id="campaigns" className="lp-section">
          <div className="lp-shell">
            <div className="lp-center-head">
              <p className="lp-eyebrow">Campaigns</p>
              <h2 className="lp-h2">Everything you need to launch real estate campaigns.</h2>
              <p className="lp-lead">
                Blockwise gives agents and marketing coordinators the tools to create the campaign,
                approve the details and run it through the agency ad account.
              </p>
            </div>
            <div className="lp-features">
              <Feature
                title="Facebook and Instagram ads"
                copy="Headlines, primary text, descriptions and creative variants for common property campaign types."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z" /></svg>}
              />
              <Feature
                title="Lead forms"
                copy="Questions, privacy details and thank-you screen, matched to the campaign goal."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>}
              />
              <Feature
                title="Campaign angles"
                copy="Just Listed, Open Home, Just Sold, Free Appraisal, Buyer Demand and Market Update."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>}
              />
              <Feature
                title="Budget and schedule"
                copy="Set spend and duration before anything launches. Ad spend goes through your ad account."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>}
              />
              <Feature
                title="Approval checks"
                copy="Flag common review issues around claims, pricing language, brand fit and final sign off."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>}
              />
              <Feature
                title="Live reporting"
                copy="Track impressions, clicks, leads, spend and campaign status inside Blockwise."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="5" width="3" height="12" /></svg>}
              />
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-surface" aria-labelledby="control-title">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow">Approval and control</p>
              <h2 className="lp-h2" id="control-title">You stay in control before anything goes live.</h2>
              <p className="lp-lead">
                Every campaign is drafted inside Blockwise, reviewed by your team and launched through
                your connected ad account only after approval.
              </p>
              <ul className="lp-control-list" aria-label="Control points">
                <li><span className="lp-check" aria-hidden>✓</span>Approve every ad before launch</li>
                <li><span className="lp-check" aria-hidden>✓</span>Use your own Meta ad account</li>
                <li><span className="lp-check" aria-hidden>✓</span>Control the budget and schedule</li>
                <li><span className="lp-check" aria-hidden>✓</span>See every result in one dashboard</li>
              </ul>
            </div>
            <div className="lp-table-card" aria-label="Campaign reporting table preview">
              <div className="lp-table-bar">
                <div>
                  <strong>Campaigns</strong>
                  <span className="lp-badge lp-badge-neutral">Example data</span>
                </div>
                <CtaLink location="control-table" href="/signup" className="lp-btn lp-btn-primary lp-btn-sm">
                  Create campaign
                </CtaLink>
              </div>
              <div className="lp-table-scroll">
                <table className="lp-table">
                  <thead>
                    <tr><th>Campaign</th><th>Status</th><th>Clicks</th><th>Leads</th><th>Spend</th></tr>
                  </thead>
                  <tbody>
                    {TABLE_ROWS.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>
                          <span className={row.status === "Active" ? "lp-badge lp-badge-active" : "lp-badge lp-badge-neutral"}>
                            {row.status}
                          </span>
                        </td>
                        <td>{row.clicks}</td>
                        <td>{row.leads}</td>
                        <td>{row.spend}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section id="trial" className="lp-section lp-trial">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow lp-eyebrow-green">Free trial</p>
              <h2 className="lp-h2 lp-h2-light">Try Blockwise with 10 campaigns.</h2>
              <p className="lp-lead lp-lead-light">
                No card required. Create draft campaigns, review the ads and connect your ad account
                when you are ready to launch.
              </p>
              <CtaLink location="trial" href="/signup" className="lp-btn lp-btn-light lp-btn-big">
                Create your first campaign
              </CtaLink>
            </div>
            <div className="lp-trial-grid">
              <div className="lp-trial-item"><strong>7 days</strong><span>Full access to the campaign builder from the minute you confirm your email.</span></div>
              <div className="lp-trial-item"><strong>10 campaigns</strong><span>Create up to 10 draft campaigns during the trial.</span></div>
              <div className="lp-trial-item"><strong>No card</strong><span>Nothing charges when the trial ends. Your drafts stay put.</span></div>
              <div className="lp-trial-item"><strong>Connect anytime</strong><span>Connect your Meta ad account when you are ready.</span></div>
            </div>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-shell lp-faq-grid">
            <div>
              <p className="lp-eyebrow">Questions</p>
              <h2 className="lp-h2">The bits agents ask about.</h2>
              <div className="lp-faq-list">
                <details open>
                  <summary>Who pays for ad spend?</summary>
                  <p>
                    You do. Campaigns run through your connected ad account and your ad spend is paid to
                    the platform directly. Blockwise is the software used to create, approve, launch and
                    track the campaign.
                  </p>
                </details>
                <details>
                  <summary>Do I need a Meta ad account?</summary>
                  <p>
                    You can create and review campaigns before connecting Meta. To launch from Blockwise,
                    connect your Meta ad account.
                  </p>
                </details>
                <details>
                  <summary>Can I approve ads before they run?</summary>
                  <p>
                    Yes. Nothing goes live until your team approves the copy, creative, lead form, budget
                    and schedule.
                  </p>
                </details>
                <details>
                  <summary>Can I see results inside Blockwise?</summary>
                  <p>
                    Yes. Once launched, Blockwise shows campaign status, spend, clicks, leads and
                    performance metrics inside the app.
                  </p>
                </details>
                <details>
                  <summary>Are the ads checked before publishing?</summary>
                  <p>
                    Blockwise flags common property advertising risks and brand issues before approval.
                    Your agency remains responsible for final review, claims, pricing language and
                    publishing.
                  </p>
                </details>
                <details>
                  <summary>What happens after the 7 days?</summary>
                  <p>
                    Creating campaigns pauses and we ask you to pick a plan. We never took a card, so
                    there is no surprise charge. Your drafts stay put.
                  </p>
                </details>
              </div>
            </div>
            <aside className="lp-setup-card">
              <h3>Need a hand getting started?</h3>
              <p>
                Book a 15-minute walkthrough. We&rsquo;ll help you create your first campaign, connect
                your ad account and get everything ready to launch.
              </p>
              <CtaLink location="faq-walkthrough" href="#demo" className="lp-btn lp-btn-primary">
                Book a walkthrough
              </CtaLink>
            </aside>
          </div>
        </section>

        <section id="demo" className="lp-section lp-section-surface" aria-labelledby="demo-title">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow">Managed setup</p>
              <h2 className="lp-h2" id="demo-title">Want help launching your first campaign?</h2>
              <p className="lp-lead">
                Book a 15-minute walkthrough. We&rsquo;ll help you create your first campaign, connect
                your ad account and review everything before launch.
              </p>
            </div>
            <DemoForm />
          </div>
        </section>
      </main>

      <footer className="lp-footer" aria-label="Footer">
        <div className="lp-shell lp-footer-grid">
          <div>
            <BlockwiseLogo />
            <p>
              The ad platform for real estate teams. Create, approve, launch and track property
              campaigns from one place.
            </p>
            <p className="lp-footer-contact">
              <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#radar">Ad Radar</a>
            <a href="#campaigns">Campaigns</a>
            <a href="#how">How it works</a>
            <a href="#trial">Free trial</a>
          </div>
          <div>
            <h4>Legal</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </div>
        </div>
        <div className="lp-shell lp-footer-bottom">© {new Date().getFullYear()} Blockwise. All rights reserved.</div>
      </footer>
    </div>
  );
}
