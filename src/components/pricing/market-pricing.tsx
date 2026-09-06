"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { CtaLink } from "@/components/landing/cta-link";

type Market = "us" | "au";

const OFFERS = {
  us: {
    name: "United States",
    shortName: "US",
    monthly: "US$149",
    managed: "US$1,500",
  },
  au: {
    name: "Australia",
    shortName: "AU",
    monthly: "A$249",
    managed: "A$2,500",
  },
} as const;

const SELF_SERVE_FEATURES = [
  "Three complete Feed + Story ads before payment",
  "One live trial campaign before you subscribe",
  "100 render credits each paid month",
  "Up to 50 complete Feed + Story packs",
  "One Brand Pack, workspace, and primary Meta ad account",
  "Five named, email-verified team members",
  "Campaign publishing, reporting, and support when blocked",
] as const;

const MANAGED_FEATURES = [
  "Everything in self-serve",
  "Operator launch and weekly optimization",
  "Up to four live campaigns",
  "One brand and one Meta ad account",
  "Monthly performance report",
] as const;

export function MarketPricing() {
  const [market, setMarket] = useState<Market>("au");
  const offer = OFFERS[market];

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

        <article className="pricing-self-serve" aria-labelledby="self-serve-title">
          <div className="pricing-plan-intro">
            <p className="pricing-kicker">Self-serve with assistance</p>
            <h2 id="self-serve-title">Build, publish, and track in one place.</h2>
            <p>
              Start without a card. When you choose to subscribe, checkout collects a payment
              method and clearly shows the renewal schedule.
            </p>
          </div>

          <div className="pricing-amount" aria-label={`${offer.monthly} per month`}>
            <div>
              <span className="pricing-amount-label">Monthly subscription</span>
              <strong>{offer.monthly}</strong>
              <span className="pricing-per">/month</span>
            </div>
          </div>

          <div className="pricing-self-serve-body">
            <ul aria-label="Self-serve plan features">
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
            Three complete ads and one trial campaign are free — no card. Your Meta ad spend is
            separate. When you choose to subscribe, your Blockwise subscription starts at{" "}
            {offer.monthly} monthly until cancelled.
          </p>
        </article>

        <article className="pricing-managed" aria-labelledby="managed-title">
          <div className="pricing-managed-copy">
            <p className="pricing-kicker">Managed service</p>
            <h2 id="managed-title">Strategy and weekly optimization included.</h2>
            <p>
              From <strong>{offer.managed}/month</strong>, plus Meta ad spend. Scope beyond the
              standard engagement is confirmed and repriced during onboarding.
            </p>
            <div className="pricing-managed-actions">
              <CtaLink
                location={`pricing-managed-call-${market}`}
                href="/#managed-setup"
                className="hw-btn hw-btn--dark"
              >
                Book a managed-service call
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
