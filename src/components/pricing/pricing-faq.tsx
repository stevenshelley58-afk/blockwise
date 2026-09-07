const FAQ_GROUPS = [
  {
    title: "Setup and customer work",
    questions: [
      {
        q: "What if I don’t have a Meta ad account?",
        a: "We can help you set up a Meta ad account, connect it to Blockwise and get your first ads ready. A Blockwise response is needed to confirm the meeting details.",
      },
      {
        q: "What do I need to provide?",
        a: "You provide your email to start, then the brand/property inputs and assets needed for your ads. For live publishing, connect your Meta ad account and review the final copy, creative, claims, pricing language and export.",
      },
      {
        q: "What is the managed-service process?",
        a: "Request a call first. Blockwise confirms the service scope and onboarding plan before payment; after that, you provide the required account and brand inputs and review customer-facing claims and creative.",
      },
    ],
  },
  {
    title: "Fit and plans",
    questions: [
      {
        q: "Who is the free option for?",
        a: "It is for agents who want to try the workflow before a subscription. You can create three complete Feed + Story ads and set up one live trial campaign with only your email.",
      },
      {
        q: "What happens after the free trial?",
        a: "You can keep running and managing your ads yourself for free, choose the A$249/month self-serve plan, or ask about managed service. There is no automatic Blockwise charge at the end of the trial.",
      },
    ],
  },
  {
    title: "Costs and ad spend",
    questions: [
      {
        q: "What does self-serve cost?",
        a: "Self-serve is A$249 per month until cancelled. It includes 100 render credits each billing period, up to 50 complete Feed + Story packs, one brand/workspace/primary Meta ad account, and five named, email-verified team members.",
      },
      {
        q: "Is Meta ad spend included?",
        a: "No. Meta bills advertising spend directly to your connected ad account. Meta spend is separate from every Blockwise plan and is not marked up or funded by Blockwise.",
      },
      {
        q: "How are taxes and extra charges handled?",
        a: "Prices include GST where Blockwise is required to collect it. Managed service starts at A$1,500/month; additional brands, ad accounts, campaign volume or other work need a written scope change and may be repriced.",
      },
    ],
  },
  {
    title: "Commitment and cancellation",
    questions: [
      {
        q: "Will the free trial charge my card?",
        a: "No. The free creation and trial campaign never charge you automatically and do not require a card. Checkout collects a payment method only when you choose to subscribe.",
      },
      {
        q: "How do I cancel self-serve?",
        a: "Cancel through Blockwise billing settings or the Stripe-hosted billing portal. Cancellation stops future renewals and credit grants; paid access and credits already granted remain available until the current billing period ends.",
      },
    ],
  },
  {
    title: "Support, ownership and results",
    questions: [
      {
        q: "Who owns my Meta account and data?",
        a: "Your Meta ad account and ad data remain yours, even if you leave Blockwise. Blockwise does not take ownership of your Meta assets, and Meta bills spend to your connected account.",
      },
      {
        q: "Does Blockwise guarantee leads or sales?",
        a: "No. Blockwise supports ad creation, publishing and reporting, but results depend on the market, offer, budget, audience and follow-up. Your agency remains responsible for final review and advertising claims.",
      },
      {
        q: "What support is included?",
        a: "Self-serve includes support when you are blocked. Managed service adds operator launch, weekly optimization for up to four live campaigns, and a monthly performance report.",
      },
    ],
  },
  {
    title: "Meetings",
    questions: [
      {
        q: "Can I talk to someone before choosing?",
        a: "Yes. Use Book a call to send a managed-service enquiry. A Blockwise response is needed to confirm the scope and meeting details.",
      },
      {
        q: "Can I arrange a Perth meeting?",
        a: "Yes. Use Arrange a Perth meeting to email hello@blockwise.sale with a request. Sending the request does not confirm a meeting; Blockwise will respond to arrange it.",
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
          <h2 id="pricing-faq-title">Clear answers before you choose.</h2>
          <p>
            Short version below; the full billing terms are in the{" "}
            <a href="/terms">Terms</a>.
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
