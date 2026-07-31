import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/home-landing/site-chrome";
import { MarketPricing } from "@/components/pricing/market-pricing";

import "../homepage.css";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing",
  alternates: { canonical: "/pricing" },
  description:
    "Blockwise Platform and managed pricing for the United States and Australia. Create three ads and run one three-day campaign free before subscribing.",
};

export default function PricingPage() {
  return (
    <div className="hw-page pricing-page">
      <SiteHeader />
      <main>
        <section className="pricing-hero" aria-labelledby="pricing-title">
          <div className="pricing-shell">
            <p className="pricing-kicker">Pricing</p>
            <h1 id="pricing-title">Start with three ads and a three-day campaign.</h1>
            <p className="pricing-lead">
              Create three image ads with Feed and Story/Reels-ready creative, then run one
              campaign free for three days. No card is needed until you choose to subscribe.
            </p>
          </div>
        </section>

        <MarketPricing />

        <section className="pricing-clarity" aria-labelledby="pricing-clarity-title">
          <div className="pricing-shell pricing-clarity-layout">
            <h2 id="pricing-clarity-title">Your ad account. Your media budget.</h2>
            <div>
              <p>
                Meta ad spend is separate from every Blockwise plan. You pay Meta directly from
                your connected ad account. Blockwise never marks up or funds that spend. Because
                the campaigns run in your account, you keep your leads and campaign data if you
                cancel Blockwise.
              </p>
              <p>
                The Blockwise Platform covers one brand, one workspace, and one primary Meta ad account.
                Additional brands or client accounts need another workspace or a managed
                agreement.
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
