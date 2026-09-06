"use client";

import { Check } from "lucide-react";

import { CtaLink } from "@/components/landing/cta-link";

const PLAN_SUMMARY = [
  {
    id: "free",
    name: "Free",
    price: "A$0",
    per: "",
    note: "Three complete ads and one trial campaign. No card.",
    cta: { label: "Start free", href: "/signup?offer=self-serve", location: "pricing-summary-free" },
    featured: false,
  },
  {
    id: "self-serve",
    name: "Self-serve",
    price: "A$249",
    per: "/month",
    note: "Build, publish, and track in one place.",
    cta: { label: "Create three ads free", href: "/signup?offer=self-serve", location: "pricing-summary-self-serve" },
    featured: true,
  },
  {
    id: "managed",
    name: "Managed",
    price: "A$1,500",
    per: "/month from",
    note: "Operator launch and weekly optimization. Plus Meta ad spend.",
    cta: { label: "Book a call", href: "/#managed-setup", location: "pricing-summary-managed" },
    featured: false,
  },
] as const;

const FREE_FEATURES = [
  "Three complete Feed + Story ads",
  "One live trial campaign setup included",
  "Only your email to start — no password, no card",
  "Upgrade to self-serve whenever you choose to launch",
] as const;

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
  return (
    <section className="pricing-offers" aria-label="Plans and pricing">
      <div className="pricing-shell">
        <div className="pricing-summary" aria-label="Plan prices at a glance">
          {PLAN_SUMMARY.map((plan) => (
            <article
              key={plan.id}
              className={
                plan.featured
                  ? "pricing-summary-card pricing-summary-card--featured"
                  : "pricing-summary-card"
              }
              aria-labelledby={`summary-${plan.id}-title`}
            >
              <h3 id={`summary-${plan.id}-title`}>{plan.name}</h3>
              <p className="pricing-summary-price">
                <strong>{plan.price}</strong>
                {plan.per ? <span>{plan.per}</span> : null}
              </p>
              <p className="pricing-summary-note">{plan.note}</p>
              <CtaLink
                location={plan.cta.location}
                href={plan.cta.href}
                className={
                  plan.featured
                    ? "hw-btn hw-btn--dark"
                    : "hw-btn hw-btn--outline"
                }
              >
                {plan.cta.label}
              </CtaLink>
            </article>
          ))}
        </div>

        <article className="pricing-free-details" aria-labelledby="free-title">
          <div className="pricing-free-copy">
            <p className="pricing-kicker">Free</p>
            <h2 id="free-title">Build the ads before you pay.</h2>
            <p>
              Every plan starts here. Create three complete Feed + Story ads with only your
              email, and launch a trial campaign before adding a card.
            </p>
          </div>
          <ul aria-label="Free plan features">
            {FREE_FEATURES.map((feature) => (
              <li key={feature}>
                <Check aria-hidden size={17} strokeWidth={2.5} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="pricing-self-serve" aria-labelledby="self-serve-title">
          <div className="pricing-plan-intro">
            <p className="pricing-kicker">Self-serve with assistance</p>
            <h2 id="self-serve-title">Build, publish, and track in one place.</h2>
            <p>
              Start without a card. When you choose to subscribe, checkout collects a payment
              method and clearly shows the renewal schedule.
            </p>
          </div>

          <div className="pricing-amount" aria-label="A$249 per month">
            <div>
              <span className="pricing-amount-label">Monthly subscription</span>
              <strong>A$249</strong>
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
                location="pricing-self-serve"
                href="/signup?offer=self-serve"
                className="hw-btn hw-btn--dark"
              >
                Create three ads free
              </CtaLink>
              <p>Only your email to start. No password. No card.</p>
            </div>
          </div>

          <p className="pricing-consent-note">
            Three complete ads and one trial campaign are free — no card. Your Meta ad spend is
            separate. When you choose to subscribe, your Blockwise subscription starts at A$249
            monthly until cancelled.
          </p>
        </article>

        <article className="pricing-managed" aria-labelledby="managed-title">
          <div className="pricing-managed-copy">
            <p className="pricing-kicker">Managed service</p>
            <h2 id="managed-title">Strategy and weekly optimization included.</h2>
            <p>
              From <strong>A$1,500/month</strong>, plus Meta ad spend. Scope beyond the standard
              engagement is confirmed and repriced during onboarding.
            </p>
            <div className="pricing-managed-actions">
              <CtaLink
                location="pricing-managed-call"
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
