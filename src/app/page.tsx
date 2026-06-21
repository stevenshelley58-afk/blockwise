import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { DemoForm } from "@/components/landing/demo-form";
import { LandingEvidenceSlabAds } from "@/components/landing/landing-evidence-slab-ads";
import { SignInLink } from "@/components/landing/sign-in-link";
import { LandingAdRadarScan } from "@/components/research/landing-ad-radar-scan";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Landing page — "Executive Precision" design (source: /stitch export, wired
 * to real app flows). Copy is freely editable.
 */

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

/** "How it works" illustration (radar → prepared card → live dashboard). */
const HOW_FIG_SVG = `<svg viewBox="0 0 1500 360" role="img" aria-label="Scan the suburb, we prepare the ads, leads come in"><defs><linearGradient id="bRail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f97ff"/><stop offset=".5" stop-color="#2fd2c2"/><stop offset="1" stop-color="#9a7fff"/></linearGradient><linearGradient id="bC1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f97ff"/><stop offset="1" stop-color="#1f5fd6"/></linearGradient><linearGradient id="bC2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd2c2"/><stop offset="1" stop-color="#10a294"/></linearGradient><linearGradient id="bSweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fd2c2" stop-opacity="0"/><stop offset="1" stop-color="#2fd2c2" stop-opacity=".5"/></linearGradient><filter id="bShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="9" stdDeviation="12" flood-color="#1f3a7a" flood-opacity="0.10"/></filter></defs><line x1="250" y1="180" x2="1290" y2="180" stroke="#dde3ee" stroke-width="2" stroke-dasharray="2 9"/><path id="bSig" d="M250,180 C430,90 560,90 700,180 S950,270 1100,180 1230,120 1290,150" pathLength="1" fill="none" stroke="url(#bRail)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle r="6" fill="#1fb3a6" opacity=".9"><animateMotion dur="2.8s" repeatCount="indefinite"><mpath href="#bSig"/></animateMotion></circle><circle cx="300" cy="180" r="102" fill="#fff" filter="url(#bShadow)"/><circle cx="300" cy="180" r="86" fill="none" stroke="#2fbfb0" stroke-opacity="0.22" stroke-width="2.2"/><circle cx="300" cy="180" r="53" fill="none" stroke="#2fbfb0" stroke-opacity="0.32" stroke-width="2.2"/><circle cx="300" cy="180" r="26" fill="none" stroke="#2fbfb0" stroke-opacity="0.44" stroke-width="2.2"/><path d="M300,180 L346,107 A86,86 0 0,1 386,183 Z" fill="url(#bSweep)"><animateTransform attributeName="transform" type="rotate" from="0 300 180" to="360 300 180" dur="5s" repeatCount="indefinite"/></path><circle class="bwx-bBlip" cx="318" cy="115" r="5" fill="#1f6feb"/><circle class="bwx-bBlip" cx="237" cy="192" r="5" fill="#1f6feb"/><circle cx="300" cy="180" r="5" fill="#2fbfb0"/><rect x="678" y="108" width="144" height="144" rx="28" fill="#fff" filter="url(#bShadow)"/><rect x="698" y="126" width="104" height="42" rx="10" fill="url(#bC1)"/><rect x="698" y="178" width="104" height="8" rx="4" fill="#e3e7ee"/><rect x="698" y="192" width="70" height="8" rx="4" fill="#eaedf2"/><rect x="698" y="212" width="60" height="20" rx="10" fill="url(#bC2)"/><text x="728" y="226" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">Ready</text><rect x="1080" y="102" width="240" height="156" rx="22" fill="#fff" filter="url(#bShadow)"/><text x="1102" y="134" font-size="13" font-weight="700" letter-spacing="1" fill="#8a90a0">LAST 7 DAYS</text><circle cx="1262" cy="129" r="5" fill="#23a35e"/><text x="1274" y="134" font-size="12.5" font-weight="700" fill="#23a35e">Live</text><text x="1102" y="188" font-size="40" font-weight="800" fill="#0f1115">47</text><text x="1102" y="212" font-size="14" fill="#6b7280">leads</text><line x1="1196" y1="152" x2="1196" y2="214" stroke="#eef0f4" stroke-width="2"/><text x="1218" y="188" font-size="40" font-weight="800" fill="#0f1115">$13</text><text x="1218" y="212" font-size="14" fill="#6b7280">cost / lead</text><path d="M1102,237 L1124,233 L1146,235 L1168,227 L1190,229 L1212,221 L1234,223" pathLength="1" fill="none" stroke="#1fb3a6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="1234" cy="223" r="4" fill="#1fb3a6"/></svg>`;

/** Scoped styles for the "How it works" section (ported from the prior homepage, blue palette). */
const HOW_CSS = `
.lp .lp-how__head{text-align:center;margin-bottom:44px}
.lp .lp-how__head h2{font-size:clamp(19px,2.4vw,26px);font-weight:600;line-height:1.35;letter-spacing:-.01em;margin:0 auto;max-width:34ch;text-wrap:balance;color:var(--lp-ink)}
.lp .lp-how__sub{font-size:16px;line-height:1.55;color:var(--lp-muted);margin:14px auto 0;max-width:52ch}
.lp .lp-how-fig{position:relative;margin:0 auto;max-width:1024px;border-radius:24px;border:1px solid var(--lp-border);padding:14px;background:radial-gradient(120% 90% at 18% 12%,#eef3fb 0,rgba(238,243,251,0) 55%),radial-gradient(120% 100% at 88% 92%,#f1eefb 0,rgba(241,238,251,0) 55%),linear-gradient(160deg,#f6f8fc,#f7f6fc)}
.lp .lp-how-fig svg{width:100%;height:auto;display:block}
.lp .lp-how-fig .bwx-bBlip{animation:lp-how-blip 2.4s ease-in-out infinite}
@keyframes lp-how-blip{0%,100%{opacity:1}50%{opacity:.35}}
.lp .lp-how__steps{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin:26px auto 0;max-width:1024px;padding:0}
.lp .lp-how__s{padding:0 8px}
.lp .lp-how__s b{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:700;line-height:1.3;color:var(--lp-ink)}
.lp .lp-how__s b em{font-style:normal;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff}
.lp .lp-how-e1{background:linear-gradient(135deg,#4f97ff,#1f5fd6)}
.lp .lp-how-e2{background:linear-gradient(135deg,#2fd2c2,#10a294)}
.lp .lp-how-e3{background:linear-gradient(135deg,#9a7fff,#5a36e0)}
.lp .lp-how__s p{font-size:14px;line-height:1.5;color:var(--lp-body);margin-top:8px}
@media (prefers-reduced-motion:reduce){.lp .lp-how-fig .bwx-bBlip{animation:none}}
@media (max-width:760px){.lp .lp-how__steps{grid-template-columns:1fr;gap:16px}}
`;

const TABLE_ROWS = [
  { name: "Mt Lawley Appraisal", status: "Active", clicks: "247", leads: "18", spend: "$324" },
  { name: "Subiaco Just Listed", status: "Active", clicks: "182", leads: "11", spend: "$210" },
  { name: "Cottesloe Open Home", status: "Paused", clicks: "93", leads: "7", spend: "$98" },
  { name: "South Perth Auction", status: "Active", clicks: "145", leads: "9", spend: "$176" },
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
            <a href="#workflow">How it works</a>
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

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-shell lp-hero-center">
            <span className="lp-hero-pill">
              <span className="lp-hero-pill-dot" aria-hidden />
              Meta ads for real estate agents
            </span>
            <h1 id="hero-title">Your competitors are advertising. Are you?</h1>
            <p className="lp-hero-sub">
              Ads built from what&rsquo;s actually working in your area. Start getting leads today.
            </p>
            <div className="lp-hero-scan">
              <LandingAdRadarScan
                buttonLabel="Free suburb audit"
                initialNote="Start with Perth, WA or choose your suburb."
                initialValue="Perth, WA"
                placeholder="Enter city, agent, or brokerage"
                useBestGuess
              />
            </div>
            <p className="lp-hero-microcopy">7-day free trial · No credit card required</p>
          </div>
        </section>

        {/* Evidence slab: real Meta Ad Library creative as a layered 3D object,
            with a readout explaining one ad at a time. Reads the existing
            local-ad-radar API. The hero suburb audit handles search. */}
        <LandingEvidenceSlabAds initialLocation="Perth, WA" limit={7} />

        <section id="workflow" className="lp-section">
          <style dangerouslySetInnerHTML={{ __html: HOW_CSS }} />
          <div className="lp-shell">
            <div className="lp-how__head">
              <h2>Too much time is wasted on ads. Not enough time is spent doing the work that actually matters.</h2>
              <p className="lp-how__sub">Blockwise handles the ad work for you. Approve what goes live, receive updates, and focus on your clients.</p>
            </div>
            <div className="lp-how-fig" aria-hidden dangerouslySetInnerHTML={{ __html: HOW_FIG_SVG }} />
            <ol className="lp-how__steps">
              <li className="lp-how__s"><b><em className="lp-how-e1">1</em> Scan</b><p>See local lead angles.</p></li>
              <li className="lp-how__s"><b><em className="lp-how-e2">2</em> Prepared</b><p>Blockwise prepares the ads.</p></li>
              <li className="lp-how__s"><b><em className="lp-how-e3">3</em> Leads</b><p>Approve, run, and track results.</p></li>
            </ol>
          </div>
        </section>

        <section id="campaign-types" className="lp-section">
          <div className="lp-shell">
            <div className="lp-center-head">
              <p className="lp-eyebrow">Done for you</p>
              <h2 className="lp-h2">We build your real estate ads for you.</h2>
              <p className="lp-lead">
                Blockwise writes the ads, builds the lead form and sets everything up. You just
                approve what goes live, then export the package for final setup in your own ad account.
              </p>
            </div>
            <div className="lp-features">
              <Feature
                title="Facebook and Instagram ads"
                copy="Headlines, primary text, descriptions and creative variants — written for you, ready to run."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z" /></svg>}
              />
              <Feature
                title="Lead forms"
                copy="Questions, privacy details and thank-you screen, built and matched to your goal."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></svg>}
              />
              <Feature
                title="Proven local angles"
                copy="Just Listed, Open Home, Just Sold, Free Appraisal, Buyer Demand and Market Update."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>}
              />
              <Feature
                title="Budget and schedule"
                copy="We set the spend and timing. Ad spend runs through your own ad account."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>}
              />
              <Feature
                title="Approval checks"
                copy="We flag common review issues around claims, pricing language and brand fit before sign off."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>}
              />
              <Feature
                title="Live reporting"
                copy="Track impressions, clicks, leads, spend and status inside Blockwise."
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="5" width="3" height="12" /></svg>}
              />
            </div>
          </div>
        </section>

        <section id="approval" className="lp-section lp-section-surface" aria-labelledby="control-title">
          <div className="lp-shell lp-split lp-split-swap">
            <div>
              <p className="lp-eyebrow">Approval and control</p>
              <h2 className="lp-h2" id="control-title">You stay in control before anything leaves draft.</h2>
              <p className="lp-lead">
                Every ad is drafted inside Blockwise, reviewed by your team and exported for
                final platform setup only after approval.
              </p>
              <ul className="lp-control-list" aria-label="Control points">
                <li><span className="lp-check" aria-hidden>✓</span>Approve every ad before export</li>
                <li><span className="lp-check" aria-hidden>✓</span>Use your own Meta ad account</li>
                <li><span className="lp-check" aria-hidden>✓</span>Control the budget and schedule</li>
                <li><span className="lp-check" aria-hidden>✓</span>See every result in one dashboard</li>
              </ul>
            </div>
            <div className="lp-table-card" aria-label="Ad performance table preview">
              <div className="lp-table-bar">
                <div>
                  <strong>Your ads</strong>
                  <span className="lp-badge lp-badge-neutral">Example data</span>
                </div>
                <CtaLink location="control-table" href="/signup" className="lp-btn lp-btn-primary lp-btn-sm">
                  Get started
                </CtaLink>
              </div>
              <div className="lp-table-scroll">
                <table className="lp-table">
                  <thead>
                    <tr><th>Ad</th><th>Status</th><th>Clicks</th><th>Leads</th><th>Spend</th></tr>
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

        <section id="reporting" className="lp-section">
          <div className="lp-shell lp-center-head">
            <p className="lp-eyebrow">Reporting</p>
            <h2 className="lp-h2">See status, spend, clicks, and leads in Blockwise.</h2>
            <p className="lp-lead">
              The dashboard brings performance back into the same workspace your team uses
              to review and approve.
            </p>
          </div>
        </section>

        <section id="free-trial" className="lp-section lp-trial">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow lp-eyebrow-green">Free trial</p>
              <h2 className="lp-h2 lp-h2-light">Try Blockwise free for 7 days.</h2>
              <p className="lp-lead lp-lead-light">
                No card required. Review your ads and connect your ad account
                when you are ready for final setup.
              </p>
              <CtaLink location="trial" href="/signup" className="lp-btn lp-btn-light lp-btn-big">
                Start free trial
              </CtaLink>
            </div>
            <div className="lp-trial-grid">
              <div className="lp-trial-item"><strong>7 days</strong><span>Full access from the minute you confirm your email.</span></div>
              <div className="lp-trial-item"><strong>No card</strong><span>Nothing charges when the trial ends. Your drafts stay put.</span></div>
              <div className="lp-trial-item"><strong>Connect anytime</strong><span>Connect your Meta ad account when you are ready.</span></div>
            </div>
          </div>
        </section>

        <section id="managed-setup" className="lp-section lp-section-surface" aria-labelledby="demo-title">
          <div className="lp-shell lp-split">
            <div>
              <p className="lp-eyebrow">Managed setup</p>
              <h2 className="lp-h2" id="demo-title">Want help getting started?</h2>
              <p className="lp-lead">
                Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect
                your ad account and review everything before handoff.
              </p>
            </div>
            <DemoForm />
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
                    You do. Your ads run through your connected ad account and your ad spend is paid to
                    the platform directly. Blockwise is the software used to build, approve, export and
                    track your ads.
                  </p>
                </details>
                <details>
                  <summary>Do I need a Meta ad account?</summary>
                  <p>
                    You can review your ads before connecting Meta. To move from draft to live,
                    connect your Meta ad account for final setup.
                  </p>
                </details>
                <details>
                  <summary>Can I approve ads before they run?</summary>
                  <p>
                    Yes. Nothing is sent for launch until your team approves the copy, creative, lead form,
                    budget and schedule.
                  </p>
                </details>
                <details>
                  <summary>Can I see results inside Blockwise?</summary>
                  <p>
                    Yes. Once your ads are connected, Blockwise shows status, spend, clicks, leads and
                    performance metrics inside the app.
                  </p>
                </details>
                <details>
                  <summary>Are the ads checked before export?</summary>
                  <p>
                    Blockwise flags common property advertising risks and brand issues before approval.
                    Your agency remains responsible for final review, claims, pricing language and
                    export.
                  </p>
                </details>
                <details>
                  <summary>What happens after the 7 days?</summary>
                  <p>
                    Your free access pauses and we ask you to pick a plan. We never took a card, so
                    there is no surprise charge. Your drafts stay put.
                  </p>
                </details>
              </div>
            </div>
            <aside className="lp-setup-card">
              <h3>Need a hand getting started?</h3>
              <p>
                Book a 15-minute walkthrough. We&rsquo;ll set up your first ads, connect
                your ad account and get everything ready for final setup.
              </p>
              <CtaLink location="faq-walkthrough" href="#managed-setup" className="lp-btn lp-btn-hero">
                Book a walkthrough
              </CtaLink>
            </aside>
          </div>
        </section>
      </main>

      <footer className="lp-footer" aria-label="Footer">
        <div className="lp-shell lp-footer-grid">
          <div>
            <BlockwiseLogo />
            <p>
              The ad platform for real estate teams. Create, approve, export and track property
              ads from one place.
            </p>
            <p className="lp-footer-contact">
              <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#workflow">How it works</a>
            <a href="#free-trial">Free trial</a>
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
          {/* Social icons are decorative until the profiles exist — swap spans for links then. */}
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
