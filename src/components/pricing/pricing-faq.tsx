const FAQ_GROUPS = [
  {
    title: "Getting started",
    questions: [
      {
        q: "What if I don’t have a Meta ad account?",
        a: "We can help you set up a Meta ad account and connect it to Blockwise.",
      },
      {
        q: "What do I need to provide?",
        a: "Your email to start, then your branding, photos and ad details. You review everything before launch.",
      },
      {
        q: "How does managed service start?",
        a: "Book a call. We agree the scope and price before getting started.",
      },
    ],
  },
  {
    title: "Plans",
    questions: [
      {
        q: "What does the free option include?",
        a: "Try three Feed + Story ads and one campaign without a Blockwise subscription.",
      },
      {
        q: "What happens after the free trial?",
        a: "Keep running your ads yourself for free, or choose self-serve or managed. No automatic upgrade.",
      },
    ],
  },
  {
    title: "Costs",
    questions: [
      {
        q: "What does self-serve cost?",
        a: "A$249/month until cancelled. Your ad spend is separate.",
      },
      {
        q: "Is Meta ad spend included?",
        a: "No. You pay Meta directly through your own ad account.",
      },
      {
        q: "How are taxes and extras handled?",
        a: "GST is included where required. Extra brands, accounts or campaigns are quoted separately.",
      },
    ],
  },
  {
    title: "Billing",
    questions: [
      {
        q: "Will the free trial charge my card?",
        a: "No card needed. You only pay Blockwise if you choose a paid plan.",
      },
      {
        q: "How do I cancel self-serve?",
        a: "Cancel in billing settings or the Stripe portal to stop renewals. Paid access and remaining credits last until the billing period ends.",
      },
    ],
  },
  {
    title: "Ownership and support",
    questions: [
      {
        q: "Who owns my Meta ad account and ad data?",
        a: "You do—even if you leave Blockwise.",
      },
      {
        q: "Does Blockwise guarantee leads or sales?",
        a: "No. Results depend on your market, offer, budget and follow-up.",
      },
      {
        q: "What support is included?",
        a: "Self-serve includes help when you’re stuck. Managed adds setup and weekly campaign reviews.",
      },
    ],
  },
  {
    title: "Let’s talk",
    questions: [
      {
        q: "Can I talk to someone before choosing?",
        a: "Yes. Book a call and we’ll arrange a time.",
      },
      {
        q: "Can I arrange a Perth meeting?",
        a: "Yes. Request a Perth meeting by email and we’ll arrange the details.",
      },
    ],
  },
] as const;

export function PricingFaq() {
  return (
    <section className="pricing-faq" aria-labelledby="pricing-faq-title">
      <div className="pricing-shell">
        <div className="pricing-faq-heading">
          <p className="pricing-kicker">Questions</p>
          <h2 id="pricing-faq-title">FAQ</h2>
          <p>
            See our <a href="/terms">Terms</a> for the details.
          </p>
        </div>
        <div className="pricing-faq-groups">
          {FAQ_GROUPS.map((group, groupIndex) => (
            <section
              className="pricing-faq-group"
              aria-labelledby={`pricing-faq-group-${groupIndex}`}
              key={group.title}
            >
              <h3 id={`pricing-faq-group-${groupIndex}`}>{group.title}</h3>
              <div className="pricing-faq-list">
                {group.questions.map((faq, questionIndex) => (
                  <details
                    className="pricing-faq-item"
                    key={faq.q}
                    open={groupIndex === 0 && questionIndex === 0}
                  >
                    <summary className="pricing-faq-question">
                      <span>{faq.q}</span>
                      <span className="pricing-faq-icon" aria-hidden>
                        +
                      </span>
                    </summary>
                    <div className="pricing-faq-answer">
                      <p>{faq.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
