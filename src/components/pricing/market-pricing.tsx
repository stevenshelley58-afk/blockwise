"use client";

import { Check, ChevronRight } from "lucide-react";
import { motion } from "motion/react";

import { CtaLink } from "@/components/landing/cta-link";
import { entrance, useReducedMotion } from "@/lib/motion";

const PLAN_SUMMARY = [
  {
    id: "free",
    name: "Free",
    price: "A$0",
    billing: "No Blockwise subscription fee",
    bestFor: "Trying Blockwise",
    outcome: "Create your first ads. No card needed.",
    features: [
      "Three Feed + Story ads",
      "One trial campaign",
      "Keep managing your ads for free",
    ],
    terms: "Ad spend is paid separately to Meta.",
    cta: {
      label: "Start free",
      href: "/signup?offer=self-serve",
      location: "pricing-summary-free",
    },
    featured: false,
  },
  {
    id: "self-serve",
    name: "Self-serve",
    price: "A$249",
    billing: "per month · until cancelled",
    bestFor: "Running your own ads",
    outcome: "Create, publish and track your ads.",
    features: [
      "Up to 50 Feed + Story packs/month",
      "Five team members",
      "One brand and Meta ad account",
      "Help when you need it",
    ],
    terms: "Ad spend is separate. GST included where required.",
    cta: {
      label: "Create three ads free",
      href: "/signup?offer=self-serve",
      location: "pricing-summary-self-serve",
    },
    featured: true,
  },
  {
    id: "managed",
    name: "Managed",
    price: "from A$1,500",
    billing: "per month · plus Meta ad spend",
    bestFor: "Getting it done for you",
    outcome: "We set up and manage your ads.",
    features: [
      "Everything in self-serve",
      "Up to four live campaigns",
      "Weekly improvements",
      "Monthly report",
    ],
    terms: "We agree the scope before you pay.",
    cta: {
      label: "Book a call",
      href: "/#managed-setup",
      location: "pricing-summary-managed",
    },
    featured: false,
  },
] as const;

const DETAIL_SECTIONS = [
  {
    id: "free-details",
    kicker: "Free",
    title: "Try it free.",
    intro:
      "Make three Feed + Story ads and try one campaign. Your 14 days start when your first ad runs on Meta.",
    rows: [
      [
        "After the trial",
        "Keep managing your ads for free, or choose a paid plan.",
      ],
      ["Your control", "You approve the ads and budget before launch."],
    ],
  },
  {
    id: "self-serve-details",
    kicker: "Self-serve",
    title: "Run your own ads.",
    intro: "Create ads, manage campaigns and see your results in one place.",
    rows: [
      ["Each month", "100 render credits—up to 50 Feed + Story packs."],
      [
        "Your team",
        "One brand, one Meta ad account and five email-verified members.",
      ],
    ],
  },
  {
    id: "managed-details",
    kicker: "Managed",
    title: "Let us handle the ads.",
    intro:
      "We set up your campaigns, improve them weekly and send you a monthly report.",
    rows: [
      ["Included", "Self-serve tools and up to four live campaigns."],
      [
        "Getting started",
        "We agree the work and price on a call before you pay.",
      ],
    ],
  },
] as const;

const formatPrice = (value: number) =>
  `A$${Math.round(value).toLocaleString("en-AU")}`;

export function MarketPricing() {
  const reduced = useReducedMotion();
  const { container, item } = entrance(reduced);

  return (
    <section className="pricing-offers" aria-label="Plans and pricing">
      <div className="pricing-shell">
        <motion.div
          id="pricing-summary"
          className="pricing-summary"
          aria-label="Plan prices at a glance"
          variants={container}
          initial="hidden"
          animate="visible"
        >
          {PLAN_SUMMARY.map((plan) => (
            <motion.article
              key={plan.id}
              className={
                plan.featured
                  ? "pricing-summary-card pricing-summary-card--featured"
                  : "pricing-summary-card"
              }
              aria-labelledby={`summary-${plan.id}-title`}
              variants={item}
            >
              <div className="pricing-summary-head">
                {plan.featured ? (
                  <span className="pricing-summary-badge">
                    For hands-on teams
                  </span>
                ) : null}
              </div>
              <h2
                id={`summary-${plan.id}-title`}
                className="pricing-summary-name"
              >
                {plan.name}
              </h2>
              <p className="pricing-summary-price">{plan.price}</p>
              <p className="pricing-summary-billing">{plan.billing}</p>
              <p className="pricing-summary-best">
                <strong>Best for</strong> {plan.bestFor}
              </p>
              <p className="pricing-summary-outcome">{plan.outcome}</p>
              <ul
                className="pricing-summary-features"
                aria-label={`${plan.name} inclusions`}
              >
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check aria-hidden size={16} strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <p className="pricing-summary-terms">{plan.terms}</p>
              <div className="pricing-summary-actions">
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
                <a
                  className="pricing-details-link"
                  href={`#${plan.id}-details`}
                >
                  See details{" "}
                  <ChevronRight aria-hidden size={15} strokeWidth={2} />
                </a>
              </div>
            </motion.article>
          ))}
        </motion.div>
        <p className="pricing-contact-rail">
          Need to talk it through?{" "}
          <CtaLink
            location="pricing-managed-call-under-cards"
            href="/#managed-setup"
            className="pricing-contact-link"
          >
            Book a call
          </CtaLink>{" "}
          <span aria-hidden>·</span>{" "}
          <a
            className="pricing-contact-link"
            href="mailto:hello@blockwise.sale?subject=Perth%20meeting%20request&body=Hi%20Blockwise%2C%0A%0AI%27d%20like%20to%20arrange%20a%20Perth%20meeting%20to%20talk%20through%20pricing.%0A"
          >
            Arrange a Perth meeting
          </a>
        </p>
        <div className="pricing-details-list">
          {DETAIL_SECTIONS.map((section) => (
            <article
              className="pricing-detail"
              id={section.id}
              key={section.id}
              aria-labelledby={`${section.id}-title`}
            >
              <div className="pricing-detail-copy">
                <p className="pricing-kicker">{section.kicker}</p>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                <p>{section.intro}</p>
              </div>
              <dl className="pricing-detail-rows">
                {section.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="pricing-detail-actions">
                <a
                  className="hw-btn hw-btn--dark"
                  href={
                    section.id === "managed-details"
                      ? "/#managed-setup"
                      : "/signup?offer=self-serve"
                  }
                >
                  {section.id === "managed-details"
                    ? "Book a call"
                    : "Start free"}
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
