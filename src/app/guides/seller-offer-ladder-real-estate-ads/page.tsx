import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "Stop showing every homeowner the same appraisal ad";
const description =
  "Replace a single high-commitment offer with a seller offer ladder that meets homeowners at every stage of intent.";
const canonical = "/guides/seller-offer-ladder-real-estate-ads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/offer-ladder/hero.webp", width: 1920, height: 1080, alt: "A four-step ladder representing increasing homeowner commitment levels" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/offer-ladder/hero.webp"] },
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: title,
  description,
  datePublished: "2026-07-24",
  dateModified: "2026-07-24",
  author: { "@type": "Organization", name: "Blockwise" },
  publisher: { "@type": "Organization", name: "Blockwise", url: "https://blockwise.sale" },
  image: "https://blockwise.sale/guides/offer-ladder/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Should I stop running appraisal ads entirely?",
      acceptedAnswer: { "@type": "Answer", text: "No. The appraisal is the top of the ladder — it belongs there. The problem is running it as the only offer. Keep the appraisal ad, but surround it with lower-commitment offers that capture homeowners who are not ready for that step yet." },
    },
    {
      "@type": "Question",
      name: "How many offer levels should I start with?",
      acceptedAnswer: { "@type": "Answer", text: "Start with two: a surface-level offer like a sold-price list and the appraisal. Once those are running and you have follow-up in place, add a transition-level offer. The full four-level ladder is the goal, but you do not need to build it all at once." },
    },
    {
      "@type": "Question",
      name: "Won't lower-commitment offers just attract tyre-kickers?",
      acceptedAnswer: { "@type": "Answer", text: "Some leads from surface-level offers will not be sellers. That is expected. The qualifying question on the form and the follow-up conversation will separate genuine owners from curious neighbours. The value is identifying owners who care enough about their market to raise their hand." },
    },
    {
      "@type": "Question",
      name: "Should the same lead see ads from multiple levels?",
      acceptedAnswer: { "@type": "Answer", text: "Yes, and this happens naturally. A homeowner who downloads a sold-price list may later see a renovation guide or an appraisal ad. The ladder is not a linear path — it is a set of entry points that Meta can match to the same person at different times." },
    },
  ],
};

export default function SellerOfferLadderGuidePage() {
  return (
    <GuidesShell>
      <ArticleProgress />
      <main id="main-content">
        <article className="bw-article">
          <header className="bw-article-hero">
            <div className="bw-article-hero-copy">
              <div className="bw-article-breadcrumbs">
                <Link href="/guides">Guides</Link>
                <span aria-hidden>/</span>
                <span>Offer strategy</span>
              </div>
              <p className="bw-guides-label">The offer ladder guide</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                Most homeowners who see a real estate ad are not ready to invite an agent into their home. A ladder of offers gives each person a reasonable next step.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>11 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/offer-ladder/hero.webp"
                alt="A four-step ladder representing increasing homeowner commitment levels"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#commitment-gap">The commitment gap</a>
              <a href="#step-framework">The STEP framework</a>
              <a href="#surface">Level S — Surface</a>
              <a href="#transition">Level T — Transition</a>
              <a href="#engage">Level E — Engage</a>
              <a href="#purchase">Level P — Purchase</a>
              <a href="#example">A practical example</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="commitment-gap">
                <p className="bw-drop-intro">
                  <span>The appraisal ad is not dead. It is being asked to do too much.</span> Most homeowners who see a real estate advertisement are not ready to invite an agent into their home. Some are curious. Some are watching the market. Some are planning a move next year. A direct appraisal request is appropriate for a small part of that audience. Showing it to everyone forces homeowners to choose between a high-commitment enquiry and doing nothing. Most choose nothing.
                </p>

                <div className="bw-contrast-row">
                  <div><span>High commitment</span><strong>"Request a free appraisal" — implies a phone call, a visit, a sales process</strong></div>
                  <div><span>Low commitment</span><strong>"See recent comparable sales" — implies information, not a conversation</strong></div>
                </div>

                <aside className="bw-compliance-note">
                  <strong>Housing compliance</strong>
                  <p>Real estate campaigns on Meta require selecting the Special Ad Category: Housing. This applies regardless of which offer level you are running — a sold-price list is still a housing-related ad.</p>
                  <a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">Read the housing ads policy →</a>
                </aside>
              </section>

              <section id="step-framework" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The STEP framework</span>
                  <h2>Four levels of homeowner intent.</h2>
                  <p>If every ad in your account sits at level P, you are asking the entire market to skip three steps.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>S</b><div><h3>Surface</h3><p>Local information with no personal disclosure.</p><span>Name and email — sold-price list</span></div></div>
                  <div className="bw-list-item"><b>T</b><div><h3>Transition</h3><p>Property-specific education for early decisions.</p><span>Name, email, property type — renovation guide</span></div></div>
                  <div className="bw-list-item"><b>E</b><div><h3>Engage</h3><p>Individual advice involving a conversation.</p><span>Name, email, phone — strategy call</span></div></div>
                  <div className="bw-list-item"><b>P</b><div><h3>Purchase</h3><p>A formal appointment tied to a listing decision.</p><span>Full details — in-person appraisal</span></div></div>
                </div>
              </section>

              <section id="surface" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Level S — Surface</span>
                  <h2>Local information, low commitment.</h2>
                </div>
                <p>These offers help homeowners understand their immediate market without declaring an intention to sell: a recent sold-price list for a specific property type, a quarterly suburb snapshot, a buyer-demand update.</p>
                <p>The commitment is low: a name and an email. The value is in identifying owners who care enough about recent comparable sales to ask for the detail.</p>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Form fields</span><span>Keep it short</span></div>
                  <blockquote>Full name, email, one qualifying question: "Do you own a home of this type in [Suburb]?"</blockquote>
                </div>
                <aside className="bw-compliance-note">
                  <strong>Consent</strong>
                  <p>If you plan to send monthly updates, ask for express consent in plain language. Commercial email and SMS require consent, accurate sender identification and a working unsubscribe method.</p>
                  <a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Read the ACMA guidance →</a>
                </aside>
              </section>

              <section id="transition" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Level T — Transition</span>
                  <h2>Property-specific education.</h2>
                </div>
                <p>These offers help the owner make an early decision: a renovate-or-sell assessment, a pre-sale preparation checklist, a guide to selling costs, a timeline from appraisal to settlement.</p>
                <p>The owner is beginning to consider action but may not be comparing agents. The form can ask for slightly more — property type — because the offer is property-specific.</p>
                <div className="bw-contrast-row">
                  <div><span>Wrong follow-up</span><strong>"When are you selling?" — jumps ahead of the conversation</strong></div>
                  <div><span>Right follow-up</span><strong>"Which part of the guide were you working through?"</strong></div>
                </div>
              </section>

              <section id="engage" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Level E — Engage</span>
                  <h2>Individual advice with a conversation.</h2>
                </div>
                <p>These offers require more involvement: a desktop property review, a 15-minute pricing strategy call, a suburb-specific sales analysis. The owner provides a phone number and agrees to a conversation — but it is still not an appraisal.</p>
                <p>This is the bridge between passive interest and active selling. Some owners will never move from Surface directly to Purchase — the jump is too large. Engage gives them a reason to talk to you first.</p>
              </section>

              <section id="purchase" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Level P — Purchase</span>
                  <h2>The appraisal, surrounded.</h2>
                </div>
                <p>The appraisal remains the highest-commitment offer, appropriate for the active seller comparing agents. The difference is that it is now one of several offers, not the only one. It is strongest when surrounded by lower-commitment offers that warmed the homeowner first.</p>
              </section>

              <section id="example" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>Four ads for Como</span>
                  <h2>A practical example for one suburb.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Four ads for the Como suburb at different commitment levels">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Level</span><span role="columnheader">Headline</span><span role="columnheader">Offer</span></div>
                  <div role="row"><strong role="cell">Surface</strong><span role="cell">What 3-bed Como homes sold for this quarter</span><span role="cell">Download the sales list</span></div>
                  <div role="row"><strong role="cell">Transition</strong><span role="cell">Renovate before selling, or leave it alone?</span><span role="cell">Get the pre-sale guide</span></div>
                  <div role="row"><strong role="cell">Engage</strong><span role="cell">Planning to sell in Como this year?</span><span role="cell">Book a 15-min strategy call</span></div>
                  <div role="row"><strong role="cell">Purchase</strong><span role="cell">Ready for an in-person appraisal?</span><span role="cell">Book a property consultation</span></div>
                </div>
                <p>These ads support the same commercial objective. They approach it through different homeowner situations and different commitment levels.</p>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Give every homeowner a next step they can take.</h2>
                  <p>The offer ladder is a strategy you can run with any tool. Blockwise makes the execution faster and more consistent: preparing the creative for each offer level, building the lead form with the right fields and consent language for each stage, and bringing leads from all levels into one review queue.</p>
                </div>
                <Link href="/signup">Build your ladder <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Should I stop running appraisal ads entirely?</summary><p>No. The appraisal is the top of the ladder — it belongs there. The problem is running it as the only offer. Keep the appraisal ad, but surround it with lower-commitment offers that capture homeowners who are not ready for that step yet.</p></details>
                <details><summary>How many offer levels should I start with?</summary><p>Start with two: a surface-level offer like a sold-price list and the appraisal. Once those are running and you have follow-up in place, add a transition-level offer. The full four-level ladder is the goal, but you do not need to build it all at once.</p></details>
                <details><summary>Won't lower-commitment offers just attract tyre-kickers?</summary><p>Some leads from surface-level offers will not be sellers. That is expected. The qualifying question on the form and the follow-up conversation will separate genuine owners from curious neighbours. The value is identifying owners who care enough about their market to raise their hand.</p></details>
                <details><summary>Should the same lead see ads from multiple levels?</summary><p>Yes, and this happens naturally. A homeowner who downloads a sold-price list may later see a renovation guide or an appraisal ad. The ladder is not a linear path — it is a set of entry points that Meta can match to the same person at different times.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">About ads for housing, Meta Business Help Center</a></li>
                  <li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">Direct marketing, Office of the Australian Information Commissioner</a></li>
                  <li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Avoid sending spam, Australian Communications and Media Authority</a></li>
                </ol>
              </footer>
            </div>
          </div>
        </article>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </GuidesShell>
  );
}
