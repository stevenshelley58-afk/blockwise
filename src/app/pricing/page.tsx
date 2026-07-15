import { Check } from "lucide-react";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";

export const metadata = {
  title: "Pricing",
  alternates: { canonical: "/pricing" },
  description:
    "Simple pricing for real estate teams. Start with a free 7-day trial — 10 free ad packs included.",
};

const INCLUDED = [
  "Up to 10 ad packs per month",
  "Campaign builder (Just Listed, Open Home, Just Sold, Free Appraisal, Buyer Demand, Market Update)",
  "Meta ad account connection",
  "Team approval workflow",
  "Live performance reporting",
  "Email support",
] as const;

export default function PricingPage() {
  return (
    <div className="lp">
      <header className="lp-nav-wrap">
        <div className="lp-shell lp-nav">
          <Link className="lp-brand" href="/" aria-label="Blockwise home">
            <BlockwiseLogo />
          </Link>
          <nav className="lp-nav-links" aria-label="Primary">
            <a href="/#start">How it works</a>
            <a href="/#property-check">Property Check</a>
            <a href="/#free-trial">Free trial</a>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <div className="lp-nav-actions">
            <SignInLink />
            <CtaLink location="nav" href="/signup" className="lp-btn lp-btn-primary">
              Start free trial
            </CtaLink>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-section" aria-labelledby="pricing-title">
          <div className="lp-shell">
            <div className="lp-center-head">
              <p className="lp-eyebrow">Pricing</p>
              <h1 className="lp-h2" id="pricing-title">
                Simple pricing for real estate teams.
              </h1>
              <p className="lp-lead">
                One plan. Everything included. Start with a free trial — no card required.
              </p>
            </div>

            <div
              style={{
                maxWidth: 480,
                margin: "0 auto",
                background: "#fff",
                border: "1px solid var(--lp-border)",
                borderRadius: 20,
                boxShadow: "var(--lp-shadow-premium)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "var(--lp-surface)",
                  borderBottom: "1px solid var(--lp-border)",
                  padding: "28px 32px 24px",
                }}
              >
                <p className="lp-eyebrow" style={{ marginBottom: 8 }}>
                  Plan
                </p>
                <h2
                  style={{
                    margin: 0,
                    fontSize: "1.6rem",
                    fontWeight: 800,
                    letterSpacing: "-0.025em",
                    color: "var(--lp-ink)",
                    fontFamily: "var(--font-manrope), Manrope, sans-serif",
                  }}
                >
                  Blockwise
                </h2>

                <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      fontSize: "2.6rem",
                      fontWeight: 800,
                      letterSpacing: "-0.03em",
                      color: "var(--lp-ink)",
                      fontVariantNumeric: "tabular-nums",
                      fontFamily: "var(--font-manrope), Manrope, sans-serif",
                    }}
                  >
                    $799
                  </span>
                  <span style={{ fontSize: "1rem", color: "var(--lp-muted)", fontWeight: 600 }}>
                    / month
                  </span>
                </div>

                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--lp-muted)",
                  }}
                >
                  Then $799/month. Cancel anytime. Less than half a typical agency retainer.
                </p>

                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 14px",
                    background: "var(--green-soft)",
                    border: "1px solid #a7f3d0",
                    borderRadius: 10,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--green)",
                    lineHeight: 1.5,
                  }}
                >
                  Start with a 7-day free trial — 10 free ad packs included. No card required.
                </div>
              </div>

              <div style={{ padding: "24px 32px 28px" }}>
                <p
                  style={{
                    margin: "0 0 16px",
                    fontSize: 12,
                    fontWeight: 750,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--lp-muted)",
                  }}
                >
                  What&rsquo;s included
                </p>
                <ul className="lp-control-list" aria-label="Plan features" style={{ marginTop: 0 }}>
                  {INCLUDED.map((item) => (
                    <li key={item}>
                      <span className="lp-check" aria-hidden>
                        <Check size={12} strokeWidth={3.5} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>

                <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
                  <CtaLink
                    location="pricing-primary"
                    href="/signup"
                    className="lp-btn lp-btn-primary lp-btn-wide lp-btn-big"
                  >
                    Start free trial
                  </CtaLink>
                  <a
                    href="/#managed-setup"
                    style={{
                      textAlign: "center",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--lp-muted)",
                      textDecoration: "none",
                      padding: "6px 0",
                    }}
                  >
                    Book a walkthrough
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer" aria-label="Footer">
        <div className="lp-shell lp-footer-grid">
          <div>
            <BlockwiseLogo />
            <p>
              The ad platform for real estate teams. Create, approve, export and track property
              campaigns from one place.
            </p>
            <p>Blockwise is operated by SHELLEY, STEVEN JOHN.</p>
            <p className="lp-footer-contact">
              <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="/#start">How it works</a>
            <a href="/#property-check">Property Check</a>
            <a href="/#free-trial">Free trial</a>
            <Link href="/pricing">Pricing</Link>
          </div>
          <div>
            <h4>Legal</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </div>
        </div>
        <div className="lp-shell lp-footer-bottom">
          <span>© {new Date().getFullYear()} Blockwise. All rights reserved.</span>
          <span className="lp-footer-social" aria-hidden style={{ pointerEvents: "none" }}>
            <span className="lp-social-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </span>
            <span className="lp-social-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12M7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0" /></svg>
            </span>
            <span className="lp-social-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069m0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0m0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881" /></svg>
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
