import type { Metadata } from "next";

import { Building2, Wallet } from "lucide-react";

import { SiteFooter, SiteHeader } from "@/components/home-landing/site-chrome";
import { MarketPricing } from "@/components/pricing/market-pricing";
import { PricingFaq } from "@/components/pricing/pricing-faq";
import { CtaLink } from "@/components/landing/cta-link";
import { Button } from "@/components/ui/button";

import "../homepage.css";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing",
  alternates: { canonical: "/pricing" },
  description:
    "Blockwise pricing: start free, continue managing ads yourself, choose self-serve at A$249/month, or ask about managed service from A$1,500/month.",
};

const PERTH_MEETING_HREF =
  "mailto:hello@blockwise.sale?subject=Perth%20meeting%20request&body=Hi%20Blockwise%2C%0A%0AI%27d%20like%20to%20arrange%20a%20Perth%20meeting%20to%20talk%20through%20pricing.%0A";

export default function PricingPage() {
  return (
    <div className="hw-page pricing-page">
      <SiteHeader />
      <main>
        <section className="pricing-hero" aria-labelledby="pricing-title">
          <div className="pricing-shell">
            <p className="pricing-kicker">Pricing</p>
            <h1 id="pricing-title">Choose how much help you want.</h1>
            <p className="pricing-lead">
              Start free. Manage your own ads, or let us help.
            </p>
          </div>
        </section>

        <MarketPricing />

        <section className="pricing-clarity" aria-labelledby="pricing-clarity-title">
          <div className="pricing-shell pricing-clarity-layout">
            <h2 id="pricing-clarity-title">Built on clear terms.</h2>
            <ul className="pricing-clarity-points" aria-label="Billing clarity">
              <li>
                <Wallet aria-hidden size={22} strokeWidth={1.8} />
                <div>
                  <h3>Your ad account. Your media budget.</h3>
                  <p>
                    Meta ad spend is separate from every Blockwise plan. You pay Meta directly
                    from your connected ad account; Blockwise never marks up or silently funds
                    that spend.
                  </p>
                </div>
              </li>
              <li>
                <Building2 aria-hidden size={22} strokeWidth={1.8} />
                <div>
                  <h3>One brand per workspace.</h3>
                  <p>
                    Self-serve covers one brand, one workspace, and one primary Meta ad account.
                    Additional brands or client accounts need another workspace or a managed
                    agreement.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </section>
        <PricingFaq />

        <section
          className="pricing-final-cta"
          aria-labelledby="pricing-final-cta-title"
        >
          <div className="pricing-shell pricing-final-cta-inner">
            <div>
              <p className="pricing-kicker">Ready when you are</p>
              <h2 id="pricing-final-cta-title">Not sure which to choose?</h2>
              <p>
                You can start free, book a managed-service call, or request a
                Perth meeting.
              </p>
            </div>
            <div className="pricing-final-actions">
              <Button asChild size="lg" variant="outline" className="max-[760px]:w-full">
                <CtaLink href="/signup?offer=self-serve" location="pricing-final-start-free">
                  Start free
                </CtaLink>
              </Button>
              <Button asChild size="lg" variant="ghost" className="max-[760px]:w-full">
                <CtaLink href="/#managed-setup" location="pricing-final-managed-call">
                  Book a call
                </CtaLink>
              </Button>
              <Button asChild size="lg" variant="ghost" className="max-[760px]:w-full">
                <a href={PERTH_MEETING_HREF}>Arrange a Perth meeting</a>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
