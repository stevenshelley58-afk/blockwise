import type { Metadata } from "next";

import { ArrowRight, Building2, Wallet } from "lucide-react";

import { CtaLink } from "@/components/landing/cta-link";
import { SiteFooter, SiteHeader } from "@/components/home-landing/site-chrome";
import { MarketPricing } from "@/components/pricing/market-pricing";

import "../homepage.css";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing",
  alternates: { canonical: "/pricing" },
  description:
    "Blockwise self-serve and managed pricing for the United States and Australia. Create three complete ads free before adding a card.",
};

export default function PricingPage() {
  return (
    <div className="hw-page pricing-page">
      <SiteHeader />
      <main>
        <section className="pricing-hero" aria-labelledby="pricing-title">
          <div className="pricing-shell">
            <p className="pricing-kicker">Pricing</p>
            <h1 id="pricing-title">
              Start with the ad. Pay when you want to run it.
            </h1>
            <p className="pricing-lead">
              Create three complete Feed + Story ads with only your email. Add a
              card when you choose to launch, with one live campaign setup
              included.
            </p>
            <div
              className="pricing-hero-actions"
              aria-label="Ways to get started"
            >
              <CtaLink
                location="pricing-hero-trial"
                href="/signup?offer=self-serve"
                className="hw-btn hw-btn--dark"
              >
                Start free trial
                <ArrowRight aria-hidden size={16} strokeWidth={2.25} />
              </CtaLink>
              <CtaLink
                location="pricing-hero-walkthrough"
                href="/#managed-setup"
                className="hw-btn hw-btn--outline"
              >
                Book a walkthrough
              </CtaLink>
            </div>
            <p className="pricing-hero-reassurance">
              Start with your email — no password or card. Prefer a hands-on
              route? We&rsquo;ll walk you through the setup.
            </p>
          </div>
        </section>

        <MarketPricing />

        <section
          className="pricing-clarity"
          aria-labelledby="pricing-clarity-title"
        >
          <div className="pricing-shell pricing-clarity-layout">
            <h2 id="pricing-clarity-title">Built on clear terms.</h2>
            <ul className="pricing-clarity-points" aria-label="Billing clarity">
              <li>
                <Wallet aria-hidden size={22} strokeWidth={1.8} />
                <div>
                  <h3>Your ad account. Your media budget.</h3>
                  <p>
                    Meta ad spend is separate from every Blockwise plan. You pay
                    Meta directly from your connected ad account; Blockwise
                    never marks up or silently funds that spend.
                  </p>
                </div>
              </li>
              <li>
                <Building2 aria-hidden size={22} strokeWidth={1.8} />
                <div>
                  <h3>One brand per workspace.</h3>
                  <p>
                    Self-serve covers one brand, one workspace, and one primary
                    Meta ad account. Additional brands or client accounts need
                    another workspace or a managed agreement.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
