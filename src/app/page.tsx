import type { Metadata } from "next";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";
import { LandingAdRadarScan } from "@/components/research/landing-ad-radar-scan";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    title: "Scan",
    copy: "See active real estate ads around your suburb.",
  },
  {
    title: "Prepare",
    copy: "Blockwise turns the useful angle into a draft ad.",
  },
  {
    title: "Approve",
    copy: "Review the ad before anything goes live.",
  },
] as const;

const FAQS = [
  {
    question: "Who pays for ad spend?",
    answer:
      "You do. Ads run through your connected ad account and ad spend is paid to the platform directly.",
  },
  {
    question: "Do I need a Meta ad account?",
    answer: "Not to start. You can scan, draft and review ads before connecting Meta.",
  },
  {
    question: "Can I approve ads before they run?",
    answer: "Yes. Nothing is sent for launch until your team approves the ad.",
  },
  {
    question: "What happens after the trial?",
    answer: "Creating ads pauses and we ask you to pick a plan. We never took a card.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="lp lp-simple">
      <header className="lp-nav-wrap">
        <div className="lp-shell lp-nav lp-simple-nav">
          <Link className="lp-brand" href="/" aria-label="Blockwise home">
            <BlockwiseLogo />
          </Link>
          <nav className="lp-nav-links" aria-label="Primary">
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
        <section className="lp-hero lp-simple-hero" aria-labelledby="hero-title">
          <div className="lp-shell lp-simple-hero-grid">
            <div className="lp-simple-hero-copy">
              <span className="lp-hero-pill">
                <span className="lp-hero-pill-dot" aria-hidden />
                Meta ads for real estate agents
              </span>
              <h1 id="hero-title">See what competitors are running. Get your first ad prepared today.</h1>
              <p className="lp-hero-sub">
                Blockwise prepares real estate ads from what&rsquo;s working in your area, so you can get more
                leads and listings without building ads yourself.
              </p>
              <div className="lp-hero-scan">
                <LandingAdRadarScan
                  buttonLabel="Scan my suburb"
                  initialNote="Start with Perth, WA or choose your suburb."
                  initialValue="Perth, WA"
                  placeholder="Enter city, agent, or brokerage"
                  useBestGuess
                />
              </div>
              <p className="lp-hero-microcopy">7-day trial · 10 ads · No card required</p>
            </div>

            <aside className="lp-proof-card" aria-label="Prepared ad preview">
              <div className="lp-proof-card-head">
                <span>Ready for approval</span>
                <strong>Listing leads</strong>
              </div>
              <div className="lp-proof-preview" aria-hidden>
                <span>Free appraisal</span>
              </div>
              <dl className="lp-proof-list">
                <div>
                  <dt>Budget</dt>
                  <dd>$25/day</dd>
                </div>
                <div>
                  <dt>Lead form</dt>
                  <dd>Ready</dd>
                </div>
                <div>
                  <dt>Creative</dt>
                  <dd>Prepared</dd>
                </div>
              </dl>
              <button type="button" className="lp-proof-approve">
                Approve
              </button>
            </aside>
          </div>
        </section>

        <section id="how-it-works" className="lp-section lp-simple-section" aria-labelledby="simple-flow-title">
          <div className="lp-shell">
            <div className="lp-simple-section-head">
              <p className="lp-eyebrow">How it works</p>
              <h2 className="lp-h2" id="simple-flow-title">
                From local proof to ready ads.
              </h2>
            </div>
            <div className="lp-simple-steps">
              {STEPS.map((step, index) => (
                <article className="lp-simple-step" key={step.title}>
                  <span>{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-simple-band" aria-labelledby="control-title">
          <div className="lp-shell lp-simple-split">
            <div>
              <p className="lp-eyebrow">Control</p>
              <h2 className="lp-h2" id="control-title">
                You approve what goes live.
              </h2>
            </div>
            <p className="lp-lead">
              Blockwise prepares the ad. You review the copy, creative, budget and lead form before anything
              runs.
            </p>
          </div>
        </section>

        <section id="free-trial" className="lp-section lp-simple-trial" aria-labelledby="trial-title">
          <div className="lp-shell lp-simple-split">
            <div>
              <p className="lp-eyebrow">Free trial</p>
              <h2 className="lp-h2" id="trial-title">
                Try Blockwise with 10 free ads.
              </h2>
              <p className="lp-lead">No card required. Your drafts stay put when the trial ends.</p>
            </div>
            <CtaLink location="trial" href="/signup" className="lp-btn lp-btn-primary lp-btn-big">
              Start free trial
            </CtaLink>
          </div>
        </section>

        <section id="faq" className="lp-section lp-simple-faq" aria-labelledby="faq-title">
          <div className="lp-shell lp-simple-split">
            <div>
              <p className="lp-eyebrow">Questions</p>
              <h2 className="lp-h2" id="faq-title">
                The basics.
              </h2>
            </div>
            <div className="lp-faq-list">
              {FAQS.map((item, index) => (
                <details key={item.question} open={index === 0}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer" aria-label="Footer">
        <div className="lp-shell lp-footer-grid">
          <div>
            <BlockwiseLogo />
            <p>The ad platform for real estate teams. Prepare, approve and track property ads from one place.</p>
            <p className="lp-footer-contact">
              <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="#how-it-works">How it works</a>
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
        </div>
      </footer>
    </div>
  );
}
