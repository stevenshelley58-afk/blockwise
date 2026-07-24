import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "The custom-list Facebook ad that generates buyer leads in 24 hours";
const description =
  "Build a filtered list of local homes, set up a Meta lead ad with the right budget, form and CRM connection, and start generating buyer leads within 24 hours.";
const canonical = "/guides/custom-list-facebook-ad-buyer-leads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/custom-list/hero.webp", width: 1920, height: 1080, alt: "Meta Ads Manager campaign setup for a custom-list real estate lead ad" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/custom-list/hero.webp"] },
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
  image: "https://blockwise.sale/guides/custom-list/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Why a single image instead of a video or carousel?",
      acceptedAnswer: { "@type": "Answer", text: "Single-image ads consistently produce the lowest cost per lead and the highest click-through rate for this type of offer. People scrolling through Feed decide in a fraction of a second whether to engage." },
    },
    {
      "@type": "Question",
      name: "Do I need the special ad category for housing?",
      acceptedAnswer: { "@type": "Answer", text: "Yes. Any Meta ad that relates to housing must use the Housing special ad category. Running a housing ad without it risks the ad being disapproved or your ad account being restricted." },
    },
    {
      "@type": "Question",
      name: "Can I target specific neighbourhoods or postcodes?",
      acceptedAnswer: { "@type": "Answer", text: "The housing special ad category prevents targeting below a 15-mile radius and removes postcode-level targeting. The algorithm optimises within the allowed radius based on who engages with your ad." },
    },
    {
      "@type": "Question",
      name: "What if my IDX list has very few results?",
      acceptedAnswer: { "@type": "Answer", text: "Widen the price range or choose a different feature before publishing the ad. Sending leads to an empty search page breaks the promise and wastes your budget. A list of 15 or more properties is a reasonable minimum." },
    },
    {
      "@type": "Question",
      name: "Should I use a daily budget or a lifetime budget?",
      acceptedAnswer: { "@type": "Answer", text: "A daily budget is simpler for a first test. Meta averages spend across the week, so weekly spend will not exceed seven times your daily budget. Use a lifetime budget only if you need a hard cap on total spend." },
    },
  ],
};

export default function CustomListAdGuidePage() {
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
                <span>Buyer leads</span>
              </div>
              <p className="bw-guides-label">The setup guide</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                Most real estate Facebook ads fail because the offer is too generic. A custom list of local homes with one desirable feature fixes that — and produces leads within 24 hours.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>14 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/custom-list/hero.webp"
                alt="Meta Ads Manager campaign setup for a custom-list real estate lead ad"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#why">Why the offer works</a>
              <a href="#setup">The SETUP checklist</a>
              <a href="#campaign">Build the campaign</a>
              <a href="#form">Design the form</a>
              <a href="#three-days">The three-day rule</a>
              <a href="#measure">Read the results</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="why">
                <p className="bw-drop-intro">
                  <span>Most real estate Facebook ads fail for one of two reasons.</span> The offer is too generic, or the setup is too complicated. "Check out my listings" is not an offer — it does not give a scrolling buyer a reason to stop, and it does not give Meta's algorithm enough signal to find the right people.
                </p>
                <p>
                  The ad that works reliably is simpler than most agents expect. It offers one thing: a custom list of local homes, filtered by a price point that casts the widest net, with one desirable feature that makes the list feel curated rather than random. The ad runs as a Meta instant form, asks for name, email and phone, and delivers the list immediately.
                </p>
              </section>

              <section className="bw-flow-section" aria-labelledby="flow-title">
                <div className="bw-section-heading">
                  <span>What makes the offer work</span>
                  <h2 id="flow-title">Two decisions make or break it.</h2>
                </div>
                <div className="bw-signal-flow" role="img" aria-label="The path from price point and feature selection to a live lead ad">
                  <div><b>01</b><strong>Price point</strong><span>Average detached price + 5–10%</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>02</b><strong>Desirable feature</strong><span>One high-demand characteristic</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>03</b><strong>Filtered IDX list</strong><span>Current, matching properties</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>04</b><strong>Instant form</strong><span>Name, email, phone — that's all</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>05</b><strong>Immediate delivery</strong><span>Thank-you screen links to the list</span></div>
                </div>
                <p className="bw-article-note">The combination of a price ceiling plus one feature is what makes the list feel curated. "Homes under $500,000 with a pool" is a list someone wants. "Homes in Phoenix" is not.</p>
              </section>

              <section id="setup" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The SETUP checklist</span>
                  <h2>Five decisions before you open Ads Manager.</h2>
                  <p>If any of these are missing, finish them first. The ad will not publish without a privacy policy, and a broken IDX link will waste every lead the campaign generates.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>S</b><div><h3>Suburb and radius</h3><p>Your market centre, 15-mile minimum radius — housing ad category requirement.</p><span>Defines the audience the algorithm optimises within</span></div></div>
                  <div className="bw-list-item"><b>E</b><div><h3>Exact price ceiling</h3><p>Average detached price + roughly 5–10%, rounded to a clean number.</p><span>Casts the widest net without being meaningless</span></div></div>
                  <div className="bw-list-item"><b>T</b><div><h3>Target feature</h3><p>One highly desirable property characteristic for your market.</p><span>Makes the list feel curated and qualifies the response</span></div></div>
                  <div className="bw-list-item"><b>U</b><div><h3>URL for the list</h3><p>A filtered IDX search link matching your price and feature criteria.</p><span>The thank-you screen sends leads here immediately</span></div></div>
                  <div className="bw-list-item"><b>P</b><div><h3>Privacy policy URL</h3><p>A live privacy policy page on your website.</p><span>Meta requires this to publish a lead form</span></div></div>
                </div>
              </section>

              <section id="campaign" className="bw-campaign-section">
                <div className="bw-section-heading">
                  <span>The controlled test</span>
                  <h2>Build one campaign you can read clearly.</h2>
                </div>
                <div className="bw-campaign-settings">
                  <dl>
                    <div><dt>Objective</dt><dd>Leads</dd></div>
                    <div><dt>Campaign type</dt><dd>Manual leads campaign</dd></div>
                    <div><dt>Special Ad Category</dt><dd>Housing</dd></div>
                    <div><dt>Conversion location</dt><dd>Instant forms</dd></div>
                    <div><dt>Budget</dt><dd>$20/day to start</dd></div>
                    <div><dt>Schedule</dt><dd>Start tomorrow, end in 2–3 weeks</dd></div>
                    <div><dt>Placements</dt><dd>Advantage+ or Feed + Marketplace</dd></div>
                  </dl>
                </div>
                <p>
                  A $20 daily budget gives you enough data to judge performance without overspending on an untested ad. Meta averages spend across the week — individual days may vary by up to 25% above or below the daily figure, but weekly spend will not exceed seven times the daily budget.
                </p>
                <figure className="bw-budget-chart">
                  <figcaption>
                    <span>Planning example</span>
                    <strong>$280</strong>
                    <p>$20 a day across a 14-day test. Enough data to evaluate, not so much you waste money on an untested campaign.</p>
                  </figcaption>
                  <div className="bw-budget-bars" aria-label="Fourteen daily budget bars around $20">
                    {Array.from({ length: 14 }, (_, index) => (
                      <div key={index}><span style={{ height: `${54 + (index % 4) * 7}%` }} /><b>{index + 1}</b></div>
                    ))}
                  </div>
                  <div className="bw-budget-axis"><span>Day 1</span><span>Review on day 14</span></div>
                </figure>
              </section>

              <section className="bw-creative-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The creative</span>
                  <h2>A single image that matches the price point.</h2>
                  <p>Use a photo of a property that looks like it belongs in your market at your price point with your chosen feature. Not a luxury estate — the image that a local buyer would recognise as a $500,000 home with a pool.</p>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Primary text</span><span>Copy specimen</span></div>
                  <blockquote>Stop scrolling. The most up-to-date list of <mark>[feature]</mark> homes under <mark>[$price]</mark> in <mark>[Suburb]</mark> is here — updated daily, direct from the MLS. Click below to get instant access.</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>[Suburb] [feature] homes under [price] — updated daily</strong><span>Learn more</span></div>
                </div>
                <p>The call to action that converts highest is <strong>Learn more</strong>. Not "Sign up" — that signals a registration barrier. The instant form handles the registration.</p>
              </section>

              <section id="form" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The lead form</span>
                  <h2>Three fields. Higher intent. No friction.</h2>
                </div>
                <p>Choose higher intent. This adds a review step where the person confirms their contact details before submitting. You will get slightly fewer leads, but they will be higher quality — people who confirm their email and phone are giving you the details they actually use, not the ones Facebook auto-populated from a 10-year-old account.</p>
                <div className="bw-source-checklist">
                  <h3>Ask for three fields only</h3>
                  <ul>
                    <li><span aria-hidden>✓</span> Full name</li>
                    <li><span aria-hidden>✓</span> Email address</li>
                    <li><span aria-hidden>✓</span> Phone number</li>
                    <li><span aria-hidden>✗</span> No multiple-choice questions</li>
                    <li><span aria-hidden>✗</span> No optional fields</li>
                    <li><span aria-hidden>✗</span> No qualifying surveys</li>
                  </ul>
                </div>
                <p>Link the thank-you screen directly to your filtered IDX search URL. Include your contact information and an invitation to reach out with questions.</p>
                <aside className="bw-compliance-note">
                  <strong>Connect your CRM</strong>
                  <p>Leads sitting in Ads Manager that nobody sees are wasted money. Connect your CRM natively or use Zapier. Every lead must arrive somewhere you will see it and act on it within hours, not days.</p>
                  <Link href="/signup">Set up lead delivery with Blockwise →</Link>
                </aside>
              </section>

              <section id="three-days" className="bw-text-section">
                <h2>The three-day rule</h2>
                <p>When the ad goes live, do not expect optimal results on day one. Meta's algorithm needs roughly three days to identify which users engage with your ad and optimise delivery toward similar people.</p>
                <p>You will likely see leads within the first 24 hours, but performance typically improves after the three-day learning period. Turning an ad off after 48 hours because it has not produced 20 leads is the most common way agents conclude that "Facebook ads don't work" — when the ad simply did not have enough time to find its audience.</p>
                <div className="bw-contrast-row">
                  <div><span>If not performing after 3 days</span><strong>Check image, copy, IDX link, form length</strong></div>
                  <div><span>If performing after 3 days</span><strong>Let it run — the algorithm is working</strong></div>
                </div>
              </section>

              <section id="measure" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>At the review date</span>
                  <h2>Read the whole path, not just the form submit.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Measures for reviewing the campaign">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Measure</span><span role="columnheader">What it tells you</span></div>
                  {[
                    ["Lead volume", "Whether the budget and audience are producing form submissions"],
                    ["Cost per lead", "What Meta charges per submitted form"],
                    ["Contactable rate", "Whether the phone and email work"],
                    ["Speed to first contact", "How quickly you respond"],
                    ["Conversation rate", "How many leads enter a property discussion"],
                  ].map(([measure, meaning]) => (
                    <div role="row" key={measure}><strong role="cell">{measure}</strong><span role="cell">{meaning}</span></div>
                  ))}
                </div>
                <div className="bw-decision-strip">
                  <div><b>Continue</b><span>Leads are contactable and the follow-up is working.</span></div>
                  <div><b>Revise</b><span>Leads are coming but quality or delivery is weak.</span></div>
                  <div><b>Stop</b><span>The audience is wrong or the economics don't support another test.</span></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Build the campaign around your custom list.</h2>
                  <p>Blockwise helps prepare on-brand creative that matches your price point and feature, set up the lead form and approval path, and bring Meta leads into a clear review queue so nobody falls through the cracks.</p>
                </div>
                <Link href="/signup">Build your campaign <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Why a single image instead of a video or carousel?</summary><p>Single-image ads consistently produce the lowest cost per lead and the highest click-through rate for this type of offer. People scrolling through Feed decide in a fraction of a second whether to engage — a clear image communicates the offer faster than a video they have to watch.</p></details>
                <details><summary>Do I need the special ad category for housing?</summary><p>Yes. Any Meta ad that relates to housing — including property listings, lead generation for real estate services, and home valuation offers — must use the Housing special ad category. Running a housing ad without it risks the ad being disapproved or your ad account being restricted.</p></details>
                <details><summary>Can I target specific neighbourhoods or postcodes?</summary><p>The housing special ad category prevents targeting below a 15-mile radius and removes postcode-level targeting. This is a platform-wide restriction for housing ads. The algorithm optimises within the allowed radius based on who engages with your ad.</p></details>
                <details><summary>What if my IDX list has very few results?</summary><p>Widen the price range or choose a different feature before publishing the ad. Sending leads to an empty search page breaks the promise and wastes your budget. A list of 15 or more properties is a reasonable minimum for a two-week test.</p></details>
                <details><summary>Should I use a daily budget or a lifetime budget?</summary><p>A daily budget is simpler for a first test. Meta averages spend across the week, so you may spend $25 on a strong day and $15 on a slower day, but weekly spend will not exceed seven times your daily budget. Use a lifetime budget only if you need a hard cap on total spend.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/pricing" target="_blank" rel="noreferrer">Facebook and Instagram ad budgets, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/help/special-ad-categories" target="_blank" rel="noreferrer">Special ad categories, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/help/messenger-app/621956575422138/" target="_blank" rel="noreferrer">Create ad campaigns in Meta Ads Manager, Meta Help Centre</a></li>
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
