import Link from "next/link";

import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";

import {
  CHART_POINTS_MOBILE,
  CONTROL_POINTS,
  DASH_ROWS,
  DASH_TILES,
  HERO_RAIL,
  PROPERTY_NOTES,
  PROPERTY_USES,
  RADAR_ADS,
  STUCK_TASKS,
} from "./data";
import { FaqAccordion } from "./faq-accordion";
import { ManagedSetupForm } from "./managed-setup-form";
import { MobileHeroForm } from "./mobile-hero-form";

/**
 * Mobile tree of the homepage redesign (<768px), a 1:1 recreation of
 * `Blockwise Homepage Mobile.dc.html` — a separately designed layout, not a
 * squished desktop. Hidden at ≥768px where the desktop tree takes over.
 */

function MobileTemplateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="#315F9B" strokeWidth="1.5" />
      <line x1="1" y1="6.5" x2="17" y2="6.5" stroke="#315F9B" strokeWidth="1.5" />
      <line x1="9" y1="6.5" x2="9" y2="17" stroke="#315F9B" strokeWidth="1.5" />
    </svg>
  );
}

function MobileRadarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="#315F9B" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.5" fill="#315F9B" />
    </svg>
  );
}

function MobileFbAd({
  copy,
  angle,
  photoSrc,
}: {
  copy: string;
  angle: string;
  photoSrc: string;
}) {
  return (
    <div className="hwm-fbad">
      <div className="hw-fbad-head">
        <span className="hw-fbad-avatar">YA</span>
        <div>
          <div className="hw-fbad-agency">Your Agency</div>
          <div className="hw-fbad-sponsored">Sponsored</div>
        </div>
      </div>
      <div className="hw-fbad-copy">{copy}</div>
      <div className="hwm-fbad-photo">
        <img className="hw-img-cover" src={photoSrc} alt="" />
      </div>
      <div className="hwm-fbad-foot">
        <div className="hwm-fbad-angle">{angle}</div>
        <span className="hwm-fbad-btn">Learn more</span>
      </div>
    </div>
  );
}

export function MobileHeader() {
  return (
    <header className="hwm-only hwm-header">
      <div className="hwm-header-in">
        <a href="#top" className="hwm-logo">
          <span className="hwm-logo-mark" />
          <span className="hwm-logo-word">blockwise</span>
        </a>
        <div className="hwm-header-actions">
          <SignInLink className="hwm-login" />
          <CtaLink
            location="m_header"
            href="/signup"
            className="hw-btn hw-btn--outline hwm-header-cta"
          >
            Start free trial
          </CtaLink>
        </div>
      </div>
    </header>
  );
}

export function MobileHero() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-hero">
          <div className="hwm-kicker">Meta ads for real estate agents</div>
          <h1 className="hwm-h1">Your competitors are advertising. Are&nbsp;you?</h1>
          <p className="hwm-hero-sub">
            Ads built from what&rsquo;s actually working in your area. Start getting leads today.
          </p>
          <MobileHeroForm />

          {/* Prepared-ad review interface */}
          <div className="hwm-panel-dark hwm-hero-review">
            <div className="hwm-panel-head">
              <div className="hwm-panel-status">
                <span className="hwm-dot" />
                <span className="hwm-panel-status-label">Ready for review</span>
              </div>
              <span className="hwm-panel-tag">Seller leads</span>
            </div>
            <MobileFbAd
              copy="Thinking of selling? Find out what your home could be worth with a free appraisal."
              angle="Free appraisal"
              photoSrc="/home/home-dusk.webp"
            />
            <div className="hwm-rail">
              {HERO_RAIL.map((row) => (
                <div key={row.k} className="hwm-rail-row">
                  <span className="hwm-rail-k">{row.k}</span>
                  <span className="hwm-rail-v">{row.v}</span>
                </div>
              ))}
              <div className="hwm-rail-cta-row">
                <CtaLink
                  location="m_hero_approve"
                  href="/signup"
                  className="hw-btn hw-btn--light hwm-rail-cta"
                >
                  Approve
                </CtaLink>
              </div>
              <div className="hwm-panel-note">Nothing spends until you approve.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileSignal() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec">
          <div className="hwm-kicker hwm-kicker--blue">From signal to ad</div>
          <h2 className="hwm-h2">Don&rsquo;t start from a blank page.</h2>
          <p className="hwm-sub">
            Start from a proven template — or from an ad approach already working in your suburb.
            Blockwise fits it to your listing and brand, ready to approve.
          </p>

          {/* Use a template */}
          <div className="hwm-sig-card">
            <div className="hwm-sig-card-head">
              <span className="hwm-sig-icon">
                <MobileTemplateIcon />
              </span>
              <div>
                <div className="hwm-sig-card-title">Use a template</div>
                <div className="hwm-sig-card-sub">Choose a ready-made ad and add your listing.</div>
              </div>
            </div>
            <div className="hwm-sig-tabs">
              <span className="hwm-sig-tab hwm-sig-tab--active">All templates</span>
              <span className="hwm-sig-tab">Property</span>
              <span className="hwm-sig-tab">Auction</span>
              <span className="hwm-sig-tab">Lifestyle</span>
              <span className="hwm-sig-tab">Brand</span>
            </div>
            <div className="hwm-tpl-grid">
              <div className="hwm-tpl hwm-tpl--dark">
                <div className="hwm-tpl-brand">Your Agency</div>
                <div className="hwm-tpl-h--light">Thinking of selling?</div>
                <div className="hwm-tpl-body">Find out what your home could be worth.</div>
                <span className="hwm-tpl-pill hwm-tpl-pill--outline">Free appraisal</span>
              </div>
              <div className="hwm-tpl hwm-tpl--photo">
                <img className="hw-img-cover" src="/home/home-pool.webp" alt="" />
              </div>
              <div className="hwm-tpl hwm-tpl--light">
                <div className="hwm-tpl-brand">Your Agency</div>
                <div className="hwm-tpl-h--dark">Auction Saturday 2pm</div>
                <div className="hwm-tpl-body">On-site · Registration from 1.30pm</div>
                <span className="hwm-tpl-pill hwm-tpl-pill--solid">View property</span>
              </div>
              <div className="hwm-tpl hwm-tpl--photo">
                <img className="hw-img-cover" src="/home/interior-styled.webp" alt="" />
              </div>
            </div>
          </div>

          {/* Start from your suburb */}
          <div className="hwm-sig-card">
            <div className="hwm-sig-card-head">
              <span className="hwm-sig-icon">
                <MobileRadarIcon />
              </span>
              <div>
                <div className="hwm-sig-card-title">Start from your suburb</div>
                <div className="hwm-sig-card-sub">See what&rsquo;s already working nearby.</div>
              </div>
            </div>
            <div className="hwm-radar-row">
              {RADAR_ADS.map((ad) => (
                <div key={ad.angle} className="hwm-radar-card">
                  <div className="hwm-radar-head">
                    <span className="hwm-radar-avatar">YA</span>
                    <div>
                      <div className="hwm-radar-agency">{ad.agency}</div>
                      <div className="hwm-radar-sponsored">Sponsored</div>
                    </div>
                  </div>
                  <div className="hwm-radar-copy">{"copyMobile" in ad ? ad.copyMobile : ad.copy}</div>
                  <div className="hwm-radar-photo">
                    <img className="hw-img-cover" src={ad.src} alt="" />
                  </div>
                  <div className="hwm-radar-foot">{ad.angle}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="hwm-sig-arrow" aria-hidden>
            ↓
          </div>

          {/* Ready to review */}
          <div className="hwm-panel-dark">
            <div className="hwm-panel-head">
              <div className="hwm-panel-status">
                <span className="hwm-dot" />
                <span className="hwm-panel-status-label">Ready to review</span>
              </div>
              <span className="hwm-panel-tag">Your listing</span>
            </div>
            <MobileFbAd
              copy="Thinking of selling? Find out what your Mt Lawley home could be worth with a free appraisal."
              angle="Free appraisal"
              photoSrc="/home/home-dusk.webp"
            />
            <CtaLink
              location="m_signal_review"
              href="/signup"
              className="hw-btn hw-btn--light hwm-wf-cta"
            >
              Create my ad
            </CtaLink>
            <div className="hwm-panel-note">Nothing spends until you approve.</div>
          </div>
          <p className="hwm-sig-disclaimer">
            Nearby-ad examples show activity signals, not results. What runs is always your call.
          </p>
        </div>
      </div>
    </div>
  );
}

export function MobileWorkflow() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec">
          <div className="hwm-kicker">Meta ads for real estate agents</div>
          <h2 className="hwm-h2">
            Too much time is wasted on ads. Not enough time is spent with clients.
          </h2>
          <p className="hwm-sub" style={{ marginBottom: 32 }}>
            Blockwise handles the setup, creative, approvals and updates so agents can stay out of
            Ads Manager.
          </p>

          <div className="hwm-wf-steps">
            <div>
              <div className="hwm-wf-step-head">
                <span className="hwm-wf-num">1</span>
                <span className="hwm-wf-step-title">Ad work agents get stuck doing</span>
              </div>
              <div className="hwm-wf-list">
                {STUCK_TASKS.map((task) => (
                  <div key={task.name} className="hwm-wf-task">
                    <div>
                      <div className="hwm-wf-task-name">{task.name}</div>
                      <div className="hwm-wf-task-sub">{task.sub}</div>
                    </div>
                    <span className="hwm-wf-task-status">{task.status}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="hwm-wf-step-head">
                <span className="hwm-wf-num">2</span>
                <span className="hwm-wf-step-title">Blockwise prepares it</span>
              </div>
              <div className="hwm-wf-panel">
                <div className="hwm-wf-panel-head">
                  <div className="hwm-wf-panel-status">
                    <span className="hwm-dot" />
                    <span className="hwm-wf-panel-label">Ready for review</span>
                  </div>
                  <span className="hwm-panel-tag">Seller leads</span>
                </div>
                {HERO_RAIL.map((row) => (
                  <div key={row.k} className="hwm-rail-row" style={{ padding: "8px 0" }}>
                    <span className="hwm-rail-k">{row.k}</span>
                    <span className="hwm-rail-v">{row.v}</span>
                  </div>
                ))}
                <CtaLink
                  location="m_workflow_approve"
                  href="/signup"
                  className="hw-btn hw-btn--light hwm-wf-cta"
                >
                  Approve
                </CtaLink>
              </div>
            </div>
            <div>
              <div className="hwm-wf-step-head">
                <span className="hwm-wf-num">3</span>
                <span className="hwm-wf-step-title">Then updates are sent</span>
              </div>
              <div className="hwm-wf-card">
                <div className="hwm-wf-card-head">
                  <span className="hwm-wf-card-title">Daily update</span>
                  <span className="hwm-pc-tag">Example</span>
                </div>
                <div className="hwm-wf-stat">
                  <span className="hwm-wf-stat-k">Leads</span>
                  <span className="hwm-wf-stat-v">12</span>
                </div>
                <div className="hwm-wf-stat">
                  <span className="hwm-wf-stat-k">Spend</span>
                  <span className="hwm-wf-stat-v">$86</span>
                </div>
                <div className="hwm-wf-stat">
                  <span className="hwm-wf-stat-k">Best angle</span>
                  <span className="hwm-wf-stat-v hwm-wf-stat-v--sm">Free appraisal</span>
                </div>
                <div className="hwm-wf-email">
                  <div className="hwm-wf-email-h">Daily email sent</div>
                  <div className="hwm-wf-email-b">
                    Leads, spend and best angle summarized — without logging into Ads Manager.
                  </div>
                </div>
              </div>
            </div>
          </div>
          <CtaLink location="m_workflow" href="/signup" className="hwm-textlink hwm-wf-link">
            Get your first ad prepared <span className="hw-arr">→</span>
          </CtaLink>
        </div>
      </div>
    </div>
  );
}

export function MobileDoneForYou() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec">
          <h2 className="hwm-dfy-h2">
            Prepared.
            <br />
            Checked.
            <br />
            Sent.
          </h2>
          <p className="hwm-sub">One approval replaces the setup work.</p>

          <div className="hwm-dfy-card">
            {/* Dark header bar */}
            <div className="hwm-dfy-bar">
              <span className="hwm-dot" />
              <span className="hwm-dfy-bar-label">Seller lead ad · Ready for review</span>
            </div>
            <div className="hwm-dfy-body">
              {/* Checklist */}
              <div className="hwm-dfy-checklist">
                {(
                  [
                    ["Copy", "Prepared"],
                    ["Creative", "Fitted"],
                    ["Lead form", "Ready"],
                    ["Budget", "$25/day"],
                    ["Timing", "Set"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="hwm-dfy-check">
                    <span className="hwm-dfy-check-k">{k}</span>
                    <span className="hwm-dfy-check-v">{v}</span>
                  </div>
                ))}
              </div>
              {/* Ad preview */}
              <div className="hwm-dfy-ad">
                <div className="hw-fbad-head">
                  <span className="hw-fbad-avatar">YA</span>
                  <div>
                    <div className="hw-fbad-agency">Your Agency</div>
                    <div className="hw-fbad-sponsored">Sponsored</div>
                  </div>
                  <span className="hw-fbad-menu">···</span>
                </div>
                <div className="hw-fbad-copy">
                  Wondering what your home is worth? Book a free, no-obligation appraisal this week.
                </div>
                <div className="hwm-dfy-ad-photo">
                  <img className="hw-img-cover" src="/home/mt-lawley-federation.webp" alt="" />
                </div>
                <div className="hwm-dfy-ad-foot">
                  <div>
                    <div className="hwm-dfy-domain">youragency.com</div>
                    <div className="hwm-dfy-foot-h">Free home appraisal</div>
                    <div className="hwm-dfy-foot-sub">Local experts. No obligation.</div>
                  </div>
                  <span className="hwm-dfy-ad-btn">Learn more</span>
                </div>
              </div>
              <CtaLink
                location="m_done_for_you_approve"
                href="/signup"
                className="hw-btn hw-btn--dark hwm-dfy-approve"
              >
                Approve
              </CtaLink>
            </div>
            {/* Perforation + daily update */}
            <div className="hwm-dfy-perforation" />
            <div className="hwm-dfy-strip">
              <div className="hwm-dfy-strip-label">Daily update sent</div>
              <div className="hwm-dfy-stats">
                <div className="hwm-dfy-stat">
                  <div className="hwm-dfy-stat-v">12</div>
                  <div className="hwm-dfy-stat-k">leads</div>
                </div>
                <div className="hwm-dfy-stat">
                  <div className="hwm-dfy-stat-v">$86</div>
                  <div className="hwm-dfy-stat-k">spend</div>
                </div>
                <div className="hwm-dfy-stat hwm-dfy-stat--pad">
                  <div className="hwm-dfy-stat-k hwm-dfy-stat-k--top">Best angle</div>
                  <div className="hwm-dfy-stat-best">Free appraisal</div>
                </div>
              </div>
              <div className="hwm-dfy-strip-note">Nothing spends before approval.</div>
            </div>
          </div>
          <CtaLink location="m_done_for_you" href="/signup" className="hwm-textlink hwm-dfy-link">
            Get your first ad prepared <span className="hw-arr">→</span>
          </CtaLink>
        </div>
      </div>
    </div>
  );
}

export function MobilePropertyCheck() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec hwm-sec--tint">
          <div className="hwm-kicker">Property Check</div>
          <h2 className="hwm-h2">Know the property before the call</h2>
          <p className="hwm-sub" style={{ marginBottom: 20, lineHeight: 1.6 }}>
            Check zoning, overlays, subdivision potential, renovation limits, and planning red flags
            before speaking to a seller, buyer, or investor.
          </p>

          <div className="hwm-pc-panel">
            <div className="hwm-pc-panel-head">
              <span className="hwm-pc-address">14 Sample St, Mt Lawley WA</span>
              <span className="hwm-pc-tag">Example</span>
            </div>
            <div className="hwm-pc-facts">
              <div>
                <div className="hwm-pc-fact-k">Zoning</div>
                <div className="hwm-pc-fact-v">R20 / R40</div>
              </div>
              <div>
                <div className="hwm-pc-fact-k">Overlays</div>
                <div className="hwm-pc-fact-v">Heritage area</div>
              </div>
              <div className="hwm-pc-fact--wide">
                <div className="hwm-pc-fact-k">Subdivision</div>
                <div className="hwm-pc-fact-v hwm-pc-fact-v--blue">Potential — verify lot width</div>
              </div>
            </div>
            <div className="hwm-pc-notes">
              {PROPERTY_NOTES.map((note) => (
                <div key={note.source} className="hwm-pc-note">
                  <span className="hwm-pc-note-dot" />
                  <div className="hwm-pc-note-text">
                    {note.text} <span className="hwm-pc-note-source">— {note.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hwm-pc-uses">
            {PROPERTY_USES.map((use) => (
              <div key={use.title} className="hwm-pc-use">
                <div className="hwm-pc-use-title">{use.title}</div>
                <div className="hwm-pc-use-body">{use.body}</div>
              </div>
            ))}
          </div>
          <CtaLink
            location="m_property_check"
            href="/signup?source=property-check"
            className="hwm-textlink hwm-pc-link"
          >
            Run a property check <span className="hw-arr">→</span>
          </CtaLink>
        </div>
      </div>
    </div>
  );
}

export function MobileControl() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec">
          <div className="hwm-kicker">Approval and control</div>
          <h2 className="hwm-h2">You stay in control before and after approval.</h2>
          <p className="hwm-sub" style={{ marginBottom: 18, lineHeight: 1.6 }}>
            Review what goes live, then track spend, leads and status from one clean dashboard.
          </p>
          <div className="hwm-ctl-points">
            {CONTROL_POINTS.map((point) => (
              <div key={point} className="hwm-ctl-point">
                <span className="hw-check">✓</span>
                <span className="hwm-ctl-point-label">{point}</span>
              </div>
            ))}
          </div>

          <div className="hwm-panel-dark">
            <div className="hwm-dash-head">
              <div>
                <div className="hwm-dash-title">Control dashboard</div>
                <div className="hwm-dash-sub">Example data</div>
              </div>
              <CtaLink
                location="m_control_dashboard"
                href="/signup"
                className="hw-btn hw-btn--light hwm-dash-cta"
              >
                Create ad
              </CtaLink>
            </div>
            <svg
              viewBox="0 0 560 80"
              className="hwm-dash-chart"
              preserveAspectRatio="none"
              aria-hidden
            >
              <polyline
                points={CHART_POINTS_MOBILE}
                fill="none"
                stroke="#5F8FCE"
                strokeWidth="2"
              />
              <line x1="0" y1="78" x2="560" y2="78" stroke="rgba(241,243,244,0.15)" strokeWidth="1" />
            </svg>
            {DASH_ROWS.map((row) => (
              <div key={row.name} className="hwm-dash-row">
                <div className="hwm-dash-row-top">
                  <div className="hwm-dash-ad-name">{row.name}</div>
                  <span className="hw-dash-status" style={{ color: row.statusColor }}>
                    <span className="hw-dash-status-dot" />
                    {row.status}
                  </span>
                </div>
                <div className="hwm-dash-metrics">
                  <span>{row.clicks} clicks</span>
                  <span>{row.leads} leads</span>
                  <span>{row.spend} spend</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileUpdates() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec">
          <div className="hwm-kicker">Updates</div>
          <h2 className="hwm-h2" style={{ marginBottom: 10 }}>
            Updates where agents actually check.
          </h2>
          <p className="hwm-sub">Open Blockwise for the detail. Get the short version by email.</p>

          <div className="hwm-upd-stack">
            <div className="hwm-upd-email">
              <div className="hwm-upd-email-head">
                <span className="hwm-upd-email-title">Daily email</span>
                <span className="hw-tag">Optional</span>
              </div>
              <div className="hwm-upd-email-body">
                <div className="hwm-upd-email-h">Your ads yesterday</div>
                <div className="hwm-upd-email-stats">
                  <div className="hwm-upd-email-stat">
                    <div className="hwm-upd-email-stat-v">6</div>
                    <div className="hwm-upd-email-stat-k">New leads</div>
                  </div>
                  <div className="hwm-upd-email-stat">
                    <div className="hwm-upd-email-stat-v">$41</div>
                    <div className="hwm-upd-email-stat-k">Spend</div>
                  </div>
                  <div className="hwm-upd-email-stat">
                    <div className="hwm-upd-email-stat-v">118</div>
                    <div className="hwm-upd-email-stat-k">Clicks</div>
                  </div>
                </div>
                <div className="hwm-upd-email-lines">
                  <div className="hwm-upd-email-line">
                    <span className="hwm-upd-email-bullet" style={{ color: "#3D806A" }}>
                      ●
                    </span>
                    Free appraisal ad is live.
                  </div>
                  <div className="hwm-upd-email-line">
                    <span className="hwm-upd-email-bullet" style={{ color: "#315F9B" }}>
                      ●
                    </span>
                    Market update ad needs approval.
                  </div>
                  <div className="hwm-upd-email-line">
                    <span className="hwm-upd-email-bullet" style={{ color: "#667383" }}>
                      ●
                    </span>
                    No Ads Manager login needed.
                  </div>
                </div>
              </div>
            </div>
            <div className="hwm-panel-dark">
              <div className="hwm-upd-dash-head">
                <span className="hwm-upd-dash-title">Blockwise dashboard</span>
                <span className="hw-live">
                  <span className="hw-live-dot" />
                  Live
                </span>
              </div>
              <div className="hwm-upd-tiles">
                {DASH_TILES.map((tile) => (
                  <div key={tile.label} className="hwm-upd-tile">
                    <div className="hwm-upd-tile-label">{tile.label}</div>
                    <div className="hwm-upd-tile-body">{tile.body}</div>
                    <div className="hwm-upd-tile-value" style={{ color: tile.valueColor }}>
                      {tile.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileFreeTrial() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec hwm-sec--tint hwm-ft">
          <div className="hwm-kicker">Free trial</div>
          <h2 className="hwm-h2 hwm-ft-h2">Try Blockwise free for 7 days.</h2>
          <p className="hwm-sub hwm-ft-sub">
            No card required. Review your ads and connect your ad account when you are ready for
            final setup.
          </p>
          <CtaLink location="m_free_trial" href="/signup" className="hw-btn hw-btn--dark hwm-ft-cta">
            Start free trial <span className="hw-arr">→</span>
          </CtaLink>
          <div className="hwm-ft-stats">
            <div className="hwm-ft-stat">
              <div className="hwm-ft-stat-h">7 days</div>
              <div className="hwm-ft-stat-b">Full access from the minute you confirm your email.</div>
            </div>
            <div className="hwm-ft-stat">
              <div className="hwm-ft-stat-h">No card</div>
              <div className="hwm-ft-stat-b">
                Nothing charges when the trial ends. Your drafts stay put.
              </div>
            </div>
            <div className="hwm-ft-stat">
              <div className="hwm-ft-stat-h">Connect anytime</div>
              <div className="hwm-ft-stat-b">Connect your Meta ad account when you are ready.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileManagedSetup() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec">
          <div className="hwm-kicker">Managed setup</div>
          <h2 className="hwm-h2">Want help getting started?</h2>
          <p className="hwm-sub" style={{ lineHeight: 1.6 }}>
            Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad account
            and review everything before handoff.
          </p>
          <ManagedSetupForm idPrefix="msm" variant="mobile" />
        </div>
      </div>
    </div>
  );
}

export function MobileFaq() {
  return (
    <div className="hwm-only">
      <div className="hwm-shell">
        <div className="hwm-sec hwm-faq">
          <div className="hwm-kicker">Questions</div>
          <h2 className="hwm-h2 hwm-faq-h2">The bits agents ask about.</h2>
          <FaqAccordion idPrefix="faq-m" labelClassName="hwm-faq-q-label" />
          <div className="hwm-faq-banner">
            <div className="hwm-faq-banner-h">Need a hand getting started?</div>
            <div className="hwm-faq-banner-b">
              Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad
              account and get everything ready for final setup.
            </div>
            <CtaLink
              location="m_faq_walkthrough"
              href="#managed-setup"
              className="hwm-textlink hwm-faq-banner-link"
            >
              Book a walkthrough <span className="hw-arr">→</span>
            </CtaLink>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileFooter() {
  return (
    <footer className="hwm-only hwm-footer">
      <div className="hwm-footer-in">
        <h2 className="hwm-footer-h2">Your competitors are advertising. Are you?</h2>
        <CtaLink location="m_footer" href="/signup" className="hw-btn hw-btn--light hwm-footer-cta">
          Start free trial <span className="hw-arr">→</span>
        </CtaLink>
        <div className="hwm-footer-body">
          <div className="hwm-footer-logo">
            <span className="hwm-footer-logo-mark" />
            <span className="hwm-footer-logo-word">blockwise</span>
          </div>
          <p className="hwm-footer-blurb">
            The ad platform for real estate teams. Create, approve, export and track property ads
            from one place.
          </p>
          <a className="hwm-footer-mail" href="mailto:hello@blockwise.sale">
            hello@blockwise.sale
          </a>
          <div className="hwm-footer-grid">
            <div>
              <div className="hwm-footer-col-h">Product</div>
              <div className="hwm-footer-links">
                <a href="#workflow">How it works</a>
                <a href="#property-check">Property Check</a>
                <a href="#free-trial">Free trial</a>
                <Link href="/pricing">Pricing</Link>
              </div>
            </div>
            <div>
              <div className="hwm-footer-col-h">Legal</div>
              <div className="hwm-footer-links">
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
                <Link href="/data-deletion">Data deletion</Link>
              </div>
            </div>
          </div>
          <div className="hwm-footer-legal">
            © 2026 Blockwise. All rights reserved. Blockwise is operated by SHELLEY, STEVEN JOHN.
          </div>
        </div>
      </div>
    </footer>
  );
}
