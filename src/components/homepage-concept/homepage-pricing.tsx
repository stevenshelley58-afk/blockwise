import { ArrowRight, Check, ExternalLink } from "lucide-react";

import { HOMEPAGE_PLANS } from "@/lib/homepage-concept/pricing";

import "./homepage-pricing.css";

export function HomepagePricing() {
  return (
    <section className="hp-pricing" id="pricing" aria-labelledby="hp-pricing-heading">
      <div className="hc-shell">
        <div className="hp-pricing-heading">
          <h2 id="hp-pricing-heading">Start free. Choose more help when you need it.</h2>
          <p>Every option keeps Meta ad spend separate. Paid plans only start when you choose one.</p>
        </div>
        <div className="hp-pricing-grid">
          {HOMEPAGE_PLANS.map((plan) => (
            <article className={`hp-plan${plan.featured ? " hp-plan--featured" : ""}`} key={plan.id} aria-labelledby={`hp-plan-${plan.id}`}>
              <header className="hp-plan-header">
                <h3 id={`hp-plan-${plan.id}`}>{plan.name}</h3>
                <p className="hp-plan-price">{plan.price}</p>
                <p className="hp-plan-billing">{plan.billing}</p>
              </header>
              <p className="hp-plan-outcome">{plan.outcome}</p>
              <ul className="hp-plan-included">
                {plan.included.map((item) => <li key={item}><Check size={16} aria-hidden="true" /><span>{item}</span></li>)}
              </ul>
              <details className="hp-plan-details">
                <summary>More plan details</summary>
                <ul>
                  {plan.details.map((item) => <li key={item}><Check size={15} aria-hidden="true" /><span>{item}</span></li>)}
                </ul>
              </details>
              <p className="hp-plan-terms">{plan.terms}</p>
              <a className="hp-plan-cta" href={plan.cta.href} data-cta-location={plan.cta.location}>
                {plan.cta.label}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <a className="hp-plan-details-link" href={plan.detailsHref}>
                Plan details on the current site <ExternalLink size={13} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
        <ol className="hp-pricing-sequence" aria-label="Starting with Blockwise">
          <li><strong>1.</strong><span>Start with the free allowance.</span></li>
          <li><strong>2.</strong><span>Create your ads and choose a campaign.</span></li>
          <li><strong>3.</strong><span>Pick a paid plan only when it suits you.</span></li>
        </ol>
      </div>
    </section>
  );
}
