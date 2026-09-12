import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HOMEPAGE_PLANS } from "@/lib/homepage-concept/pricing";

import "./homepage-pricing.css";

export function HomepagePricing() {
  return (
    <section className="hp-pricing" id="pricing" aria-labelledby="hp-pricing-heading">
      <div className="hc-shell">
        <div className="hp-pricing-heading">
          <h2 id="hp-pricing-heading">Try the app free. Choose what comes next.</h2>
          <p>Create your first ads with no Blockwise subscription fee.
            No card is needed to start. You choose whether to continue.</p>
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
              <Button
                asChild
                size="lg"
                variant={plan.featured ? "default" : "outline"}
                className="mt-[18px] max-[760px]:col-span-2 max-[760px]:mt-[15px]"
              >
                <a href={plan.cta.href} data-cta-location={plan.cta.location}>
                  {plan.cta.label}
                </a>
              </Button>
              {plan.note ? <p className="hp-plan-note">{plan.note}</p> : null}
              <details className="hp-plan-details">
                <summary>More plan details</summary>
                <ul>
                  {plan.details.map((item) => <li key={item}><Check size={15} aria-hidden="true" /><span>{item}</span></li>)}
                </ul>
              </details>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
