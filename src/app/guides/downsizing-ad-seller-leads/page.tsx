import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "How to use a downsizer campaign to uncover seller intent";
const description =
  "A downsizer-themed Meta lead ad offers a list of low-maintenance homes and attracts homeowners who may need to sell before they buy — a practical way to uncover seller intent through a buyer-focused campaign.";
const canonical = "/guides/downsizing-ad-seller-leads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/downsizing/hero.webp", width: 1920, height: 1080, alt: "A single-storey home typical of a downsizing market" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/downsizing/hero.webp"] },
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
  image: "https://blockwise.sale/guides/downsizing/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Is this deceptive? The ad looks like a buyer ad but I want seller leads.",
      acceptedAnswer: { "@type": "Answer", text: "The approach is transparent when the advertised list is genuine, the properties match the stated criteria, the resource is delivered as promised, and follow-up clearly identifies the agent and purpose of contact. Agency, disclosure and conflict requirements vary by state and transaction structure." },
    },
    {
      "@type": "Question",
      name: "What percentage of downsizing leads are actually sellers?",
      acceptedAnswer: { "@type": "Answer", text: "It varies by market and timing. Track what percentage of your leads already own a home from your own campaign data. Then track how many homeowner leads need to sell before buying." },
    },
    {
      "@type": "Question",
      name: "Can I run this alongside a standard custom-list buyer ad?",
      acceptedAnswer: { "@type": "Answer", text: "Yes, but run them as separate campaigns with separate ad sets so you can compare performance. Do not combine downsizing and general buyer targeting in one ad set." },
    },
    {
      "@type": "Question",
      name: "How long before I see seller results from this campaign?",
      acceptedAnswer: { "@type": "Answer", text: "Results vary by market and individual circumstances. Buyer closings may happen within a shorter planning range. Seller listings from the same campaign typically take longer. Track this campaign on a 90-day horizon at minimum." },
    },
    {
      "@type": "Question",
      name: "What if my market does not have a meaningful price gap?",
      acceptedAnswer: { "@type": "Answer", text: "If the average home and the downsizer target are within 5% of each other, there is no financial reason for homeowners to downsize. Choose a different angle rather than forcing a downsizing approach the market does not support." },
    },
  ],
};

export default function DownsizingAdGuidePage() {
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
              <p className="bw-guides-label">The hidden logic</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                Offer a useful list of low-maintenance homes, then qualify whether the buyer also needs to sell before purchasing.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>12 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/downsizing/hero.webp"
                alt="A single-storey home typical of a downsizing market"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-at-glance">
            <h2>At a glance</h2>
            <dl>
              <div><dt>Offer</dt><dd>A list of low-maintenance homes for downsizers</dd></div>
              <div><dt>Setup time</dt><dd>60 to 90 minutes</dd></div>
              <div><dt>Initial test</dt><dd>A$20 daily for 14 to 21 days</dd></div>
              <div><dt>Primary metric</dt><dd>Homeowner rate and seller conversations</dd></div>
              <div><dt>Review point</dt><dd>90-day horizon, not 14 days</dd></div>
              <div><dt>Compliance</dt><dd>Consent, disclosure, state agency rules</dd></div>
            </dl>
          </div>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#logic">The hidden logic</a>
              <a href="#market">When the market works</a>
              <a href="#conditions">Conditions to check</a>
              <a href="#campaign">Build the campaign</a>
              <a href="#follow-up">The follow-up that finds the seller</a>
              <a href="#measure">Measure the campaign</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="logic">
                <p className="bw-drop-intro">
                  <span>Seller-lead campaigns are the most expensive and most difficult ads in real estate.</span> They ask directly: "Thinking of selling? Get a free home evaluation." That offer attracts two groups — people who are ready to list now (rare) and people who are curious but months away (common). The cost per lead is high because the offer signals a commitment most homeowners are not ready to make.
                </p>
                <p>
                  A downsizer campaign is framed as a buyer campaign. It offers a list of low-maintenance homes priced below the local average — the kind of property a downsizer would move to. But the audience it attracts has a second characteristic: these people already own a more expensive home. To buy a cheaper one, they generally need to sell first.
                </p>
                <p>
                  That means a buyer lead from a downsizing ad may also represent a sale opportunity — a listing on the more expensive property and a purchase on the cheaper one. The cost per lead is comparable to a standard buyer campaign, but the downstream opportunity may include both a purchase and a sale.
                </p>
              </section>

              <section id="market" className="bw-flow-section" aria-labelledby="market-title">
                <div className="bw-section-heading">
                  <span>When the market makes this work</span>
                  <h2 id="market-title">Downsizer campaigns need a price gap.</h2>
                </div>
                <div className="bw-signal-flow" role="img" aria-label="The market conditions that make a downsizer campaign worthwhile">
                  <div><b>01</b><strong>Price gap</strong><span>Meaningful difference between average and target</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>02</b><strong>Housing stock</strong><span>Single-storey, low-maintenance homes</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>03</b><strong>Intent signal</strong><span>People searching for smaller homes</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>04</b><strong>Feature recognition</strong><span>Buyers recognise the property type</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>05</b><strong>Timing</strong><span>Rates, demographics, affordability</span></div>
                </div>
                <p className="bw-article-note">If your market has no meaningful price gap between the average home and the next step down, the angle will not produce seller leads — there is no financial reason to downsize.</p>
              </section>

              <section id="conditions" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>Conditions to check</span>
                  <h2>Five conditions for a profitable downsizer campaign.</h2>
                  <p>If three or more conditions are green, a downsizer campaign will likely produce a mix of buyer and seller leads. If two or fewer are green, choose a different angle.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>1</b><div><h3>Price gap</h3><p>Is there a meaningful difference between the average home and the downsizer target?</p><span>Green: Average A$700K, target A$500K–A$650K</span></div></div>
                  <div className="bw-list-item"><b>2</b><div><h3>Housing stock</h3><p>Does your market have the property type downsizers want?</p><span>Green: Single-storey, low-maintenance villas</span></div></div>
                  <div className="bw-list-item"><b>3</b><div><h3>Intent signal</h3><p>Are people searching for or enquiring about smaller homes?</p><span>Green: Increasing searches for "single-storey"</span></div></div>
                  <div className="bw-list-item"><b>4</b><div><h3>Feature recognition</h3><p>Can you name the downsizer property type in one phrase?</p><span>Green: "Single-storey homes under A$500K"</span></div></div>
                  <div className="bw-list-item"><b>5</b><div><h3>Market timing</h3><p>Are market conditions pushing people toward downsizing?</p><span>Green: Rising rates, ageing demographic, cost pressure</span></div></div>
                </div>
              </section>

              <section id="campaign" className="bw-campaign-section">
                <div className="bw-section-heading">
                  <span>The campaign</span>
                  <h2>A buyer ad that quietly attracts sellers.</h2>
                </div>
                <div className="bw-campaign-settings">
                  <dl>
                    <div><dt>Objective</dt><dd>Leads</dd></div>
                    <div><dt>Special Ad Category</dt><dd>Housing</dd></div>
                    <div><dt>Conversion location</dt><dd>Instant forms</dd></div>
                    <div><dt>Budget</dt><dd>A$20/day</dd></div>
                    <div><dt>Location</dt><dd>Market centre, minimum radius per the housing special ad category</dd></div>
                    <div><dt>Price band</dt><dd>Average + 10% ceiling, A$150K below floor</dd></div>
                    <div><dt>Feature</dt><dd>Single-storey, low-maintenance</dd></div>
                  </dl>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Primary text</span><span>Copy specimen</span></div>
                  <blockquote>Stop scrolling. The most up-to-date list of <mark>single-storey homes</mark> under <mark>[A$price]</mark> in <mark>[Suburb]</mark> is here — updated daily, direct from an authorised property feed. Perfect for downsizers, first-home buyers and investors.</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>[Suburb] single-storey homes under [price] — updated daily</strong><span>Learn more</span></div>
                </div>
                <p>The word "downsizers" appears in the copy alongside "first-home buyers" and "investors." The ad does not single out downsizers or ask them to identify as sellers. It offers a list and lets the audience self-select.</p>
              </section>

              <section id="follow-up" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The follow-up</span>
                  <h2>The call that finds the seller.</h2>
                </div>
                <p>Your first call is a buyer conversation, not a listing pitch. The goal is to understand their situation through four questions:</p>
                <div className="bw-timeline">
                  <div><b>Q1</b><span /><section><h3>Already looking or browsing?</h3><p>Tells you how warm the lead is.</p></section></div>
                  <div><b>Q2</b><span /><section><h3>Do you currently own a home?</h3><p>This is the key question. If yes, the next question follows naturally.</p></section></div>
                  <div><b>Q3</b><span /><section><h3>Would you need to sell before buying?</h3><p>Most downsizers will say yes. That is your seller lead.</p></section></div>
                  <div><b>Q4</b><span /><section><h3>What is your timeline?</h3><p>A shorter planning range means a warmer lead. A longer range means nurture or long-term pipeline.</p></section></div>
                </div>
                <p>When they confirm they need to sell, shift the conversation:</p>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Transition script</span><span>Seller conversation</span></div>
                  <blockquote>That is very common for people looking at these homes. If it would help, I can take a look at your current property and give you a sense of what it is likely to sell for — no obligation, just so you know your numbers before you make a move.</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>Not a listing pitch — a practical offer</strong><span>Tied to the buyer conversation</span></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>The sale and purchase opportunity</strong>
                  <p>When a downsizing lead confirms they need to sell and buy, you have a chance to coordinate both the sale and the purchase. Do not assume the listing is yours. Do your buyer job well first. The listing conversation follows naturally from trust built through the process.</p>
                </aside>
                <aside className="bw-compliance-note">
                  <strong>Compliance and disclosure</strong>
                  <p>Any follow-up — phone, email, SMS or Messenger — must comply with Australian spam and privacy laws. You need consent, clear sender identification, and a functional unsubscribe facility. See the <a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">ACMA guidance on avoiding spam</a> and the <a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">OAIC direct marketing guidance</a>.</p>
                  <p>Agency, disclosure and conflict requirements vary by state and transaction structure. If you are acting for both a buyer and a seller in a related transaction, check your state's requirements for disclosing that relationship and any conflict of interest.</p>
                </aside>
              </section>

              <section id="measure" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>At the review date</span>
                  <h2>Measure on a 90-day horizon, not 14 days.</h2>
                </div>
                <p>Instead of relying on fixed benchmarks, use a campaign economics calculator to track your own data.</p>
                <div className="bw-measure-table" role="table" aria-label="Campaign economics calculator for a downsizer campaign">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Input</span><span role="columnheader">User enters</span></div>
                  {[
                    ["Monthly spend", "A$"],
                    ["Leads", "Number"],
                    ["Valid contacts", "Number"],
                    ["Existing homeowners", "Number"],
                    ["Qualified selling conversations", "Number"],
                    ["Appraisals", "Number"],
                    ["Listings", "Number"],
                  ].map(([input, userEnters]) => (
                    <div role="row" key={input}><strong role="cell">{input}</strong><span role="cell">{userEnters}</span></div>
                  ))}
                </div>
                <p>Calculate rates from your own data rather than relying on fixed benchmarks. Track what percentage of your leads already own a home — your own campaign data will tell you whether the downsizing angle is working. Track how many homeowner leads need to sell before buying.</p>
                <div className="bw-decision-strip">
                  <div><b>Continue</b><span>The campaign is attracting homeowners and producing seller conversations.</span></div>
                  <div><b>Revise</b><span>Leads coming but few own homes — adjust feature.</span></div>
                  <div><b>Stop</b><span>No price gap in the market — choose another angle.</span></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Build the downsizing campaign.</h2>
                  <p>Blockwise helps you prepare the creative, the lead form and the approval path, and brings the leads into one review queue. Because a downsizer campaign produces a mix of buyer and seller opportunities, having all leads in a single organised view makes the follow-up conversation easier to manage.</p>
                </div>
                <Link href="/signup">Build your campaign <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Is this deceptive? The ad looks like a buyer ad but I want seller leads.</summary><p>The approach is transparent when the advertised list is genuine, the properties match the stated criteria, the resource is delivered as promised, and follow-up clearly identifies the agent and purpose of contact. Agency, disclosure and conflict requirements vary by state and transaction structure — check your obligations before acting for both a buyer and a seller in a related transaction.</p></details>
                <details><summary>What percentage of downsizing leads are actually sellers?</summary><p>It varies by market and timing. Track what percentage of your leads already own a home from your own campaign data. Then track how many homeowner leads need to sell before buying. Not every homeowner lead is a seller lead, but a well-targeted downsizer campaign in a market with a meaningful price gap will produce a meaningful share of leads who own and need to sell.</p></details>
                <details><summary>Can I run this alongside a standard custom-list buyer ad?</summary><p>Yes, but run them as separate campaigns with separate ad sets so you can compare performance. Do not combine downsizing and general buyer targeting in one ad set — you will not be able to tell which angle is producing the seller leads.</p></details>
                <details><summary>How long before I see seller results from this campaign?</summary><p>Results vary by market and individual circumstances. Buyer closings may happen within a shorter planning range. Seller listings from the same campaign typically take longer because the homeowner needs to resolve their buying decision before committing to a sale. Track this campaign on a 90-day horizon at minimum.</p></details>
                <details><summary>What if my market does not have a meaningful price gap?</summary><p>If the average home and the downsizer target are within 5% of each other, there is no financial reason for homeowners to downsize. In that case, choose a different angle — a feature-based list or a first-home-buyer list — rather than forcing a downsizing angle the market does not support.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a> <span className="bw-source-claim">— supports instant form setup</span></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a> <span className="bw-source-claim">— supports Advantage+ default setup</span></li>
                  <li><a href="https://www.facebook.com/business/help/special-ad-categories" target="_blank" rel="noreferrer">Special ad categories, Meta for Business</a> <span className="bw-source-claim">— supports housing special ad category requirements</span></li>
                  <li><a href="https://www.facebook.com/business/ads/pricing" target="_blank" rel="noreferrer">Facebook and Instagram ad budgets, Meta for Business</a> <span className="bw-source-claim">— supports daily budget averaging</span></li>
                  <li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Avoid sending spam, ACMA</a> <span className="bw-source-claim">— supports consent and unsubscribe requirements</span></li>
                  <li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">Direct marketing guidance, OAIC</a> <span className="bw-source-claim">— supports direct marketing and privacy obligations</span></li>
                </ol>
                <p className="bw-last-reviewed">Last reviewed: 24 July 2026</p>
              </footer>

              <nav className="bw-guide-nav" aria-label="More guides">
                <Link href="/guides/custom-list-facebook-ad-buyer-leads" className="bw-guide-nav-link">
                  <span>Related guide</span>
                  <strong>How to generate buyer enquiries with a tightly filtered property list</strong>
                </Link>
                <Link href="/guides/lead-follow-up-playbook" className="bw-guide-nav-link">
                  <span>Next guide</span>
                  <strong>A practical follow-up cadence for real estate leads</strong>
                </Link>
              </nav>
            </div>
          </div>
        </article>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </GuidesShell>
  );
}
