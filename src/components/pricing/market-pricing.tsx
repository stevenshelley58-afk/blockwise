"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { CtaLink } from "@/components/landing/cta-link";
import {
  formatBillingAmount,
  getBillingOffer,
  type BillingMarket,
} from "@/lib/billing/offers";

type Market = Lowercase<BillingMarket>;

const OFFERS = {
  us: {
    name: "United States",
    shortName: "US",
    market: "US",
  },
  au: {
    name: "Australia",
    shortName: "AU",
    market: "AU",
  },
} as const satisfies Record<Market, { name: string; shortName: string; market: BillingMarket }>;

const SELF_SERVE_FEATURES = [
  "Three image ads with Feed and Story/Reels-ready creative",
  "One free three-day campaign before subscribing",
  "100 render credits each paid month",
  "Up to 50 complete Feed + Story packs",
  "One Brand Pack, workspace, and primary Meta ad account",
  "Five named, email-verified team members",
  "Campaign publishing, reporting, and support when blocked",
] as const;

const MANAGED_FEATURES = [
  "Everything in Blockwise LeadGen",
  "Campaign launch and weekly optimisation",
  "Up to four live campaigns",
  "One brand and one Meta ad account",
  "Monthly performance report",
] as const;

export function MarketPricing() {
  const [market, setMarket] = useState<Market>("au");
  const marketDetails = OFFERS[market];
  const selfServeOffer = getBillingOffer(marketDetails.market, "self_serve");
  const managedOffer = getBillingOffer(marketDetails.market, "managed");
  const firstMonth = formatBillingAmount(
    selfServeOffer.firstInvoiceAmount,
    selfServeOffer.currency,
  );
  const renewal = formatBillingAmount(
    selfServeOffer.recurringAmount,
    selfServeOffer.currency,
  );
  const managed = formatBillingAmount(
    managedOffer.recurringAmount,
    managedOffer.currency,
  );

  return (
    <section className="pricing-offers" aria-label="Plans and market pricing">
      <div className="pricing-shell">
        <fieldset className="pricing-market" aria-describedby="pricing-market-note">
          <legend>Choose your market</legend>
          <div className="pricing-market-switch">
            {(Object.keys(OFFERS) as Market[]).map((value) => (
              <button
                key={value}
                type="button"
                className="pricing-market-option"
                aria-pressed={market === value}
                onClick={() => setMarket(value)}
              >
                <span aria-hidden>{OFFERS[value].shortName}</span>
                {OFFERS[value].name}
              </button>
            ))}
          </div>
          <p id="pricing-market-note">
            Prices below are shown in {market === "us" ? "US dollars" : "Australian dollars"}.
            You&rsquo;ll confirm your market before checkout.
          </p>
        </fieldset>

        <article className="pricing-self-serve" aria-labelledby="blockwise-platform-title">
          <div className="pricing-plan-intro">
            <p className="pricing-kicker">Blockwise LeadGen</p>
            <h2 id="blockwise-platform-title">Create, publish and track your Meta ads in one place.</h2>
            <p>
              Start without a card and run one three-day campaign free. Subscribe only when you
              want to continue.
            </p>
          </div>

          <div className="pricing-amount" aria-label={`${firstMonth} first month, then ${renewal} per month`}>
            <div>
              <span className="pricing-amount-label">First paid month</span>
              <strong>{firstMonth}</strong>
            </div>
            <span className="pricing-then" aria-hidden>then</span>
            <div>
              <span className="pricing-amount-label">Following months</span>
              <strong>{renewal}</strong>
              <span className="pricing-per">/month</span>
            </div>
          </div>

          <div className="pricing-self-serve-body">
            <ul aria-label="Blockwise LeadGen features">
              {SELF_SERVE_FEATURES.map((feature) => (
                <li key={feature}>
                  <Check aria-hidden size={17} strokeWidth={2.5} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <div className="pricing-action-block">
              <CtaLink
                location={`pricing-self-serve-${market}`}
                href={`/signup?offer=self-serve&market=${market}`}
                className="hw-btn hw-btn--dark"
              >
                Create three ads free
              </CtaLink>
              <p>Only your email to start. No password. No card.</p>
            </div>
          </div>

          <p className="pricing-consent-note">
            {selfServeOffer.checkoutDisclosure}
          </p>
        </article>

        <article className="pricing-managed" aria-labelledby="managed-title">
          <div className="pricing-managed-copy">
            <p className="pricing-kicker">Managed service</p>
            <h2 id="managed-title">Launch, weekly optimisation and reporting included.</h2>
            <p>
              <strong>{managed}/month</strong> in either market, plus Meta ad spend. Additional
              brands, ad accounts, or campaign volume require a written scope change.
            </p>
            <div className="pricing-managed-actions">
              <CtaLink
                location={`pricing-managed-start-${market}`}
                href="/#managed-setup"
                className="hw-btn hw-btn--dark"
              >
                Book a 15-minute walkthrough
              </CtaLink>
            </div>
          </div>
          <ul aria-label="Managed service features">
            {MANAGED_FEATURES.map((feature) => (
              <li key={feature}>
                <Check aria-hidden size={17} strokeWidth={2.5} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
