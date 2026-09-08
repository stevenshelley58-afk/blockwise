import { ArrowRight, Check } from "lucide-react";
import { HOMEPAGE_PLANS } from "@/lib/homepage-concept/pricing";

export function HomepagePricing() {
  return (
    <section className="hc-pricing" id="pricing" aria-labelledby="hc-pricing-heading">
      <div className="hc-shell">
        <h2 id="hc-pricing-heading">Choose how much<br />help you want.</h2>
        <div className="hc-pricing-grid">
          {HOMEPAGE_PLANS.map((plan) => (
            <article className={`hc-plan${plan.featured ? " hc-plan--featured" : ""}`} key={plan.id} aria-labelledby={`hc-plan-${plan.id}`}>
              <header>
                <h3 id={`hc-plan-${plan.id}`}>{plan.name}</h3>
                <p className="hc-plan-for">{plan.bestFor}</p>
              </header>
              <div className="hc-plan-cost">
                <p className="hc-plan-price">{plan.price.startsWith("from ") ? <><span>from </span>{plan.price.slice(5)}</> : plan.price}</p>
                <p className="hc-plan-billing">{plan.billing}</p>
              </div>
              <p className="hc-plan-outcome">{plan.outcome}</p>
              <ul>
                {plan.features.map((feature) => <li key={feature}><Check size={17} aria-hidden="true" /><span>{feature}</span></li>)}
              </ul>
              <div className="hc-plan-actions">
                <p className="hc-plan-terms">{plan.terms}</p>
                <a className="hc-plan-cta" href={`https://blockwise.sale${plan.cta.href}`}>{plan.cta.label}<ArrowRight size={17} aria-hidden="true" /></a>
                <a className="hc-plan-details" href={`https://blockwise.sale/pricing#${plan.id}-details`} aria-label={`${plan.name} plan details`}>See details</a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
