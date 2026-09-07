import type { Metadata } from "next";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuideCopyBlock } from "@/components/guides/guide-copy-block";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "How to win seller leads with a suburb sold-price list";
const description = "Build a suburb-specific sold-price resource, promote it with a Meta lead ad, and use the follow-up to identify homeowners considering a sale.";
const canonical = "/guides/sold-price-list-seller-leads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: { type: "article", title, description, url: canonical },
  twitter: { card: "summary", title, description },
};

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: title,
  description,
  datePublished: "2026-07-15",
  dateModified: "2026-09-07",
  author: { "@type": "Organization", name: "Blockwise" },
  publisher: { "@type": "Organization", name: "Blockwise", url: "https://blockwise.sale" },
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqItems = [
  ["Is a sold-price list the same as a property valuation?", "No. It is recent, disclosed market evidence for a defined group of properties, not a valuation of one home."],
  ["Should I use an instant form or a website form?", "An instant form is a sensible first test for a fast mobile submission. A website form suits a flow that needs more explanation or an on-site action."],
  ["How often should I update the list?", "Choose a frequency you can maintain. Monthly may suit an active suburb; a slower market may need a longer interval. Show the last-updated date."],
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })),
};

export default function SoldPriceListGuidePage() {
  return (
    <GuidesShell>
      <ArticleProgress />
      <main id="main-content"><article className="bw-article">
        <header className="bw-article-hero">
          <div className="bw-article-hero-copy">
            <div className="bw-article-breadcrumbs"><Link href="/guides">Guides</Link><span aria-hidden>/</span><span>Seller leads</span></div>
            <p className="bw-guides-label">The practical playbook</p>
            <h1>{title}</h1>
            <p className="bw-article-deck">{description}</p>
            <div className="bw-article-byline"><span>Blockwise</span><span>Updated 7 September 2026</span><span>6 minute read</span></div>
          </div>
        </header>

        <div className="bw-article-at-glance"><h2>At a glance</h2><dl>
          <div><dt>Offer</dt><dd>Recent disclosed sales for one suburb and home type</dd></div>
          <div><dt>Setup</dt><dd>60–90 minutes, after data and image rights are confirmed</dd></div>
          <div><dt>Example test</dt><dd>A$25–A$30 daily for 14 days</dd></div>
          <div><dt>Measure</dt><dd>Cost per valid, contactable homeowner</dd></div>
          <div><dt>Compliance</dt><dd>Data rights, privacy notice and separate marketing consent</dd></div>
        </dl></div>

        <div className="bw-article-body"><aside className="bw-article-toc" aria-label="On this page">
          <strong>On this page</strong><a href="#why">Why this offer</a><a href="#build">Build the list</a><a href="#campaign">Set up the campaign</a><a href="#form">Form and consent</a><a href="#delivery">Deliver and follow up</a><a href="#measure">Measure it</a>
        </aside><div className="bw-article-prose">
          <section id="why" className="bw-opening">
            <p className="bw-drop-intro"><span>Make the first ask useful and small.</span> “What is your home worth?” can sound like an appraisal request. A defined list of comparable, disclosed sales gives a homeowner local context before they are ready for a valuation conversation.</p>
            <p>A sold-price list is an early-intent resource, not a promise of a listing. The ad introduces the list; the list earns the next conversation.</p>
            <figure className="bw-stat-spread"><div className="bw-stat-ring" aria-label="75 percent"><strong>75%</strong></div><figcaption><p>In a 2024 realestate.com.au survey of sellers using online sources (n=1,023), 75% reported looking at sold-property listings when finding an agent.</p><span className="bw-stat-source">External survey context; not evidence that this campaign will perform.</span><a href="https://customer.realestate.com.au/agent-resources/agency-marketplace/seller-leads-best-practice/" target="_blank" rel="noreferrer">Source: realestate.com.au seller-leads guidance</a></figcaption></figure>
          </section>

          <section id="build" className="bw-list-section"><div className="bw-section-heading"><span>Before the ad</span><h2>Build evidence you have the right to share.</h2><p>Data rights are a prerequisite, not a 60–90 minute shortcut. Confirm source terms, permission for every image and the lawful basis for any personal information before estimating setup time.</p></div>
            <div className="bw-list-grid">
              <div className="bw-list-item"><b>1</b><div><h3>Choose a patch</h3><p>One suburb, reporting period and recognisable home type.</p><span>Example: detached, single-storey homes in Dianella sold in the last six months</span></div></div>
              <div className="bw-list-item"><b>2</b><div><h3>Verify each row</h3><p>Address, disclosed price, sale date, factual description and last-updated date.</p><span>Leave withheld prices out; do not pad the list</span></div></div>
              <div className="bw-list-item"><b>3</b><div><h3>Clear media rights</h3><p>Use an agency-owned image or a licence that allows this page and ad.</p><span>Portal visibility is not permission to republish</span></div></div>
              <div className="bw-list-item"><b>4</b><div><h3>Make it usable</h3><p>Publish a mobile-friendly PDF or page with the scope and update date.</p><span>Include a plain “not a valuation” note</span></div></div>
            </div>
          </section>

          <section className="bw-text-section"><h2>Synthetic sample: what a row looks like</h2><p>These addresses and figures are fictional examples for teaching. They are not real sales, listings or market evidence.</p>
            <div className="bw-measure-table" role="table" aria-label="Synthetic sold-price list"><div role="row" className="bw-measure-head"><span role="columnheader">Address</span><span role="columnheader">Sold</span><span role="columnheader">Date</span><span role="columnheader">Description</span></div>
              <div role="row"><span role="cell">14 Examplegum Way, Dianella WA 6000</span><span role="cell">A$742,000</span><span role="cell">12 May 2026</span><span role="cell">3 bed, single-storey, 512 m² (fictional)</span></div>
              <div role="row"><span role="cell">8 Placeholder Street, Dianella WA 6000</span><span role="cell">A$765,000</span><span role="cell">28 June 2026</span><span role="cell">3 bed, single-storey, 488 m² (fictional)</span></div>
              <div role="row"><span role="cell">2 Samplegum Crescent, Dianella WA 6000</span><span role="cell">A$718,000</span><span role="cell">3 July 2026</span><span role="cell">2 bed, single-storey, 460 m² (fictional)</span></div>
            </div>
            <a href="/guides/resources/sold-price-list-seller-leads/synthetic-sold-price-list.csv" download>Download the synthetic CSV template</a>
          </section>

          <section id="campaign" className="bw-campaign-section"><div className="bw-section-heading"><span>Controlled test</span><h2>One offer, one readable campaign.</h2></div>
            <div className="bw-campaign-settings"><dl><div><dt>Objective</dt><dd>Leads</dd></div><div><dt>Housing category</dt><dd>Check the current account requirement for housing-related ads</dd></div><div><dt>Conversion</dt><dd>Instant form or a website form; choose one for the first test</dd></div><div><dt>Budget example</dt><dd>A$25–A$30 daily for 14 days, A$350–A$420 before account charges</dd></div><div><dt>Review</dt><dd>Broken links and delivery promptly; quality and economics at the named review date</dd></div></dl></div>
            <GuideCopyBlock title="Lead ad copy" text="Primary text: See recent disclosed sale prices for [home type] in [Suburb], covering [start date] to [end date]. Request the list for addresses, sale dates and factual descriptions. It is market context, not a valuation. [Agency] will deliver the list and explain what happens next. Headline: Recent [home type] sales in [Suburb]. Call to action: Learn more."/><a href="/guides/resources/sold-price-list-seller-leads/seller-ad-copy.txt" download>Download the lead ad copy</a><p>Audience and location rules vary with account country and markets reached. Meta’s Special Ad Category restrictions can apply when an ad is based in the US or reaches the US, Canada or Europe. Australian domestic campaigns are not universally subject to one radius rule. Check the current account settings and never use targeting to discriminate.</p>
          </section>

          <section id="form" className="bw-creative-section"><div className="bw-section-heading"><span>Form copy</span><h2>Qualify the homeowner without hiding the purpose.</h2></div>
            <p>Ask only what you will use. Make list delivery separate from optional ongoing marketing.</p>
            <GuideCopyBlock title="Homeowner qualification question" text="Do you own a home of this type in [Suburb]? Yes / No / Prefer not to say" />
            <GuideCopyBlock title="Separate marketing consent" text="Optional: Yes, send me occasional [Suburb] property updates from [Agency]. I understand I can unsubscribe at any time. This is separate from receiving the sold-price list." />
            <div className="bw-source-checklist"><h3>Form checklist</h3><ul><li>Full name and email for delivery.</li><li>Mobile only if phone follow-up is explained and permitted.</li><li>Privacy policy link and what happens next.</li><li>Record consent wording, timestamp, source and opt-out status.</li></ul></div>
            <a href="/guides/resources/sold-price-list-seller-leads/seller-qualification-form.txt" download>Download the form and consent draft</a>
          </section>

          <section id="delivery" className="bw-text-section"><h2>Deliver first, then offer context</h2><p>Link the list on the thank-you screen and send it by email. Assign a named person. A same-day response is a practical operating target; there is no universal success cutoff.</p>
            <GuideCopyBlock title="Complete delivery email" text={`Subject: Your [Suburb] sold-price list

Hi [first name],

Here is the [Suburb] sold-price list you requested: [link]. It covers [home type] with disclosed sales from [start date] to [end date]. Last updated: [date].

This list is market context, not a valuation of your home. If you tell me which row looks most comparable, I can explain what is and is not comparable. If you did not ask for ongoing updates, you will not be added to them. If you opted in, you can unsubscribe here: [unsubscribe link].

Regards,
[name] | [agency] | [phone] | [privacy-policy link]`}/>
            <a href="/guides/resources/sold-price-list-seller-leads/delivery-email.txt" download>Download the delivery email</a>
          </section>

          <section id="measure" className="bw-measure-section"><div className="bw-section-heading"><span>Hypothetical review</span><h2>Use arithmetic you can audit.</h2></div>
            <p>Example only: A$420 spend produces 28 form leads. 21 have working contact details (21 ÷ 28 = 75.0% contactable). 12 confirm they own a matching home (12 ÷ 21 = 57.1% of valid contacts). Six have a useful seller conversation (6 ÷ 12 = 50.0%). Three request an appraisal (3 ÷ 6 = 50.0%), and one lists (1 ÷ 3 = 33.3%). Costs are A$15.00 per lead, A$20.00 per valid contact, A$35.00 per homeowner, A$70.00 per seller conversation, A$140.00 per appraisal and A$420.00 per listing. These figures are not a benchmark or promise.</p>
            <div className="bw-contrast-row"><div><span>Review</span><strong>Check delivery, consent, valid contact and conversation quality before changing creative.</strong></div><div><span>Decide</span><strong>Continue, revise or stop based on your economics and evidence.</strong></div></div>
          </section>

          <section className="bw-faq-section"><div className="bw-section-heading"><span>Questions</span><h2>The practical details.</h2></div>{faqItems.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>
          <footer className="bw-article-sources"><h2>Sources</h2><ol><li><a href="https://customer.realestate.com.au/agent-resources/agency-marketplace/seller-leads-best-practice/" target="_blank" rel="noreferrer">realestate.com.au seller-leads guidance</a> — 2024 survey context (n=1,023).</li><li><a href="https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/" target="_blank" rel="noreferrer">Meta Special Ad Category guidance</a>.</li><li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">ACMA: Avoid sending spam</a>.</li><li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">OAIC: Direct marketing</a>.</li></ol><p className="bw-last-reviewed">Updated 7 September 2026</p></footer>
        </div></div>
      </article></main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </GuidesShell>
  );
}
