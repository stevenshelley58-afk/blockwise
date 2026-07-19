import Link from "next/link";

import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";

import {
  CHART_POINTS_DESKTOP,
  CONTROL_POINTS,
  DASH_ROWS,
  DASH_TILES,
  PROPERTY_NOTES,
  PROPERTY_USES,
  RADAR_ADS,
} from "./data";
import { FaqAccordion } from "./faq-accordion";
import { ManagedSetupForm } from "./managed-setup-form";
import { SuburbReportLocationForm } from "./suburb-report-location-form";

/**
 * Desktop tree of the homepage redesign (≥768px), a 1:1 recreation of
 * `Blockwise Homepage.dc.html` from the design handoff. Hidden below 768px
 * where the separate mobile tree takes over.
 */

function TemplateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="#315F9B" strokeWidth="1.5" />
      <line x1="1" y1="6.5" x2="17" y2="6.5" stroke="#315F9B" strokeWidth="1.5" />
      <line x1="9" y1="6.5" x2="9" y2="17" stroke="#315F9B" strokeWidth="1.5" />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="#315F9B" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.5" fill="#315F9B" />
    </svg>
  );
}

export function DesktopHeader() {
  return (
    <header className="hw-only hw-header">
      <div className="hw-header-in">
        <a href="#top" className="hw-logo">
          <span className="hw-logo-mark" />
          <span className="hw-logo-word">blockwise</span>
        </a>
        <nav className="hw-nav" aria-label="Main">
          <a href="#start">How it works</a>
          <a href="#property-check">Property Check</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/guides">Guides</Link>
        </nav>
        <div className="hw-header-actions">
          <SignInLink className="hw-login" />
          <CtaLink location="header" href="/signup" className="hw-btn hw-btn--outline hw-header-cta">
            Start free trial
          </CtaLink>
        </div>
      </div>
    </header>
  );
}

export function DesktopHero() {
  return (
    <div className="hw-only">
      <div className="hw-hero">
        <div className="hw-hero-copy">
          <div data-reveal="up" className="hw-kicker">
            Local ad intelligence
          </div>
          <h1 data-reveal="up" data-rd="1" className="hw-h1">
            Your competitors are advertising. Are&nbsp;you?
          </h1>
          <p data-reveal="up" data-rd="2" className="hw-hero-sub">
            See the local lead ads competing for attention. Then create yours with a clear starting
            point.
          </p>
          <div data-reveal="up" data-rd="3">
            <SuburbReportLocationForm analyticsLocation="hero" />
          </div>
        </div>

        <div data-reveal="scale" data-rd="2" className="hw-hero-map">
          <img src="/home/hero-map.webp" alt="Map of Perth, WA showing 10,000+ local ads found" />
          <div className="hw-ping hw-ping-1" />
          <div className="hw-ping hw-ping-2" />
          <div className="hw-ping hw-ping-3" />
          <div className="hw-ping hw-ping-4" />
        </div>
      </div>
    </div>
  );
}

export function DesktopSignal() {
  return (
    <div className="hw-only hw-sec">
      <div className="hw-sec-in">
        <div data-reveal="up" className="hw-sec-head">
          <div className="hw-kicker">From signal to ad</div>
          <h2 className="hw-h2">Don&rsquo;t start from a blank page.</h2>
          <p className="hw-sec-sub">
            Choose a proven template or use an ad approach already working in the market. Blockwise
            adapts it to your listing and brand.
          </p>
        </div>
        <div className="hw-sig-grid">
          {/* Two starting points */}
          <div data-reveal="up" className="hw-sig-left">
            {/* Use a template */}
            <div className="hw-sig-card">
              <div className="hw-sig-card-head">
                <span className="hw-sig-icon">
                  <TemplateIcon />
                </span>
                <div>
                  <div className="hw-sig-card-title">Use a template</div>
                  <div className="hw-sig-card-sub">Choose a ready-made ad and add your listing.</div>
                </div>
              </div>
              <div className="hw-sig-tabs">
                <span className="hw-sig-tab hw-sig-tab--active">All templates</span>
                <span className="hw-sig-tab">Property highlight</span>
                <span className="hw-sig-tab">Auction</span>
                <span className="hw-sig-tab">Lifestyle</span>
                <span className="hw-sig-tab">Brand</span>
              </div>
              <div className="hw-tpl-grid">
                <div className="hw-tpl hw-tpl--dark">
                  <div className="hw-tpl-brand">Your Agency</div>
                  <div className="hw-tpl-h--light">Thinking of selling?</div>
                  <div className="hw-tpl-body">
                    Find out what your home could be worth with a free appraisal.
                  </div>
                  <span className="hw-tpl-pill hw-tpl-pill--outline">Book a free appraisal</span>
                </div>
                <div className="hw-tpl hw-tpl--photo">
                  <img className="hw-img-cover" src="/home/home-pool.webp" alt="" />
                  <div className="hw-tpl-overlay">
                    <div className="hw-tpl-overlay-brand">Your Agency</div>
                    <div className="hw-tpl-overlay-h">Elevated living in the heart of it all.</div>
                  </div>
                </div>
                <div className="hw-tpl hw-tpl--light">
                  <div className="hw-tpl-brand">Your Agency</div>
                  <div className="hw-tpl-h--dark">Auction Saturday 2pm</div>
                  <div className="hw-tpl-body">On-site · Registration from 1.30pm</div>
                  <span className="hw-tpl-pill hw-tpl-pill--solid">View property</span>
                </div>
                <div className="hw-tpl hw-tpl--photo">
                  <img className="hw-img-cover" src="/home/interior-styled.webp" alt="" />
                  <div className="hw-tpl-overlay">
                    <div className="hw-tpl-overlay-brand">Your Agency</div>
                    <div className="hw-tpl-overlay-h">Space to live. Room to grow.</div>
                  </div>
                </div>
              </div>
            </div>
            {/* Start from your suburb */}
            <div className="hw-sig-card">
              <div className="hw-sig-card-head">
                <span className="hw-sig-icon">
                  <RadarIcon />
                </span>
                <div>
                  <div className="hw-sig-card-title">
                    Choose your suburb. See what&rsquo;s working.
                  </div>
                  <div className="hw-sig-card-sub">
                    Ads running near you right now, ready to build on.
                  </div>
                </div>
              </div>
              <div className="hw-radar-grid">
                {RADAR_ADS.map((ad) => (
                  <div key={ad.foot} className="hw-radar-card">
                    <div className="hw-radar-head">
                      <span className="hw-radar-avatar">YA</span>
                      <div className="hw-radar-id">
                        <div className="hw-radar-agency">{ad.agency}</div>
                        <div className="hw-radar-sponsored">
                          Sponsored · <span style={{ letterSpacing: "0.05em" }}>⊕</span>
                        </div>
                      </div>
                      <span className="hw-radar-dots">···</span>
                    </div>
                    <div className="hw-radar-copy">{ad.copy}</div>
                    <div className="hw-radar-photo">
                      <img className="hw-img-cover" src={ad.src} alt="" />
                    </div>
                    <div className="hw-radar-foot">
                      <div style={{ minWidth: 0 }}>
                        <div className="hw-radar-domain">YOURAGENCY.COM.AU</div>
                        <div className="hw-radar-foot-h">{ad.foot}</div>
                      </div>
                      <span className="hw-radar-cta">{ad.cta}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Connectors: elbow lines into the review panel */}
          <div data-reveal="fade" className="hw-sig-connectors" aria-hidden>
            <svg viewBox="0 0 64 100" preserveAspectRatio="none" className="hw-sig-connectors-svg">
              <path
                d="M6 22 H30 V42 H58"
                fill="none"
                stroke="#315F9B"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M6 78 H30 V58 H58"
                fill="none"
                stroke="#315F9B"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <svg className="hw-flow-cap hw-flow-cap--a" width="9" height="9" viewBox="0 0 9 9">
              <path d="M2 1 L7 4.5 L2 8" fill="none" stroke="#315F9B" strokeWidth="1.5" />
            </svg>
            <svg className="hw-flow-cap hw-flow-cap--b" width="9" height="9" viewBox="0 0 9 9">
              <path d="M2 1 L7 4.5 L2 8" fill="none" stroke="#315F9B" strokeWidth="1.5" />
            </svg>
          </div>
          {/* Ready to review */}
          <div data-reveal="up" data-rd="1" className="hw-review">
            <div className="hw-review-head">
              <div className="hw-review-status">
                <span className="hw-dot" />
                <span className="hw-review-status-label">Ready to review</span>
              </div>
              <span className="hw-review-tag">Your listing</span>
            </div>
            <div className="hw-fbad">
              <div className="hw-fbad-head">
                <span className="hw-fbad-avatar">YA</span>
                <div>
                  <div className="hw-fbad-agency">Your Agency</div>
                  <div className="hw-fbad-sponsored">Sponsored</div>
                </div>
              </div>
              <div className="hw-fbad-copy">
                Thinking of selling? Find out what your home could be worth with a free property
                appraisal.
              </div>
              <div className="hw-fbad-photo">
                <img className="hw-img-cover" src="/home/home-dusk.webp" alt="" />
              </div>
              <div className="hw-fbad-foot">
                <div className="hw-fbad-foot-l">
                  <div className="hw-fbad-domain">YOURAGENCY.COM.AU</div>
                  <div className="hw-fbad-foot-h">Find out what your home could be worth</div>
                  <div className="hw-fbad-foot-sub">Book a free property appraisal</div>
                </div>
                <span className="hw-fbad-btn">Learn more</span>
              </div>
            </div>
            <CtaLink
              location="signal_review"
              href="/signup"
              className="hw-btn hw-btn--light hw-review-cta"
            >
              Create my ad
            </CtaLink>
            <div className="hw-review-note">Nothing spends until you approve.</div>
          </div>
        </div>
        <p className="hw-sig-disclaimer">
          Nearby-ad examples show activity signals, not results. What runs is always your call.
        </p>
      </div>
    </div>
  );
}

export function DesktopDoneForYou() {
  return (
    <div className="hw-only hw-sec">
      <div className="hw-sec-in">
        <div className="hw-dfy-grid">
          {/* Left rail */}
          <div data-reveal="up">
            <h2 className="hw-dfy-h2">
              Prepared.
              <br />
              Checked.
              <br />
              Sent.
            </h2>
            <p className="hw-dfy-sub">One approval replaces the setup work.</p>
            <CtaLink location="done_for_you" href="/signup" className="hw-textlink">
              Get your first ad prepared <span className="hw-arr">→</span>
            </CtaLink>
          </div>

          {/* Review card */}
          <div data-reveal="up" data-rd="1" className="hw-dfy-card">
            <div className="hw-dfy-bar">
              <span className="hw-dot" />
              <span className="hw-dfy-bar-label">Seller lead ad · Ready for review</span>
            </div>
            <div className="hw-dfy-body">
              <div className="hw-dfy-checklist">
                {(
                  [
                    ["Copy", "Prepared"],
                    ["Creative", "Fitted"],
                    ["Lead form", "Ready"],
                    ["Budget", "$25/day"],
                    ["Timing", "Set"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="hw-dfy-check">
                    <span className="hw-dfy-check-k">{k}</span>
                    <span className="hw-dfy-check-v">{v}</span>
                  </div>
                ))}
              </div>
              <div className="hw-dfy-divider" />
              <div className="hw-dfy-right">
                <div className="hw-dfy-ad">
                  <div className="hw-fbad-head">
                    <span className="hw-fbad-avatar">YA</span>
                    <div>
                      <div className="hw-fbad-agency">Your Agency</div>
                      <div className="hw-fbad-sponsored">Sponsored</div>
                    </div>
                    <span className="hw-fbad-menu">···</span>
                  </div>
                  <div className="hw-fbad-copy">
                    Wondering what your home is worth? Book a free, no-obligation appraisal this
                    week.
                  </div>
                  <div className="hw-fbad-photo">
                    <img className="hw-img-cover" src="/home/mt-lawley-federation.webp" alt="" />
                  </div>
                  <div className="hw-fbad-foot">
                    <div className="hw-fbad-foot-l">
                      <div className="hw-fbad-domain">youragency.com</div>
                      <div className="hw-fbad-foot-h">Free home appraisal</div>
                      <div className="hw-fbad-foot-sub">Local experts. No obligation.</div>
                    </div>
                    <span className="hw-fbad-btn">Learn more</span>
                  </div>
                </div>
                <CtaLink
                  location="done_for_you_approve"
                  href="/signup"
                  className="hw-btn hw-btn--dark hw-dfy-approve"
                >
                  Approve
                </CtaLink>
              </div>
            </div>
            {/* Perforation */}
            <div className="hw-dfy-perforation" />
            {/* Daily update strip */}
            <div className="hw-dfy-strip">
              <div className="hw-dfy-strip-label">Daily update sent</div>
              <div className="hw-dfy-stats">
                <div className="hw-dfy-stat">
                  <div className="hw-dfy-stat-v">12</div>
                  <div className="hw-dfy-stat-k">leads</div>
                </div>
                <div className="hw-dfy-stat">
                  <div className="hw-dfy-stat-v">$86</div>
                  <div className="hw-dfy-stat-k">spend</div>
                </div>
                <div className="hw-dfy-stat">
                  <div className="hw-dfy-stat-k hw-dfy-stat-k--top">Best angle</div>
                  <div className="hw-dfy-stat-best">Free appraisal</div>
                </div>
              </div>
              <div className="hw-dfy-strip-note">Nothing spends before approval.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopControl() {
  return (
    <div className="hw-only hw-sec">
      <div className="hw-sec-in">
        <div className="hw-ctl-grid">
          <div data-reveal="up" className="hw-ctl-rail">
            <div className="hw-kicker">Approval and control</div>
            <h2 className="hw-h2 hw-h2--34 hw-ctl-h2">
              You stay in control before and after approval.
            </h2>
            <p className="hw-ctl-sub">
              Review what goes live, then track spend, leads and status from one clean dashboard.
            </p>
            <div className="hw-ctl-points">
              {CONTROL_POINTS.map((point) => (
                <div key={point} className="hw-ctl-point">
                  <span className="hw-check">✓</span>
                  <span className="hw-ctl-point-label">{point}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dark dashboard */}
          <div data-reveal="up" data-rd="1" className="hw-dash">
            <div className="hw-dash-head">
              <div>
                <div className="hw-dash-title">Control dashboard</div>
                <div className="hw-dash-sub">
                  Every ad in one place · <span className="hw-dash-example">Example data</span>
                </div>
              </div>
              <CtaLink
                location="control_dashboard"
                href="/signup"
                className="hw-btn hw-btn--light hw-dash-cta"
              >
                Create ad
              </CtaLink>
            </div>
            {/* line chart */}
            <div className="hw-dash-chart">
              <div className="hw-dash-chart-head">
                <span className="hw-dash-chart-label">Leads · last 14 days</span>
                <span className="hw-dash-chart-name">Mt Lawley appraisal</span>
              </div>
              <svg
                viewBox="0 0 560 90"
                className="hw-dash-chart-svg"
                preserveAspectRatio="none"
                aria-hidden
              >
                <polyline
                  className="hw-chart-line"
                  pathLength={1}
                  points={CHART_POINTS_DESKTOP}
                  fill="none"
                  stroke="#5F8FCE"
                  strokeWidth="2"
                />
                <line x1="0" y1="88" x2="560" y2="88" stroke="rgba(241,243,244,0.15)" strokeWidth="1" />
              </svg>
            </div>
            {/* table */}
            <div className="hw-dash-table">
              <div className="hw-dash-cols">
                <span>Ad</span>
                <span>Status</span>
                <span className="hw-num-r">Clicks</span>
                <span className="hw-num-r">Leads</span>
                <span className="hw-num-r">Spend</span>
              </div>
              {DASH_ROWS.map((row) => (
                <div key={row.name} className="hw-dash-row">
                  <div>
                    <div className="hw-dash-ad-name">{row.name}</div>
                    <div className="hw-dash-ad-sub">{row.sub}</div>
                  </div>
                  <span>
                    <span className="hw-dash-status" style={{ color: row.statusColor }}>
                      <span className="hw-dash-status-dot" />
                      {row.status}
                    </span>
                  </span>
                  <span className="hw-dash-num">{row.clicks}</span>
                  <span className="hw-dash-num">{row.leads}</span>
                  <span className="hw-dash-num">{row.spend}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopUpdates() {
  return (
    <div className="hw-only hw-sec">
      <div className="hw-sec-in">
        <div data-reveal="up" className="hw-upd-head">
          <div className="hw-kicker">Updates</div>
          <h2 className="hw-h2 hw-h2--34">Updates where agents actually check.</h2>
          <p className="hw-upd-sub">Open Blockwise for the detail. Get the short version by email.</p>
        </div>
        <div className="hw-upd-grid">
          {/* dashboard panel */}
          <div data-reveal="up" data-rd="1" className="hw-upd-dash">
            <div className="hw-upd-dash-head">
              <span className="hw-upd-dash-title">Blockwise dashboard</span>
              <span className="hw-live">
                <span className="hw-live-dot" />
                Live
              </span>
            </div>
            <div className="hw-upd-tiles">
              {DASH_TILES.map((tile) => (
                <div key={tile.label} className="hw-upd-tile">
                  <div className="hw-upd-tile-label">{tile.label}</div>
                  <div className="hw-upd-tile-body">{tile.body}</div>
                  <div className="hw-upd-tile-value" style={{ color: tile.valueColor }}>
                    {tile.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* daily email */}
          <div data-reveal="up" data-rd="2" className="hw-upd-email">
            <div className="hw-upd-email-head">
              <span className="hw-upd-email-title">Daily email</span>
              <span className="hw-tag">Optional</span>
            </div>
            <div className="hw-upd-email-body">
              <div className="hw-upd-email-h">Your ads yesterday</div>
              <div className="hw-upd-email-stats">
                <div className="hw-upd-email-stat">
                  <div className="hw-upd-email-stat-v">6</div>
                  <div className="hw-upd-email-stat-k">New leads</div>
                </div>
                <div className="hw-upd-email-stat">
                  <div className="hw-upd-email-stat-v">$41</div>
                  <div className="hw-upd-email-stat-k">Spend</div>
                </div>
                <div className="hw-upd-email-stat">
                  <div className="hw-upd-email-stat-v">118</div>
                  <div className="hw-upd-email-stat-k">Clicks</div>
                </div>
              </div>
              <div className="hw-upd-email-lines">
                <div className="hw-upd-email-line">
                  <span className="hw-upd-email-bullet" style={{ color: "#3D806A" }}>
                    ●
                  </span>
                  Free appraisal ad is live.
                </div>
                <div className="hw-upd-email-line">
                  <span className="hw-upd-email-bullet" style={{ color: "#315F9B" }}>
                    ●
                  </span>
                  Market update ad needs approval.
                </div>
                <div className="hw-upd-email-line">
                  <span className="hw-upd-email-bullet" style={{ color: "#667383" }}>
                    ●
                  </span>
                  No Ads Manager login needed.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopPropertyCheck() {
  return (
    <div className="hw-only hw-sec hw-sec-tint">
      <div className="hw-sec-in">
        <div className="hw-pc-grid">
          <div data-reveal="up" className="hw-pc-left">
            <div className="hw-kicker">Property Check</div>
            <h2 className="hw-h2 hw-h2--34">Know the property before the call</h2>
            <p className="hw-pc-sub">
              Check zoning, overlays, subdivision potential, renovation limits, and planning red
              flags before speaking to a seller, buyer, or investor.
            </p>
            <div className="hw-pc-uses">
              {PROPERTY_USES.map((use) => (
                <div key={use.title} className="hw-pc-use">
                  <div className="hw-pc-use-title">{use.title}</div>
                  <div className="hw-pc-use-body">{use.body}</div>
                </div>
              ))}
            </div>
            <CtaLink
              location="property_check"
              href="/signup?source=property-check"
              className="hw-textlink hw-pc-link"
            >
              Run a property check <span className="hw-arr">→</span>
            </CtaLink>
          </div>

          {/* Property intelligence panel */}
          <div data-reveal="up" data-rd="1" className="hw-pc-panel">
            <div className="hw-pc-panel-head">
              <div className="hw-pc-address">
                <span className="hw-pc-address-label">14 Sample St, Mt Lawley WA</span>
                <span className="hw-tag">Example</span>
              </div>
              <span className="hw-pc-complete">Check complete</span>
            </div>
            <div className="hw-pc-facts">
              <div>
                <div className="hw-pc-fact-k">Zoning</div>
                <div className="hw-pc-fact-v">R20 / R40</div>
              </div>
              <div>
                <div className="hw-pc-fact-k">Overlays</div>
                <div className="hw-pc-fact-v">Heritage area</div>
              </div>
              <div>
                <div className="hw-pc-fact-k">Subdivision</div>
                <div className="hw-pc-fact-v hw-pc-fact-v--blue">Potential — verify lot width</div>
              </div>
            </div>
            <div className="hw-pc-notes">
              {PROPERTY_NOTES.map((note) => (
                <div key={note.source} className="hw-pc-note">
                  <span className="hw-pc-note-dot" />
                  <div className="hw-pc-note-text">
                    {note.text} <span className="hw-pc-note-source">— {note.source}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hw-pc-panel-foot">
              Source-cited notes for call prep. Always confirm with the local planning authority.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopFreeTrial() {
  return (
    <div className="hw-only hw-sec hw-sec-tint">
      <div data-reveal="up" className="hw-ft-in">
        <div className="hw-kicker">Free trial</div>
        <h2 className="hw-h2">Try Blockwise free for 7 days.</h2>
        <p className="hw-ft-sub">
          No card required. Review your ads and connect your ad account when you are ready for final
          setup.
        </p>
        <CtaLink location="free_trial" href="/signup" className="hw-btn hw-btn--dark hw-ft-cta">
          Start free trial <span className="hw-arr">→</span>
        </CtaLink>
        <div className="hw-ft-stats">
          <div data-reveal="up" data-rd="1" className="hw-ft-stat">
            <div className="hw-ft-stat-h">7 days</div>
            <div className="hw-ft-stat-b">Full access from the minute you confirm your email.</div>
          </div>
          <div data-reveal="up" data-rd="2" className="hw-ft-stat">
            <div className="hw-ft-stat-h">No card</div>
            <div className="hw-ft-stat-b">Nothing charges when the trial ends. Your drafts stay put.</div>
          </div>
          <div data-reveal="up" data-rd="3" className="hw-ft-stat">
            <div className="hw-ft-stat-h">Connect anytime</div>
            <div className="hw-ft-stat-b">Connect your Meta ad account when you are ready.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DesktopManagedSetup() {
  return (
    <div className="hw-only hw-sec">
      <div className="hw-sec-in">
        <div className="hw-ms-grid">
          <div data-reveal="up" className="hw-ms-left">
            <div className="hw-kicker">Managed setup</div>
            <h2 className="hw-h2 hw-h2--34">Want help getting started?</h2>
            <p className="hw-ms-sub">
              Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad
              account and review everything before handoff.
            </p>
            <div className="hw-ms-points">
              <div className="hw-ms-point">
                <span className="hw-check">✓</span>First ads set up with you
              </div>
              <div className="hw-ms-point">
                <span className="hw-check">✓</span>Ad account connected
              </div>
              <div className="hw-ms-point">
                <span className="hw-check">✓</span>Everything reviewed before handoff
              </div>
            </div>
          </div>
          <ManagedSetupForm idPrefix="ms" variant="desktop" />
        </div>
      </div>
    </div>
  );
}

export function DesktopFaq() {
  return (
    <div className="hw-only hw-sec">
      <div className="hw-faq-in">
        <div data-reveal="up" className="hw-kicker">
          Questions
        </div>
        <h2 data-reveal="up" data-rd="1" className="hw-h2 hw-h2--34 hw-faq-h2">
          The bits agents ask about.
        </h2>
        <FaqAccordion idPrefix="faq-d" withReveal />
        <div data-reveal="up" className="hw-faq-banner">
          <div>
            <div className="hw-faq-banner-h">Need a hand getting started?</div>
            <div className="hw-faq-banner-b">
              Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad
              account and get everything ready for final setup.
            </div>
          </div>
          <CtaLink
            location="faq_walkthrough"
            href="#managed-setup"
            className="hw-textlink hw-faq-banner-link"
          >
            Book a walkthrough <span className="hw-arr">→</span>
          </CtaLink>
        </div>
      </div>
    </div>
  );
}

export function DesktopFooter() {
  return (
    <footer className="hw-only hw-footer">
      <div className="hw-footer-in">
        <div data-reveal="up" className="hw-footer-cta-row">
          <h2 className="hw-footer-h2">Your competitors are advertising. Are you?</h2>
          <CtaLink location="footer" href="/signup" className="hw-btn hw-btn--light hw-footer-cta">
            Start free trial <span className="hw-arr">→</span>
          </CtaLink>
        </div>
        <div className="hw-footer-grid">
          <div>
            <div className="hw-footer-logo">
              <span className="hw-footer-logo-mark" />
              <span className="hw-footer-logo-word">blockwise</span>
            </div>
            <p className="hw-footer-blurb">
              The ad platform for real estate teams. Create, approve, export and track property ads
              from one place.
            </p>
            <a className="hw-footer-mail" href="mailto:hello@blockwise.sale">
              hello@blockwise.sale
            </a>
          </div>
          <div>
            <div className="hw-footer-col-h">Product</div>
            <div className="hw-footer-links">
              <a href="#start">How it works</a>
              <a href="#property-check">Property Check</a>
              <a href="#free-trial">Free trial</a>
              <Link href="/pricing">Pricing</Link>
              <Link href="/guides">Guides</Link>
            </div>
          </div>
          <div>
            <div className="hw-footer-col-h">Legal</div>
            <div className="hw-footer-links">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/data-deletion">Data deletion</Link>
            </div>
          </div>
        </div>
        <div className="hw-footer-legal">
          © 2026 Blockwise. All rights reserved. Blockwise is operated by SHELLEY, STEVEN JOHN.
        </div>
      </div>
    </footer>
  );
}
