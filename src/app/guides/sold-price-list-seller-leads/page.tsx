import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "How to generate seller leads with a sold-price list";
const description =
  "Build a suburb sold-price list, promote it with a Meta lead ad, and follow up with Australian homeowners without leading with an appraisal request.";
const canonical = "/guides/sold-price-list-seller-leads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/sold-price-list/hero.webp", width: 1920, height: 1080, alt: "Established Australian homes along a tree-lined suburban street" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/sold-price-list/hero.webp"] },
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: title,
  description,
  datePublished: "2026-07-15",
  dateModified: "2026-07-15",
  author: { "@type": "Organization", name: "Blockwise" },
  publisher: { "@type": "Organization", name: "Blockwise", url: "https://blockwise.sale" },
  image: "https://blockwise.sale/guides/sold-price-list/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Is a sold-price list the same as a property valuation?",
      acceptedAnswer: { "@type": "Answer", text: "No. It provides recent local market evidence for a defined group of properties, not a valuation of a specific home." },
    },
    {
      "@type": "Question",
      name: "Should I use an instant form or a website form?",
      acceptedAnswer: { "@type": "Answer", text: "An instant form is a sensible first test for a fast mobile submission. A website form suits flows that need more explanation or an on-site action." },
    },
    {
      "@type": "Question",
      name: "How often should I update the list?",
      acceptedAnswer: { "@type": "Answer", text: "Choose a frequency you can maintain. Monthly can suit an active suburb, while slower markets may need a longer interval." },
    },
  ],
};

export default function SoldPriceListGuidePage() {
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
                <span>Seller leads</span>
              </div>
              <p className="bw-guides-label">The practical playbook</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                Stop asking homeowners to declare they are selling. Give them the local evidence they are already looking for.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>15 July 2026</span>
                <span>12 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/sold-price-list/hero.webp"
                alt="Established Australian homes along a tree-lined suburban street"
                fill
                priority
                sizes="100vw"
              />
              <div className="bw-hero-map-key" aria-hidden>
                <span>One suburb</span>
                <span>One home type</span>
                <span>One useful list</span>
              </div>
              <div className="bw-hero-pin bw-hero-pin-one" aria-hidden><span /></div>
              <div className="bw-hero-pin bw-hero-pin-two" aria-hidden><span /></div>
              <div className="bw-hero-pin bw-hero-pin-three" aria-hidden><span /></div>
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#why">Why it works</a>
              <a href="#list-framework">The LIST framework</a>
              <a href="#campaign">Build the campaign</a>
              <a href="#follow-up">Follow up</a>
              <a href="#measure">Measure the test</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="why">
                <p className="bw-drop-intro">
                  <span>Most seller ads ask for too much, too soon.</span> “What is your home worth?” sounds useful, but it also signals an appraisal call. An owner at the beginning of the decision may not be ready for that conversation. They may be ready to see what comparable homes nearby have sold for.
                </p>

                <figure className="bw-stat-spread">
                  <div className="bw-stat-ring" aria-label="75 percent">
                    <svg viewBox="0 0 180 180" role="img" aria-labelledby="seller-stat-title seller-stat-desc">
                      <title id="seller-stat-title">75% of sellers look at sold property listings</title>
                      <desc id="seller-stat-desc">Three quarters of the circle is highlighted.</desc>
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-track" />
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-value" />
                    </svg>
                    <strong>75%</strong>
                  </div>
                  <figcaption>
                    <p>of sellers look at sold-property listings to help them find an agent.</p>
                    <a href="https://customer.realestate.com.au/resource-hub/agency-marketplace/how-to-agency-marketplace/articles/seller-leads-best-practice/" target="_blank" rel="noreferrer">
                      Source: realestate.com.au seller-leads guidance
                    </a>
                  </figcaption>
                </figure>

                <p>
                  A focused sold-price list meets that behaviour with a clear offer instead of a generic promise about service. The list is the offer. The ad only introduces it.
                </p>
              </section>

              <section className="bw-flow-section" aria-labelledby="flow-title">
                <div className="bw-section-heading">
                  <span>What the campaign actually does</span>
                  <h2 id="flow-title">Turn quiet research into a useful conversation.</h2>
                </div>
                <div className="bw-signal-flow" role="img" aria-label="A five-step flow from local sold evidence to a homeowner conversation">
                  <div><b>01</b><strong>Sold evidence</strong><span>Current, disclosed local results</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>02</b><strong>Focused ad</strong><span>One suburb, one property type</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>03</b><strong>Short form</strong><span>A clear request, not an appraisal</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>04</b><strong>Fast delivery</strong><span>The list arrives immediately</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>05</b><strong>Conversation</strong><span>Offer context on comparable sales</span></div>
                </div>
                <p className="bw-article-note">This is an early-intent campaign. Its job is to identify owners who care enough about comparable sales to ask for the detail, not to manufacture an immediate listing.</p>
              </section>

              <section id="list-framework" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The Blockwise LIST framework</span>
                  <h2>Four checks before you spend a dollar.</h2>
                  <p>Specificity is the qualification mechanism. If the right owner cannot recognise themselves in the offer, the campaign is too broad.</p>
                </div>

                <div className="bw-field-image">
                  <Image
                    src="/guides/sold-price-list/field-notes.webp"
                    alt="Printed photos of Australian homes arranged with a map and working notes"
                    fill
                    sizes="(max-width: 800px) 100vw, 64vw"
                  />
                  <span>Build the evidence before the ad</span>
                </div>

                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>L</b><div><h3>Localise</h3><p>Pick one suburb, or two adjoining suburbs when sales volume is thin.</p><span>Good: Recent sales in Scarborough</span></div></div>
                  <div className="bw-list-item"><b>I</b><div><h3>Isolate</h3><p>Choose one property characteristic an owner can recognise instantly.</p><span>Good: Villas in Yokine</span></div></div>
                  <div className="bw-list-item"><b>S</b><div><h3>Source</h3><p>Use current, disclosed results and media you are licensed to republish.</p><span>Good: Date, price, address, approved photo</span></div></div>
                  <div className="bw-list-item"><b>T</b><div><h3>Tie to follow-up</h3><p>Connect delivery, consent, lead ownership and the next useful message.</p><span>Good: Immediate delivery, named owner, clear opt-out</span></div></div>
                </div>
              </section>

              <section className="bw-text-section">
                <h2>1. Pick the patch you want to win</h2>
                <p>Start with the suburb where you want more listings, not simply the area with the largest number of transactions.</p>
                <p>One suburb is usually enough. If it has too few disclosed sales, extend the reporting period before expanding the geography. Six months of coherent local results is a clearer offer than three months of scattered sales across five suburbs.</p>
                <div className="bw-contrast-row">
                  <div><span>Focused</span><strong>Single-storey homes sold in Dianella</strong></div>
                  <div><span>Too broad</span><strong>Perth property market update</strong></div>
                </div>
              </section>

              <section className="bw-text-section">
                <h2>2. Build a list worth requesting</h2>
                <p>The lead magnet has to keep the promise made by the ad. Include the address, disclosed sale price, sale date, a factual property description, a permitted image and the date the list was last updated.</p>
                <div className="bw-source-checklist">
                  <h3>The source check</h3>
                  <ul>
                    <li><span aria-hidden>✓</span> Use agency records or an authorised data provider.</li>
                    <li><span aria-hidden>✓</span> Confirm the terms allow republication.</li>
                    <li><span aria-hidden>✓</span> Leave withheld prices out.</li>
                    <li><span aria-hidden>✓</span> Use images the agency owns or is licensed to use.</li>
                  </ul>
                </div>
                <p>Do not assume that because a result or image is visible on a property portal, it is free to copy into your page or advertising.</p>
              </section>

              <section id="campaign" className="bw-campaign-section">
                <div className="bw-section-heading">
                  <span>The controlled test</span>
                  <h2>Build one campaign you can read clearly.</h2>
                </div>
                <div className="bw-campaign-settings">
                  <dl>
                    <div><dt>Objective</dt><dd>Leads</dd></div>
                    <div><dt>Special Ad Category</dt><dd>Housing, when applicable</dd></div>
                    <div><dt>Conversion location</dt><dd>Instant form</dd></div>
                    <div><dt>Placements</dt><dd>Advantage+ unless evidence says otherwise</dd></div>
                    <div><dt>Schedule</dt><dd>14 days with a named review date</dd></div>
                  </dl>
                </div>

                <figure className="bw-budget-chart">
                  <figcaption>
                    <span>Planning example</span>
                    <strong>A$350–A$420</strong>
                    <p>A$25–A$30 a day across a 14-day test. This is a planning range, not a universal benchmark.</p>
                  </figcaption>
                  <div className="bw-budget-bars" aria-label="Fourteen daily budget bars between 25 and 30 Australian dollars">
                    {Array.from({ length: 14 }, (_, index) => (
                      <div key={index}><span style={{ height: `${54 + (index % 4) * 7}%` }} /><b>{index + 1}</b></div>
                    ))}
                  </div>
                  <div className="bw-budget-axis"><span>Day 1</span><span>Review on day 14</span></div>
                </figure>

                <p>
                  Use a lifetime budget if you need a hard campaign cap. With a daily budget, Meta describes the amount as an average and may spend more on an individual day while balancing spend across the week.
                </p>
              </section>

              <section className="bw-creative-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The creative</span>
                  <h2>Explain the list before you explain yourself.</h2>
                  <p>Use a local home that matches the property type. Keep the visual ordinary and recognisable. This is market evidence, not a trophy-home advertisement.</p>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Primary text</span><span>Copy specimen</span></div>
                  <blockquote>See the latest disclosed sale prices for single-storey homes in <mark>[Suburb]</mark>. The list covers the past <mark>[period]</mark>, includes photos and sale dates, and is updated <mark>[frequency]</mark>.</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>Recent single-storey sales in [Suburb]</strong><span>Learn more</span></div>
                </div>
                <p>Avoid presenting the list as a valuation. Comparable sales provide market context; they do not establish what a specific property will sell for.</p>
              </section>

              <section id="follow-up" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>Delivery and consent</span>
                  <h2>Keep the promise before starting the pitch.</h2>
                </div>
                <p>The thank-you screen and first email should link directly to the list. Delivering the requested resource is one action. Adding someone to ongoing marketing is another.</p>
                <div className="bw-timeline">
                  <div><b>Now</b><span /><section><h3>Deliver the list</h3><p>Put the resource on the thank-you screen and in the first email.</p></section></div>
                  <div><b>Same day</b><span /><section><h3>Offer context</h3><p>Ask whether they want help identifying the closest comparable sales.</p></section></div>
                  <div><b>Day 2–3</b><span /><section><h3>Add one local observation</h3><p>Share something useful, not a disguised appraisal demand.</p></section></div>
                  <div><b>Next update</b><span /><section><h3>Send only with consent</h3><p>Identify the sender and include a working opt-out.</p></section></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>Australian consent check</strong>
                  <p>Commercial email and SMS require consent, accurate sender identification and a working unsubscribe method. ACMA says unsubscribe requests must be honoured within five working days.</p>
                  <a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Read the ACMA guidance →</a>
                </aside>
              </section>

              <section id="measure" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>At the review date</span>
                  <h2>Measure the path, not just the form submit.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Measures for reviewing the campaign">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Measure</span><span role="columnheader">What it tells you</span></div>
                  {[
                    ["Form completion", "Whether the offer and form are easy to understand"],
                    ["Cost per lead", "What Meta charged for each submitted form"],
                    ["Owner-qualified rate", "Whether the offer attracted the people it named"],
                    ["Contactable rate", "Whether the details and review step did their job"],
                    ["Conversation rate", "Whether follow-up continued the promise of the ad"],
                    ["Appraisal and listing outcomes", "What progressed commercially, and how long it took"],
                  ].map(([measure, meaning]) => (
                    <div role="row" key={measure}><strong role="cell">{measure}</strong><span role="cell">{meaning}</span></div>
                  ))}
                </div>
                <div className="bw-decision-strip">
                  <div><b>Continue</b><span>The right owners are responding and the follow-up works.</span></div>
                  <div><b>Revise</b><span>The offer is relevant but the creative, form or delivery is weak.</span></div>
                  <div><b>Stop</b><span>The audience, data maintenance or economics do not support another test.</span></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Bring the ad, form, approval and lead path together.</h2>
                  <p>You still own the data source and permission to use it. Blockwise helps turn the offer into on-brand creative, prepare the campaign and form, show publishing readiness and bring incoming Meta leads into one review path.</p>
                </div>
                <Link href="/signup">Build the campaign <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Is a sold-price list the same as a property valuation?</summary><p>No. It shows disclosed results for a defined group of properties. It gives an owner local market evidence, but it does not account for every feature or factor affecting their home.</p></details>
                <details><summary>Should the ad show the sold prices?</summary><p>It can show a verified example if you have the right to use it, but the ad does not need to reveal the full list. Make clear that the requested resource contains the disclosed results.</p></details>
                <details><summary>Should I use an instant form or a website form?</summary><p>An instant form is a sensible first test for a fast mobile submission. A website form may suit a flow that needs more explanation or an on-site action.</p></details>
                <details><summary>How often should I update the list?</summary><p>Choose a frequency you can maintain. Monthly can suit an active suburb, while a slower market may need a longer interval. Always show the last-updated date.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://customer.realestate.com.au/resource-hub/agency-marketplace/how-to-agency-marketplace/articles/seller-leads-best-practice/" target="_blank" rel="noreferrer">Seller Leads Best Practice Guide, realestate.com.au</a></li>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/pricing" target="_blank" rel="noreferrer">Facebook and Instagram ad budgets, Meta for Business</a></li>
                  <li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Avoid sending spam, Australian Communications and Media Authority</a></li>
                  <li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">Direct marketing, Office of the Australian Information Commissioner</a></li>
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
