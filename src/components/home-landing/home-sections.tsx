import { Fragment, type CSSProperties } from "react";

import { CtaLink } from "@/components/landing/cta-link";
import { InView } from "@/components/motion";

import {
  CHART_POINTS,
  CONTROL_POINTS,
  DASH_ROWS,
  HERO_RAIL,
  PROPERTY_NOTES,
  PROPERTY_USES,
} from "./data";
import { FbAdCard } from "./fb-ad-card";
import { FaqAccordion } from "./faq-accordion";
import { ManagedSetupForm } from "./managed-setup-form";
import { StartStudio } from "./start-studio";
import { SuburbReportLocationForm } from "./suburb-report-location-form";

/* ---------- 6.2 #top — Hero (photographic fold) ---------- */

export function Hero() {
  return (
    <div className="hw-hero">
      <img
        className="hw-hero-bg"
        src="/home/home-dusk.webp"
        alt=""
        aria-hidden
        fetchPriority="high"
      />
      <div className="hw-hero-scrim" aria-hidden />
      <div className="hw-wide hw-hero-grid">
        <div className="hw-hero-copy">
          <p className="hw-eyebrow">Meta ads for real estate agents</p>
          <h1 className="hw-h1">Your competitors are advertising. Are&nbsp;you?</h1>
          <p className="hw-lede">
            Ads built from what&rsquo;s actually working in your area. Start getting leads today.
          </p>
          <div className="hw-hero-form">
            <SuburbReportLocationForm analyticsLocation="hero" />
          </div>
        </div>
        <div className="hw-hero-review">
          <p className="hw-status">
            <span className="hw-status-dot" aria-hidden />
            Ready to review
          </p>
          <FbAdCard
            copy="Thinking of selling? Find out what your home could be worth with a free property appraisal."
            photoSrc="/home/interior-styled.webp"
            domain="YOURAGENCY.COM.AU"
            footHeading="Find out what your home could be worth"
            footSub="Book a free property appraisal"
          />
          <p className="hw-note">Nothing spends until you approve.</p>
        </div>
      </div>
      <p className="hw-plate">Mt Lawley, WA · Seller-lead ad · Example</p>
    </div>
  );
}

/* ---------- 6.3 #start — The start studio (client island) ---------- */

export function StartBand() {
  return <StartStudio />;
}

/* ---------- 6.4 #workflow — Merged headline + approval panel ----------
   The "too much time" promise and the "prepared, checked, sent" proof live in
   one fold: the headline cascades word-by-word on the left while the approval
   panel (ad preview + checklist + single Approve action) springs up on the
   right. Entrance motion is driven by the shared InView `.is-in` hook and
   honors prefers-reduced-motion in homepage.css. */

const WORKFLOW_HEADLINE: ReadonlyArray<{ w: string; hl?: boolean }> = [
  { w: "Too" },
  { w: "much" },
  { w: "time" },
  { w: "is" },
  { w: "wasted" },
  { w: "on" },
  { w: "ads.", hl: true },
  { w: "Not" },
  { w: "enough" },
  { w: "time" },
  { w: "is" },
  { w: "spent" },
  { w: "with" },
  { w: "clients.", hl: true },
];

export function WorkflowBand() {
  return (
    <div className="hw-fold hw-wf">
      <InView className="hw-wide hw-wf-grid" threshold={0.18}>
        <div className="hw-wf-copy">
          <h2 className="hw-wf-h2">
            {WORKFLOW_HEADLINE.map((word, i) => (
              <Fragment key={`${word.w}-${i}`}>
                <span
                  className={word.hl ? "hw-wf-w hw-wf-w--hl" : "hw-wf-w"}
                  style={{ "--i": i } as CSSProperties}
                >
                  {word.w}
                </span>{" "}
              </Fragment>
            ))}
          </h2>
          <p className="hw-sub">
            Blockwise handles the setup, creative, approvals and updates so agents can stay out of
            Ads Manager.
          </p>
          <CtaLink location="workflow" href="/signup" className="hw-textlink hw-wf-cta">
            Get your first ad prepared <span className="hw-arr">→</span>
          </CtaLink>
        </div>
        <div className="hw-wf-panel">
          <p className="hw-status hw-status--ink">
            <span className="hw-status-dot" aria-hidden />
            Seller lead ad · Ready for review
          </p>
          <FbAdCard
            copy="Wondering what your home is worth? Book a free, no-obligation appraisal this week."
            photoSrc="/home/mt-lawley-federation.webp"
            domain="youragency.com"
            footHeading="Free home appraisal"
            footSub="Local experts. No obligation."
          />
          <dl className="hw-spec hw-wf-spec">
            {HERO_RAIL.map((row, i) => (
              <div className="hw-spec-row" key={row.k} style={{ "--i": i } as CSSProperties}>
                <dt>{row.k}</dt>
                <dd>{row.v}</dd>
              </div>
            ))}
          </dl>
          <CtaLink
            location="done_for_you_approve"
            href="/signup"
            className="hw-btn hw-btn--dark hw-wf-approve"
          >
            Approve
          </CtaLink>
          <p className="hw-note">Nothing spends before approval.</p>
        </div>
      </InView>
    </div>
  );
}

/* ---------- 6.6 #control — The dark fold ---------- */

export function ControlFold() {
  return (
    <div className="hw-fold hw-control">
      <div className="hw-wide hw-control-grid">
        <div className="hw-control-rail">
          <h2>You stay in control before and after approval.</h2>
          <p className="hw-sub">
            Review what goes live, then track spend, leads and status from one clean dashboard.
          </p>
          <ul className="hw-control-points">
            {CONTROL_POINTS.map((point) => (
              <li key={point}>
                <span className="hw-check" aria-hidden>
                  ✓
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className="hw-dash">
          <div className="hw-dash-head">
            <span className="hw-dash-head-l">
              <span className="hw-dash-title">Control dashboard</span>
              <span className="hw-dash-sub">Every ad in one place · Example data</span>
            </span>
            <CtaLink location="control_dashboard" href="/signup" className="hw-btn hw-btn--light">
              Create ad
            </CtaLink>
          </div>
          <div className="hw-dash-chart">
            <div className="hw-dash-chart-labels">
              <span>Leads · last 14 days</span>
              <span>Mt Lawley appraisal</span>
            </div>
            <svg viewBox="0 0 560 90" preserveAspectRatio="none" aria-hidden className="hw-dash-svg">
              <line x1="0" y1="89" x2="560" y2="89" stroke="var(--hw-inv-line)" strokeWidth="1" />
              <polyline
                points={CHART_POINTS}
                fill="none"
                stroke="#f6f7f9"
                strokeOpacity="0.9"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="hw-dash-table">
            <div className="hw-dash-row hw-dash-row--head">
              <span>Ad</span>
              <span>Status</span>
              <span className="hw-dash-col-clicks">Clicks</span>
              <span>Leads</span>
              <span>Spend</span>
            </div>
            {DASH_ROWS.map((row) => (
              <div className="hw-dash-row" key={row.name}>
                <span className="hw-dash-name">
                  <span className="hw-dash-name-h">{row.name}</span>
                  <span className="hw-dash-name-sub">{row.sub}</span>
                </span>
                <span className={`hw-dash-status hw-dash-status--${row.tone}`}>
                  <span className="hw-dash-dot" aria-hidden />
                  {row.status}
                </span>
                <span className="hw-dash-num hw-dash-col-clicks">{row.clicks}</span>
                <span className="hw-dash-num">{row.leads}</span>
                <span className="hw-dash-num">{row.spend}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 6.7 #updates — Daily email band ---------- */

export function Updates() {
  return (
    <div className="hw-band hw-updates">
      <h2>Updates where agents actually check.</h2>
      <p className="hw-sub">Open Blockwise for the detail. Get the short version by email.</p>
      <div className="hw-email">
        <div className="hw-email-head">
          <span className="hw-email-head-h">Daily email</span>
          <span className="hw-tag">Optional</span>
        </div>
        <p className="hw-email-title">Your ads yesterday</p>
        <div className="hw-email-stats">
          <span className="hw-email-stat">
            <span className="hw-email-stat-v">6</span>
            <span className="hw-email-stat-k">New leads</span>
          </span>
          <span className="hw-email-stat">
            <span className="hw-email-stat-v">$41</span>
            <span className="hw-email-stat-k">Spend</span>
          </span>
          <span className="hw-email-stat">
            <span className="hw-email-stat-v">118</span>
            <span className="hw-email-stat-k">Clicks</span>
          </span>
        </div>
        <div className="hw-email-lines">
          <p className="hw-email-line">
            <span className="hw-line-dot hw-line-dot--success" aria-hidden />
            Free appraisal ad is live.
          </p>
          <p className="hw-email-line">
            <span className="hw-line-dot hw-line-dot--warning" aria-hidden />
            Market update ad needs approval.
          </p>
          <p className="hw-email-line">
            <span className="hw-line-dot hw-line-dot--faint" aria-hidden />
            No Ads Manager login needed.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- 6.8 #property-check — Tinted split band ---------- */

export function PropertyCheck() {
  return (
    <div className="hw-fold hw-pc">
      <div className="hw-wide hw-pc-grid">
        <div className="hw-pc-copy">
          <h2>Know the property before the call</h2>
          <p className="hw-sub">
            Check zoning, overlays, subdivision potential, renovation limits, and planning red
            flags before speaking to a seller, buyer, or investor.
          </p>
          <div className="hw-pc-uses">
            {PROPERTY_USES.map((use) => (
              <div className="hw-pc-use" key={use.title}>
                <h3>{use.title}</h3>
                <p>{use.body}</p>
              </div>
            ))}
          </div>
          <CtaLink
            location="property_check"
            href="/signup?source=property-check"
            className="hw-textlink"
          >
            Run a property check <span className="hw-arr">→</span>
          </CtaLink>
        </div>
        <div className="hw-pc-panel">
          <div className="hw-pc-panel-head">
            <span className="hw-pc-panel-addr">
              14 Sample St, Mt Lawley WA <span className="hw-tag">Example</span>
            </span>
            <span className="hw-pc-panel-status">Check complete</span>
          </div>
          <div className="hw-pc-facts">
            <span className="hw-pc-fact">
              <span className="hw-pc-fact-k">Zoning</span>
              <span className="hw-pc-fact-v">R20 / R40</span>
            </span>
            <span className="hw-pc-fact">
              <span className="hw-pc-fact-k">Overlays</span>
              <span className="hw-pc-fact-v">Heritage area</span>
            </span>
            <span className="hw-pc-fact">
              <span className="hw-pc-fact-k">Subdivision</span>
              <span className="hw-pc-fact-v hw-pc-fact-v--warning">Potential — verify lot width</span>
            </span>
          </div>
          <ul className="hw-pc-notes">
            {PROPERTY_NOTES.map((note) => (
              <li key={note.text}>
                <span className="hw-line-dot hw-line-dot--faint" aria-hidden />
                <span>
                  {note.text} — <span className="hw-pc-note-src">{note.source}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="hw-pc-panel-foot">
            Source-cited notes for call prep. Always confirm with the local planning authority.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- 6.9 #free-trial + #managed-setup ---------- */

export function FreeTrial() {
  return (
    <div className="hw-band hw-band--wide hw-trial">
      <h2>Create three complete ads free.</h2>
      <p className="hw-sub">
        Start with only your email. Build and review three Feed + Story ad packs before connecting
        Meta or adding a card.
      </p>
      <CtaLink location="free_trial" href="/signup" className="hw-btn hw-btn--dark">
        Continue with email <span className="hw-arr">→</span>
      </CtaLink>
      <div className="hw-trial-facts">
        <div className="hw-trial-fact">
          <h3>Three complete ads</h3>
          <p>Each includes a finished Feed and Story creative.</p>
        </div>
        <div className="hw-trial-fact">
          <h3>No card</h3>
          <p>Add payment details only when you choose to run a campaign.</p>
        </div>
        <div className="hw-trial-fact">
          <h3>One live setup free</h3>
          <p>Your Meta ad spend is always paid separately to Meta.</p>
        </div>
      </div>
    </div>
  );
}

export function ManagedSetup() {
  return (
    <div className="hw-fold hw-ms">
      <div className="hw-wide hw-ms-grid">
        <div className="hw-ms-copy">
          <h2>Want Blockwise to run it with you?</h2>
          <p className="hw-sub">
            Managed service starts at US$1,500/month or A$2,500/month, plus ad spend. Book a call
            so we can confirm the scope and onboarding plan before you pay.
          </p>
          <ul className="hw-control-points hw-control-points--ink">
            <li>
              <span className="hw-check" aria-hidden>
                ✓
              </span>
              The complete self-serve product
            </li>
            <li>
              <span className="hw-check" aria-hidden>
                ✓
              </span>
              Launch and weekly optimization for up to four live campaigns
            </li>
            <li>
              <span className="hw-check" aria-hidden>
                ✓
              </span>
              One brand, one Meta ad account, and a monthly report
            </li>
          </ul>
        </div>
        <ManagedSetupForm idPrefix="ms" variant="desktop" />
      </div>
    </div>
  );
}

/* ---------- 6.10 #faq ---------- */

export function FaqSection() {
  return (
    <div className="hw-band hw-faq">
      <h2>The bits agents ask about.</h2>
      <FaqAccordion idPrefix="faq-d" withReveal={false} />
      <div className="hw-faq-banner">
        <span className="hw-faq-banner-copy">
          <span className="hw-faq-banner-h">Need a hand getting started?</span>
          <span className="hw-faq-banner-b">
            Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect your ad
            account and get everything ready for final setup.
          </span>
        </span>
        <CtaLink location="faq_walkthrough" href="#managed-setup" className="hw-textlink">
          Book a walkthrough <span className="hw-arr">→</span>
        </CtaLink>
      </div>
    </div>
  );
}
