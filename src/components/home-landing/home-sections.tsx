import { Fragment, type CSSProperties } from "react";

import { CtaLink } from "@/components/landing/cta-link";
import { InView } from "@/components/motion";
import { formatBillingAmount, getBillingOffer } from "@/lib/billing/offers";

import {
  CHART_POINTS,
  CONTROL_POINTS,
  DASH_ROWS,
  HERO_RAIL,
} from "./data";
import { FbAdCard } from "./fb-ad-card";
import { FaqAccordion } from "./faq-accordion";
import { ManagedSetupForm } from "./managed-setup-form";
import { StartStudio } from "./start-studio";

const US_SELF_SERVE = getBillingOffer("US", "self_serve");
const AU_SELF_SERVE = getBillingOffer("AU", "self_serve");
const US_MANAGED = getBillingOffer("US", "managed");
const AU_MANAGED = getBillingOffer("AU", "managed");
const SELF_SERVE_RENEWAL = `${formatBillingAmount(
  US_SELF_SERVE.recurringAmount,
  US_SELF_SERVE.currency,
)} / ${formatBillingAmount(AU_SELF_SERVE.recurringAmount, AU_SELF_SERVE.currency)}`;
const SELF_SERVE_FIRST_MONTH = `${formatBillingAmount(
  US_SELF_SERVE.firstInvoiceAmount,
  US_SELF_SERVE.currency,
)} / ${formatBillingAmount(AU_SELF_SERVE.firstInvoiceAmount, AU_SELF_SERVE.currency)}`;
const MANAGED_MONTHLY = `${formatBillingAmount(
  US_MANAGED.recurringAmount,
  US_MANAGED.currency,
)} / ${formatBillingAmount(AU_MANAGED.recurringAmount, AU_MANAGED.currency)}`;

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
            Blockwise brings creative, copy, approvals and campaign updates into one guided
            workflow.
          </p>
          <CtaLink location="workflow" href="/signup" className="hw-textlink hw-wf-cta">
            Create three ads free <span className="hw-arr">→</span>
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
          <span className="hw-btn hw-btn--dark hw-wf-approve" aria-hidden>
            Approve
          </span>
          <p className="hw-note">Nothing spends before approval.</p>
        </div>
      </InView>
    </div>
  );
}

/* ---------- 6.6 #control — The dark fold (dashboard + results snapshot) ---------- */

export function ControlFold() {
  return (
    <div className="hw-fold hw-control">
      <InView className="hw-wide hw-control-grid" threshold={0.18}>
        <div className="hw-control-rail">
          <h2>Stay in control.</h2>
          <p className="hw-sub">
            Review ads, leads, spend and approvals in one dashboard. Get an email when something
            needs your attention.
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
        <div className="hw-control-panels">
          <div className="hw-dash">
            <div className="hw-dash-head">
              <span className="hw-dash-head-l">
                <span className="hw-dash-title">Control dashboard</span>
                <span className="hw-dash-sub">Every ad in one place · Example data</span>
              </span>
              <span className="hw-tag">Example</span>
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
                  pathLength={1}
                  fill="none"
                  stroke="var(--hw-accent-bright)"
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
          <div className="hw-email">
            <div className="hw-email-head">
              <span className="hw-email-head-h">Results snapshot</span>
              <span className="hw-tag hw-tag--accent">Example</span>
            </div>
            <p className="hw-email-title">Workspace overview</p>
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
                No need to check Ads Manager every day.
              </p>
            </div>
          </div>
        </div>
      </InView>
    </div>
  );
}

/* ---------- 6.9 #free-trial + #managed-setup ---------- */

export function FreeTrial() {
  return (
    <div className="hw-band hw-band--wide hw-trial">
      <h2>Create 3 ads free.</h2>
      <div className="hw-trial-cta">
        <CtaLink location="free_trial" href="/signup" className="hw-btn hw-btn--dark">
          Create three ads free <span className="hw-arr">→</span>
        </CtaLink>
        <p className="hw-sub">
          Each ad includes Feed and Story/Reels-ready image creative. No credit card required.
        </p>
      </div>
      <div className="hw-trial-facts">
        <div className="hw-trial-fact">
          <h3>High-quality templates</h3>
          <p>Choose a lead generation layout and make it yours.</p>
        </div>
        <div className="hw-trial-fact">
          <h3>Personalised AI copy</h3>
          <p>Review and edit every line before publishing.</p>
        </div>
        <div className="hw-trial-fact">
          <h3>One 3-day campaign free</h3>
          <p>No Blockwise fee. You pay Meta directly for ad spend.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- 6.9b #pricing — Self-serve price panel ---------- */

export function SelfServePricing() {
  return (
    <div className="hw-fold hw-pricing">
      <div className="hw-band">
        <h2>Create, publish and track your Meta ads in one place.</h2>
        <div className="hw-price-panel">
          <div className="hw-price-lead">
            <span className="hw-price-num">
              {SELF_SERVE_RENEWAL}
              <span className="hw-price-per">/mo</span>
            </span>
            <p className="hw-price-note">
              Blockwise Platform. First month {SELF_SERVE_FIRST_MONTH}, charged when you
              subscribe. Meta ad spend is billed separately by Meta.
            </p>
          </div>
          <div className="hw-price-facts">
            <span className="hw-price-fact">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--hw-accent)" strokeWidth="1.5" aria-hidden>
                <path d="M8 1.5l6 3.2-6 3.2-6-3.2L8 1.5z" />
                <path d="M2 8.2l6 3.2 6-3.2M2 11.4l6 3.2 6-3.2" />
              </svg>
              100 renders monthly
            </span>
            <span className="hw-price-fact">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--hw-accent)" strokeWidth="1.5" aria-hidden>
                <rect x="1.5" y="1.5" width="5.6" height="5.6" rx="1" />
                <rect x="8.9" y="1.5" width="5.6" height="5.6" rx="1" />
                <rect x="1.5" y="8.9" width="5.6" height="5.6" rx="1" />
                <rect x="8.9" y="8.9" width="5.6" height="5.6" rx="1" />
              </svg>
              Up to 50 Feed + Story packs
            </span>
            <span className="hw-price-fact">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--hw-accent)" strokeWidth="1.5" aria-hidden>
                <circle cx="5.5" cy="5" r="2.5" />
                <path d="M1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4" />
                <circle cx="11.5" cy="5.5" r="2" />
                <path d="M11 9.7c1.9.3 3.5 1.8 3.5 3.8" />
              </svg>
              5 team seats
            </span>
          </div>
        </div>
        <CtaLink location="pricing" href="/signup" className="hw-btn hw-btn--dark hw-price-cta">
          Create three ads free <span className="hw-arr">→</span>
        </CtaLink>
      </div>
    </div>
  );
}

export function ManagedSetup() {
  return (
    <div className="hw-fold hw-ms">
      <div className="hw-wide hw-ms-grid">
        <div className="hw-ms-copy">
          <h2>Fully managed.</h2>
          <p className="hw-ms-price">
            {MANAGED_MONTHLY}/mo <span>plus Meta ad spend</span>
          </p>
          <p className="hw-sub">
            Everything in the Blockwise Platform, plus campaign launch, weekly optimisation and a
            monthly performance report.
          </p>
          <ul className="hw-control-points hw-control-points--ink">
            <li>
              <span className="hw-check" aria-hidden>
                ✓
              </span>
              The complete Blockwise Platform
            </li>
            <li>
              <span className="hw-check" aria-hidden>
                ✓
              </span>
              Campaign launch and weekly optimisation
            </li>
            <li>
              <span className="hw-check" aria-hidden>
                ✓
              </span>
              One brand, one ad account and a monthly performance report
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
      <h2>FAQ</h2>
      <FaqAccordion idPrefix="faq-d" withReveal={false} />
      <div className="hw-faq-banner">
        <span className="hw-faq-banner-copy">
          <span className="hw-faq-banner-h">Need a hand?</span>
          <span className="hw-faq-banner-b">15 minutes. First ads set up.</span>
        </span>
        <CtaLink location="faq_walkthrough" href="#managed-setup" className="hw-textlink">
          Book a 15-minute walkthrough <span className="hw-arr">→</span>
        </CtaLink>
      </div>
    </div>
  );
}
