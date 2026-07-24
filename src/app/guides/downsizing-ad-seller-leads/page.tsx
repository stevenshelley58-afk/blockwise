import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "The downsizing ad that generates seller leads without a seller campaign";
const description =
  "A downsizing-themed Meta lead ad attracts homeowners who must sell before they buy — generating seller leads without running an expensive seller-specific campaign.";
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
      acceptedAnswer: { "@type": "Answer", text: "No. The ad offers exactly what it promises: a list of homes suited to downsizers. The seller conversation emerges from the follow-up call when you ask whether they need to sell before buying." },
    },
    {
      "@type": "Question",
      name: "What percentage of downsizing leads are actually sellers?",
      acceptedAnswer: { "@type": "Answer", text: "A well-targeted downsizing ad in a market with a meaningful price gap will typically produce 40–60% leads who already own a home. Of those, a significant portion will need to sell before buying." },
    },
    {
      "@type": "Question",
      name: "Can I run this alongside a standard custom-list buyer ad?",
      acceptedAnswer: { "@type": "Answer", text: "Yes, but run them as separate campaigns with separate ad sets so you can compare performance. Do not combine downsizing and general buyer targeting in one ad set." },
    },
    {
      "@type": "Question",
      name: "How long before I see seller results from this campaign?",
      acceptedAnswer: { "@type": "Answer", text: "Buyer closings can happen within 30–60 days. Seller listings from the same campaign typically take 60–120 days because the homeowner needs to resolve their buying decision before committing to a sale." },
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
                Seller-lead campaigns are the most expensive and most difficult ads in real estate. There is a cheaper path — and it runs through a buyer ad.
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

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#logic">The hidden logic</a>
              <a href="#market">When the market works</a>
              <a href="#shift">The SHIFT framework</a>
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
                  A downsizing ad is framed as a buyer campaign. It offers a list of homes priced below the local average — the kind of property a downsizer would move to. But the audience it attracts has a second characteristic: these people already own a more expensive home. To buy a cheaper one, they generally need to sell first.
                </p>
                <p>
                  That means every "buyer" lead from a downsizing ad is potentially two transactions: a listing on the more expensive property and a purchase on the cheaper one. The ad costs the same as a standard buyer campaign, but the downstream opportunity is a listing, not just a buyer presentation.
                </p>
              </section>

              <section id="market" className="bw-flow-section" aria-labelledby="market-title">
                <div className="bw-section-heading">
                  <span>When the market makes this work</span>
                  <h2 id="market-title">Downsizing ads need a price gap.</h2>
                </div>
                <div className="bw-signal-flow" role="img" aria-label="The market conditions that make a downsizing ad profitable">
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

              <section id="shift" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The SHIFT framework</span>
                  <h2>Five conditions for a profitable downsizing ad.</h2>
                  <p>If three or more conditions are green, a downsizing ad will likely produce a mix of buyer and seller leads. If two or fewer are green, choose a different angle.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>S</b><div><h3>Spread</h3><p>Is there a meaningful price gap between the average home and the downsizer target?</p><span>Green: Average $700K, target $500K–$650K</span></div></div>
                  <div className="bw-list-item"><b>H</b><div><h3>Housing stock</h3><p>Does your market have the property type downsizers want?</p><span>Green: Single-storey, low-maintenance villas</span></div></div>
                  <div className="bw-list-item"><b>I</b><div><h3>Intent signal</h3><p>Are people searching for or enquiring about smaller homes?</p><span>Green: Increasing searches for "single-storey"</span></div></div>
                  <div className="bw-list-item"><b>F</b><div><h3>Feature recognition</h3><p>Can you name the downsizer property type in one phrase?</p><span>Green: "Single-storey homes under $500K"</span></div></div>
                  <div className="bw-list-item"><b>T</b><div><h3>Timing</h3><p>Are market conditions pushing people toward downsizing?</p><span>Green: Rising rates, aging demographic, cost pressure</span></div></div>
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
                    <div><dt>Budget</dt><dd>$20/day</dd></div>
                    <div><dt>Location</dt><dd>Market centre, 15-mile radius</dd></div>
                    <div><dt>Price band</dt><dd>Average + 10% ceiling, $150K below floor</dd></div>
                    <div><dt>Feature</dt><dd>Single-storey, bungalow, low-maintenance</dd></div>
                  </dl>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Primary text</span><span>Copy specimen</span></div>
                  <blockquote>Stop scrolling. The most up-to-date list of <mark>single-storey homes</mark> under <mark>[$price]</mark> in <mark>[Suburb]</mark> is here — updated daily, direct from the MLS. Perfect for downsizers, first-home buyers and investors.</blockquote>
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
                  <div><b>Q4</b><span /><section><h3>What is your timeline?</h3><p>30–60 days means hot. 6–12 months means nurture. Over a year means pipeline.</p></section></div>
                </div>
                <p>When they confirm they need to sell, shift the conversation:</p>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Transition script</span><span>Seller conversation</span></div>
                  <blockquote>That is very common for people looking at these homes. If it would help, I can take a look at your current property and give you a sense of what it is likely to sell for — no obligation, just so you know your numbers before you make a move.</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>Not a listing pitch — a practical offer</strong><span>Tied to the buyer conversation</span></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>The double-end opportunity</strong>
                  <p>When a downsizing lead confirms they need to sell and buy, you have a chance to represent both sides. Do not assume the listing is yours. Do your buyer job well first. The listing conversation follows naturally from trust built through the process.</p>
                </aside>
              </section>

              <section id="measure" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>At the review date</span>
                  <h2>Measure on a 90-day horizon, not 14 days.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Measures for reviewing a downsizing campaign">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Measure</span><span role="columnheader">What to look for</span></div>
                  {[
                    ["Total lead volume", "Comparable to a standard buyer-list ad"],
                    ["Homeowner rate", "40%+ suggests the downsizing angle is working"],
                    ["Dual-side rate", "20–30% of homeowner leads need to sell"],
                    ["Listing appointments", "Track over 90 days, not 14"],
                    ["Buyer closings", "Your baseline revenue from the campaign"],
                  ].map(([measure, meaning]) => (
                    <div role="row" key={measure}><strong role="cell">{measure}</strong><span role="cell">{meaning}</span></div>
                  ))}
                </div>
                <div className="bw-decision-strip">
                  <div><b>Continue</b><span>40%+ homeowners and 20%+ dual-side rate.</span></div>
                  <div><b>Revise</b><span>Leads coming but few own homes — adjust feature.</span></div>
                  <div><b>Stop</b><span>No price gap in the market — choose another angle.</span></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Build the downsizing campaign.</h2>
                  <p>Blockwise helps you prepare the creative, the lead form and the approval path, and brings the leads into one review queue. Because a downsizing ad produces a mix of buyer and seller opportunities, having all leads in a single organised view makes the follow-up conversation easier to manage.</p>
                </div>
                <Link href="/signup">Build your campaign <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Is this deceptive? The ad looks like a buyer ad but I want seller leads.</summary><p>No. The ad offers exactly what it promises: a list of homes suited to downsizers. The lead receives that list. The seller conversation emerges from the follow-up call when you ask whether they need to sell before buying — a question that follows naturally from their stated interest in smaller homes.</p></details>
                <details><summary>What percentage of downsizing leads are actually sellers?</summary><p>A well-targeted downsizing ad in a market with a meaningful price gap will typically produce 40–60% leads who already own a home. Of those, a significant portion will need to sell before buying. Not every homeowner lead is a seller lead, but the cost per lead is low enough that even a 20% seller-conversion rate from the homeowner pool is cheaper than a dedicated seller campaign.</p></details>
                <details><summary>Can I run this alongside a standard custom-list buyer ad?</summary><p>Yes, but run them as separate campaigns with separate ad sets so you can compare performance. Do not combine downsizing and general buyer targeting in one ad set — you will not be able to tell which angle is producing the seller leads.</p></details>
                <details><summary>How long before I see seller results from this campaign?</summary><p>Buyer closings can happen within 30–60 days. Seller listings from the same campaign typically take 60–120 days because the homeowner needs to resolve their buying decision before committing to a sale. Track this campaign on a 90-day horizon at minimum.</p></details>
                <details><summary>What if my market does not have a meaningful price gap?</summary><p>If the average home and the downsizer target are within 5% of each other, there is no financial reason for homeowners to downsize. In that case, choose a different angle — a feature-based list or a first-home-buyer list — rather than forcing a downsizing angle the market does not support.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/help/special-ad-categories" target="_blank" rel="noreferrer">Special ad categories, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/pricing" target="_blank" rel="noreferrer">Facebook and Instagram ad budgets, Meta for Business</a></li>
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
