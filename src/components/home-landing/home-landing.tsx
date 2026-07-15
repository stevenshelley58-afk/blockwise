import Image from "next/image";

import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";

import { FaqAccordion } from "./faq-accordion";
import { ManagedSetupForm } from "./managed-setup-form";
import { PROPERTY_NOTES } from "./data";
import { SuburbReportLocationForm } from "./suburb-report-location-form";

function Brand() {
  return (
    <span className="home-brand">
      <span className="home-brand-mark" aria-hidden />
      <span>blockwise</span>
    </span>
  );
}

function CheckIcon() {
  return <span className="home-check" aria-hidden>✓</span>;
}

export function HomeLanding() {
  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-container home-header-inner">
          <a className="home-logo-link" href="#top" aria-label="Blockwise home">
            <Brand />
          </a>
          <nav className="home-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#property-check">Property Check</a>
            <a href="/pricing">Pricing</a>
          </nav>
          <div className="home-header-actions">
            <SignInLink className="home-login" />
            <CtaLink location="header_local_ads" href="#top" className="home-button home-button-secondary">
              Find local ads
            </CtaLink>
          </div>
        </div>
      </header>

      <main>
        <section id="top" className="home-hero">
          <div className="home-container home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-intro-label">For Australian real estate teams</p>
              <h1>See the ads competing in your suburb.</h1>
              <p className="home-lead">
                Search a suburb to see active Meta ads nearby. Then use a proven angle as the starting point for an ad fitted to your listing and brand.
              </p>
              <SuburbReportLocationForm analyticsLocation="hero_local_ads" />
            </div>
            <figure className="home-map-figure">
              <Image
                src="/home/hero-map.webp"
                alt="Map showing local real estate advertising activity around Perth"
                width={706}
                height={807}
                priority
                sizes="(max-width: 767px) 100vw, 42vw"
              />
              <figcaption>
                <span>Local ad activity</span>
                <strong>Perth, WA</strong>
                <small>Search your suburb for the current view.</small>
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="how-it-works" className="home-section home-workflow">
          <div className="home-container">
            <div className="home-section-heading">
              <h2>From local signal to a review-ready ad.</h2>
              <p>Blockwise turns nearby ad activity into a clear starting point, then prepares the copy, creative and lead form for your approval.</p>
            </div>

            <div className="home-workbench">
              <ol className="home-steps">
                <li>
                  <span>1</span>
                  <div><strong>Search your suburb</strong><p>See active ad angles and formats without handing over an email address.</p></div>
                </li>
                <li>
                  <span>2</span>
                  <div><strong>Choose a useful angle</strong><p>Start from a nearby approach or an approved Blockwise sample, never a blank page.</p></div>
                </li>
                <li>
                  <span>3</span>
                  <div><strong>Review the finished ad</strong><p>Check the copy, creative, lead form, budget and schedule before anything moves forward.</p></div>
                </li>
              </ol>

              <article className="home-ad-review" aria-label="Example review-ready seller lead ad">
                <div className="home-ad-review-head">
                  <span className="home-status"><i aria-hidden /> Ready for review</span>
                  <span>Illustrative example</span>
                </div>
                <div className="home-ad-shell">
                  <div className="home-ad-account">
                    <span className="home-avatar" aria-hidden>YA</span>
                    <div><strong>Your Agency</strong><small>Sponsored</small></div>
                  </div>
                  <p>Thinking of selling? Find out what your home could be worth with a free property appraisal.</p>
                  <Image
                    src="/home/mt-lawley-federation.webp"
                    alt="Federation home used in an illustrative property advertisement"
                    width={1000}
                    height={750}
                    sizes="(max-width: 767px) 100vw, 42vw"
                  />
                  <div className="home-ad-footer">
                    <div><small>YOURAGENCY.COM.AU</small><strong>Book a free property appraisal</strong></div>
                    <span>Learn more</span>
                  </div>
                </div>
                <div className="home-review-summary">
                  <dl>
                    <div><dt>Copy</dt><dd>Prepared</dd></div>
                    <div><dt>Creative</dt><dd>Fitted</dd></div>
                    <div><dt>Lead form</dt><dd>Ready</dd></div>
                  </dl>
                  <p>Nothing spends until you approve.</p>
                </div>
              </article>
            </div>

            <p className="home-disclaimer">Nearby-ad examples show activity signals, not results. What runs is always your call.</p>
          </div>
        </section>

        <section id="control" className="home-section home-control-section">
          <div className="home-container home-control-grid">
            <div className="home-control-copy">
              <h2>One approval, then a clear view of what happens next.</h2>
              <p>Review every ad before export, then track status, spend and leads without returning to Ads Manager for routine checks.</p>
              <ul className="home-check-list">
                <li><CheckIcon />Approve every ad before it goes live</li>
                <li><CheckIcon />Use your own Meta ad account</li>
                <li><CheckIcon />Control the budget and schedule</li>
                <li><CheckIcon />Get optional daily email updates</li>
              </ul>
              <CtaLink location="control_trial" href="/signup" className="home-text-link">Start a free trial <span aria-hidden>→</span></CtaLink>
            </div>

            <div className="home-dashboard" aria-label="Illustrative campaign dashboard">
              <div className="home-dashboard-head">
                <div><strong>Campaign overview</strong><span>Illustrative example</span></div>
                <span className="home-status"><i aria-hidden /> Active</span>
              </div>
              <div className="home-dashboard-summary">
                <div><span>Delivery</span><strong>Active</strong></div>
                <div><span>Tracking</span><strong>Connected</strong></div>
                <div><span>Review</span><strong>Ready</strong></div>
              </div>
              <div className="home-dashboard-row home-dashboard-labels" aria-hidden>
                <span>Campaign</span><span>Status</span><span>Leads</span>
              </div>
              <div className="home-dashboard-row">
                <span><strong>Mt Lawley appraisal</strong><small>Seller lead angle</small></span>
                <span className="home-status"><i aria-hidden /> Active</span>
                <strong>&mdash;</strong>
              </div>
              <div className="home-dashboard-row">
                <span><strong>Market update</strong><small>Local proof angle</small></span>
                <span className="home-status home-status-review"><i aria-hidden /> Review</span>
                <strong>&mdash;</strong>
              </div>
              <p className="home-dashboard-note">Example values show the interface only. They are not performance claims.</p>
            </div>
          </div>
        </section>

        <section id="property-check" className="home-section home-property-section">
          <div className="home-container home-property-grid">
            <div className="home-property-copy">
              <h2>Know the property before the call.</h2>
              <p>Check zoning, overlays, subdivision potential and planning flags before speaking to a seller, buyer or investor.</p>
              <ul className="home-property-uses">
                <li><strong>Seller appraisal prep</strong><span>Walk in with useful property signals, not guesses.</span></li>
                <li><strong>Buyer questions</strong><span>Answer common build, extension and subdivision questions with source-cited notes.</span></li>
                <li><strong>Lead follow-up</strong><span>Turn ad leads into better client conversations.</span></li>
              </ul>
              <CtaLink location="property_check" href="/signup?source=property-check" className="home-text-link">Run a property check <span aria-hidden>→</span></CtaLink>
            </div>

            <article className="home-property-panel">
              <div className="home-property-head"><strong>14 Sample St, Mt Lawley WA</strong><span>Example</span></div>
              <dl className="home-property-facts">
                <div><dt>Zoning</dt><dd>R20 / R40</dd></div>
                <div><dt>Overlays</dt><dd>Heritage area</dd></div>
                <div><dt>Subdivision</dt><dd>Potential, verify lot width</dd></div>
              </dl>
              <div className="home-property-notes">
                {PROPERTY_NOTES.map((note) => <p key={note.source}><i aria-hidden /><span>{note.text} <small>{note.source}</small></span></p>)}
              </div>
              <p className="home-property-caveat">Source-cited notes support call preparation. Always confirm with the local planning authority.</p>
            </article>
          </div>
        </section>

        <section id="free-trial" className="home-section home-start-section">
          <div className="home-container">
            <div className="home-start-grid">
              <div className="home-trial-copy">
                <h2>Try the full workflow when you are ready.</h2>
                <p>Start with seven days of access. No card is required, and your drafts stay available if you pause.</p>
                <ul className="home-trial-points">
                  <li><strong>7 days</strong><span>Full access after you confirm your email</span></li>
                  <li><strong>No card</strong><span>No surprise charge when the trial ends</span></li>
                  <li><strong>Connect later</strong><span>Review ads before connecting Meta</span></li>
                </ul>
                <div className="home-trial-actions">
                  <CtaLink location="trial_primary" href="/signup" className="home-button home-button-primary">Start free trial</CtaLink>
                  <CtaLink location="trial_managed_setup" href="#managed-setup" className="home-text-link">Request setup help <span aria-hidden>&rarr;</span></CtaLink>
                </div>
              </div>

              <div id="managed-setup" className="home-managed-setup">
                <h3>Prefer help with the first setup?</h3>
                <p>Request a 15-minute walkthrough. We will prepare the first ads with you and review the account connection before handoff.</p>
                <ManagedSetupForm idPrefix="home-managed" />
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="home-section home-faq-section">
          <div className="home-container home-faq-grid">
            <div><h2>Questions agents ask before starting.</h2><p>Clear answers about spend, approvals, accounts and what happens after the trial.</p></div>
            <FaqAccordion idPrefix="home" />
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-container">
          <div className="home-footer-cta"><div><h2>Start with the ads already running nearby.</h2><p>No email required for the local report.</p></div><CtaLink location="footer_local_ads" href="#top" className="home-button home-button-light">Search local ads</CtaLink></div>
          <div className="home-footer-meta">
            <div><Brand /><p>Real estate ad research, preparation, approval and tracking in one focused workflow.</p><a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a></div>
            <nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#property-check">Property Check</a><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/data-deletion">Data deletion</a></nav>
          </div>
          <p className="home-legal">© 2026 Blockwise, all rights reserved. Business operated by SHELLEY, STEVEN JOHN.</p>
        </div>
      </footer>
    </div>
  );
}
