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
    bestFor: "Trying the workflow before committing",
    outcome: "Create, review, and optionally run your first ads.",
    features: [
      "Three complete Feed + Story ads",
      "One live trial campaign setup",
      "14-day trial starts when your first ad delivers",
      "Email-only start — no card",
      "Keep running and managing ads yourself",
    ],
    terms:
      "Meta ad spend is separate. The trial never charges you automatically.",
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
    bestFor: "Agents who want to run the work themselves",
    outcome: "Build, publish, and track campaigns in one place.",
    features: [
      "100 render credits each billing period",
      "Up to 50 complete Feed + Story packs",
      "One brand, workspace, and primary ad account",
      "Five named, email-verified team members",
    ],
    terms:
      "Meta ad spend is separate. Prices include GST where Blockwise is required to collect it.",
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
    bestFor: "Teams that want launch and optimization help",
    outcome:
      "An operator launches and reviews up to four live campaigns weekly.",
    features: [
      "Everything in self-serve",
      "Operator launch and weekly optimization",
      "Up to four live campaigns",
      "Monthly performance report",
    ],
    terms:
      "Scope is confirmed and repriced for additional brands, accounts, or campaign volume.",
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
    title: "Keep exploring without a subscription.",
    intro:
      "Start with only your email. Create three complete Feed + Story ads, review them, and set up one live trial campaign. The 14-day trial starts when your first ad delivers. You approve the campaign budget and end date with Meta before anything runs.",
    rows: [
      [
        "Process",
        "Create → review → optionally connect Meta and approve the trial campaign.",
      ],
      [
        "You provide",
        "Your email, the ad inputs and assets you want to use, plus final review before launch.",
      ],
      [
        "What is not included",
        "Meta media spend is paid directly to Meta. There is no Blockwise subscription fee, but free does not mean free advertising.",
      ],
      [
        "After the trial",
        "You can keep running and managing ads yourself for free, choose the A$249/month self-serve plan, or ask about managed service.",
      ],
    ],
  },
  {
    id: "self-serve-details",
    kicker: "Self-serve",
    title: "The operating plan for your own team.",
    intro:
      "Build on the free creation flow, then subscribe only when you choose. Checkout collects a reusable payment method and starts the A$249 monthly subscription; there is no automatic charge at the end of the free trial.",
    rows: [
      [
        "Process",
        "Create and review → subscribe in Checkout → connect your Meta account when you are ready to publish → monitor status, spend, clicks and leads.",
      ],
      [
        "You provide",
        "Your brand and property inputs, connected Meta access for live publishing, and your team’s final review of claims, pricing language and export.",
      ],
      [
        "What is not included",
        "Meta media spend is separate and paid from your connected account. Additional brands or unrelated client accounts need another workspace or a managed agreement.",
      ],
      [
        "Support and ownership",
        "Support is available when you are blocked. Your Meta ad account and ad data remain yours; Blockwise does not take ownership of your Meta assets.",
      ],
    ],
  },
  {
    id: "managed-details",
    kicker: "Managed service",
    title: "Hands-on launch, with the scope agreed first.",
    intro:
      "Book a call so Blockwise can understand the account, confirm the onboarding plan and agree the service scope before payment. A booking request is not a confirmed meeting until Blockwise responds.",
    rows: [
      [
        "Process",
        "Request a call → confirm scope and onboarding → provide the required account and brand inputs → operator launch and weekly optimization.",
      ],
      [
        "You provide",
        "Your goals, brand and campaign context, access to the Meta ad account, and timely review of customer-facing claims and creative.",
      ],
      [
        "What is included",
        "The complete self-serve product, 100 monthly render credits, one brand, one Meta ad account, up to four live campaigns and a monthly report.",
      ],
      [
        "What is not included",
        "Meta media spend is separate. Additional brands, ad accounts, campaign volume or other work require a written scope change and may be repriced.",
      ],
    ],
  },
] as const;

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
                <a className="pricing-details-link" href="#pricing-summary">
                  Back to plans{" "}
                  <ChevronRight aria-hidden size={15} strokeWidth={2} />
                </a>
                <a className="pricing-details-link" href="/#managed-setup">
                  Talk it through
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
