import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "Google Ads for real estate: how to close 2–3 deals a month on a small budget";
const description =
  "Set up a Google Ads search campaign for real estate leads: keyword strategy, landing page design, budget guidance and the follow-up cadence that closes 2–3 deals a month.";
const canonical = "/guides/google-ads-real-estate-leads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/google-ads/hero.webp", width: 1920, height: 1080, alt: "Google search ad for real estate appearing above organic results" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/google-ads/hero.webp"] },
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
  image: "https://blockwise.sale/guides/google-ads/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How much should I spend on Google Ads for real estate?",
      acceptedAnswer: { "@type": "Answer", text: "Start at $15–$20 per day for a first test. Scale to $50–$60 per day once the campaign is producing leads at a sustainable cost per lead. Do not start at $5/day — the budget is too low for the algorithm to learn." },
    },
    {
      "@type": "Question",
      name: "Are Google Ads better than Facebook Ads for real estate?",
      acceptedAnswer: { "@type": "Answer", text: "Neither is universally better. Google produces higher-intent leads because the user actively searched. Facebook produces more leads at a lower cost. Use both if budget allows and compare on cost-per-closed-deal, not cost-per-lead." },
    },
    {
      "@type": "Question",
      name: "What website platform should I use for the landing page?",
      acceptedAnswer: { "@type": "Answer", text: "Real Geeks, Bold Trail, KV Core and Lofty all support IDX landing pages with forced registration. The platform matters less than the match between the ad and the page." },
    },
    {
      "@type": "Question",
      name: "How long does it take for Google Ads to start working?",
      acceptedAnswer: { "@type": "Answer", text: "Expect 2–3 weeks of high cost per lead while the algorithm learns. By week 4, cost per lead should stabilise. By month 2, you should be having conversations. By month 3, you should be closing your first deals." },
    },
    {
      "@type": "Question",
      name: "Should I use Google's Performance Max or manual search campaigns?",
      acceptedAnswer: { "@type": "Answer", text: "For a first campaign, manual search gives you more control. Performance Max uses Google's AI across all channels but is less transparent. Start with manual search, then experiment with Performance Max once you understand what works." },
    },
  ],
};

export default function GoogleAdsGuidePage() {
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
                <span>Google Ads</span>
              </div>
              <p className="bw-guides-label">The search campaign</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                Facebook ads are the easiest way to generate leads. Google Ads are the easiest way to generate leads that actually close — because the person typed "homes for sale" into a search bar.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>15 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/google-ads/hero.webp"
                alt="Google search ad for real estate appearing above organic results"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#compare">Facebook vs. Google</a>
              <a href="#scale">The SCALE framework</a>
              <a href="#keywords">Keyword strategy</a>
              <a href="#landing">Landing page</a>
              <a href="#budget">Budget and ROI</a>
              <a href="#timeline">Realistic timeline</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="compare">
                <p className="bw-drop-intro">
                  <span>Facebook ads are the easiest way to generate real estate leads.</span> Google Ads are the easiest way to generate real estate leads that actually close. The difference is intent. A Facebook user was scrolling through their feed when your ad appeared — they were not searching for a home. A Google user typed "homes for sale in [city]" into a search bar. They are actively looking.
                </p>
                <p>That intent means Google leads cost more per click, but they convert at a higher rate because the person is closer to the purchase point. This guide covers the full setup — from keyword strategy to the follow-up system that turns those clicks into closed transactions.</p>
              </section>

              <section className="bw-measure-section" aria-labelledby="compare-title">
                <div className="bw-section-heading">
                  <span>Which to use</span>
                  <h2 id="compare-title">Facebook vs. Google — they serve different purposes.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Comparison of Facebook and Google Ads for real estate">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Factor</span><span role="columnheader">Facebook</span><span role="columnheader">Google</span></div>
                  {[
                    ["Lead intent", "Low–medium (interruptive)", "High (active search)"],
                    ["Cost per lead", "$4–$12", "$13–$30"],
                    ["Lead quality", "Variable (early browsers)", "Stronger (closer to purchase)"],
                    ["Budget to start", "$10–$20/day", "$15–$20/day"],
                    ["Time to first lead", "Within 24 hours", "1–2 weeks"],
                  ].map(([factor, fb, google]) => (
                    <div role="row" key={factor}><strong role="cell">{factor}</strong><span role="cell">{fb}</span><span role="cell">{google}</span></div>
                  ))}
                </div>
                <p>If you can run both, use Facebook for volume and Google for quality, and compare the cost-per-closed-deal over 90 days rather than the cost-per-lead over 14 days.</p>
              </section>

              <section id="scale" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The SCALE framework</span>
                  <h2>Five decisions that determine success.</h2>
                  <p>If any of these are weak, the campaign will struggle regardless of how well you optimise other elements.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>S</b><div><h3>Search terms</h3><p>Keywords people actually type when looking for homes in your market.</p><span>Good: "homes for sale in Winston Salem"</span></div></div>
                  <div className="bw-list-item"><b>C</b><div><h3>City focus</h3><p>One city or region, not a whole state.</p><span>Good: "new construction Winston Salem NC"</span></div></div>
                  <div className="bw-list-item"><b>A</b><div><h3>Ad specificity</h3><p>Headlines that match the keyword and promise a specific result.</p><span>Good: "250+ Listings, Free Sign Up"</span></div></div>
                  <div className="bw-list-item"><b>L</b><div><h3>Landing page match</h3><p>The page matches exactly what the ad promised.</p><span>Good: Ad says "$300K–$400K" → page shows that range</span></div></div>
                  <div className="bw-list-item"><b>E</b><div><h3>Estimated budget</h3><p>Enough to generate data, not so much you waste money.</p><span>Good: $15–$20/day for a first test</span></div></div>
                </div>
              </section>

              <section id="keywords" className="bw-creative-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>Keyword strategy</span>
                  <h2>Bid on what buyers actually type.</h2>
                  <p>The most effective keywords are specific to your market and property type. Check what competitors are bidding on by searching Google for your core keywords.</p>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Ad headlines (30 chars each)</span><span>Google rotates the best</span></div>
                  <blockquote>Homes for Sale in <mark>[City]</mark><br />New Construction $300K–$400K<br />250+ Listings — Free Sign Up<br />See Photos, Prices & Details</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>[City] Real Estate Made Easy</strong><span>Learn more</span></div>
                </div>
                <div className="bw-source-checklist">
                  <h3>Negative keywords to exclude</h3>
                  <ul>
                    <li><span aria-hidden>✗</span> jobs, careers, hiring</li>
                    <li><span aria-hidden>✗</span> rent, rental, lease</li>
                    <li><span aria-hidden>✗</span> commercial, office, retail</li>
                    <li><span aria-hidden>✗</span> cheap, foreclosure, auction (unless targeted)</li>
                  </ul>
                </div>
                <p>The principle is simple: <strong>make the ad match the search.</strong> If someone searches "new construction homes Winston Salem," the ad should say "New Construction Homes in Winston Salem" — not "Find Your Dream Home."</p>
              </section>

              <section id="landing" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The landing page</span>
                  <h2>Where most Google Ads campaigns fail.</h2>
                </div>
                <p>If the ad promises new construction homes in a specific price range and the landing page shows a random mix of properties, the visitor bounces. The landing page must show exactly what the ad promised.</p>
                <div className="bw-contrast-row">
                  <div><span>Match</span><strong>Ad says "new construction $300K–$400K" → page shows only that</strong></div>
                  <div><span>Mismatch</span><strong>Ad says "new construction" → page shows all types and prices</strong></div>
                </div>
                <p>Use a list view, not a map view — it is easier to scan. Force registration after 3 property views. Ask for name, email and phone number. A lead without a phone number is an email subscriber, not a lead.</p>
                <aside className="bw-compliance-note">
                  <strong>The match rule</strong>
                  <p>The landing page must show exactly what the ad promised. If the ad says "new construction $300K–$400K in [city]," the page should show a list of new construction homes in that city, in that price range — nothing else.</p>
                </aside>
              </section>

              <section id="budget" className="bw-campaign-section">
                <div className="bw-section-heading">
                  <span>Budget and ROI</span>
                  <h2>The calculation that changes your mindset.</h2>
                </div>
                <div className="bw-campaign-settings">
                  <dl>
                    <div><dt>Starting budget</dt><dd>$15–$20/day</dd></div>
                    <div><dt>Weeks 1–2 cost per lead</dt><dd>$25–$30 (algorithm learning)</dd></div>
                    <div><dt>Weeks 3–4 cost per lead</dt><dd>$15–$20 (optimising)</dd></div>
                    <div><dt>Weeks 5+ cost per lead</dt><dd>$10–$15 (stabilised)</dd></div>
                    <div><dt>Scale budget to</dt><dd>$50–$60/day once stable</dd></div>
                  </dl>
                </div>
                <figure className="bw-budget-chart">
                  <figcaption>
                    <span>ROI example</span>
                    <strong>4× return</strong>
                    <p>If your average commission is $8,000 and you spend $2,000 on ads to close one deal, your return is 4x. That is an investment, not an expense.</p>
                  </figcaption>
                  <div className="bw-budget-bars" aria-label="Cost per lead decreasing over 6 weeks">
                    {Array.from({ length: 14 }, (_, index) => (
                      <div key={index}><span style={{ height: `${80 - (index % 7) * 8}%` }} /><b>{index + 1}</b></div>
                    ))}
                  </div>
                  <div className="bw-budget-axis"><span>High cost per lead</span><span>Stabilised</span></div>
                </figure>
              </section>

              <section className="bw-text-section">
                <h2>Monitor and adjust</h2>
                <p>The key metric is <strong>click-through rate (CTR)</strong>. Industry standard for search ads is 3–5%.</p>
                <div className="bw-contrast-row">
                  <div><span>CTR above 5%</span><strong>Ad is compelling — consider increasing budget</strong></div>
                  <div><span>CTR below 3%</span><strong>Revise headlines to be more specific to the keyword</strong></div>
                </div>
                <p>If CTR is dropping over time, refresh the headlines. Ad fatigue is real — rotate new headlines in every 2–3 weeks.</p>
              </section>

              <section id="timeline" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>The realistic timeline</span>
                  <h2>From setup to 2–3 deals per month.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Timeline from campaign setup to consistent deal flow">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Timeframe</span><span role="columnheader">What to expect</span></div>
                  {[
                    ["Month 1", "Setup, algorithm learning. High cost per lead. 1–2 leads/day. No deals yet."],
                    ["Month 2", "Cost per lead drops. Lead quality improves. First appointments. Possibly first closing."],
                    ["Month 3", "Steady lead flow. Appointments converting. 1–2 deals this month."],
                    ["Month 4–6", "Follow-up pipeline mature. 2–3 deals/month becomes realistic."],
                    ["Month 6+", "Peak months can produce 4–7 deals. Consistent 2–3/month is sustainable."],
                  ].map(([timeframe, expectation]) => (
                    <div role="row" key={timeframe}><strong role="cell">{timeframe}</strong><span role="cell">{expectation}</span></div>
                  ))}
                </div>
                <div className="bw-decision-strip">
                  <div><b>Continue</b><span>CTR above 3%, cost per lead under $15, leads converting to conversations.</span></div>
                  <div><b>Revise</b><span>CTR dropping — refresh headlines and check landing page match.</span></div>
                  <div><b>Stop</b><span>CTR below 2% for 2 weeks despite revisions, or no conversations in 60 days.</span></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Bring Google and Meta leads into one pipeline.</h2>
                  <p>Blockwise helps bring Google Ads leads into the same organised review queue as your Meta leads, so your follow-up system runs from a single pipeline regardless of platform. The landing page, ad copy and budget are yours to control — Blockwise handles the lead intake, review and handoff to your CRM.</p>
                </div>
                <Link href="/signup">Build your pipeline <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>How much should I spend on Google Ads for real estate?</summary><p>Start at $15–$20 per day for a first test. This produces enough data to evaluate within 2–3 weeks. Scale to $50–$60 per day once the campaign is producing leads at a sustainable cost per lead (typically $10–$15). Do not start at $5/day — the budget is too low for the algorithm to learn.</p></details>
                <details><summary>Are Google Ads better than Facebook Ads for real estate?</summary><p>Neither is universally better. Google produces higher-intent leads because the user actively searched. Facebook produces more leads at a lower cost. Use both if budget allows — Facebook for pipeline volume, Google for ready-to-talk leads. Compare on cost-per-closed-deal, not cost-per-lead.</p></details>
                <details><summary>What website platform should I use for the landing page?</summary><p>Real Geeks, Bold Trail, KV Core and Lofty all support IDX landing pages with forced registration. The platform matters less than the match between the ad and the page. Whatever you use, ensure the page shows properties that match the ad's promise and captures name, email and phone number.</p></details>
                <details><summary>How long does it take for Google Ads to start working?</summary><p>Expect 2–3 weeks of high cost per lead while the algorithm learns. By week 4, cost per lead should stabilise. By month 2, you should be having conversations and setting appointments. By month 3, you should be closing your first deals from the campaign. Agents who quit in the first month never see these results.</p></details>
                <details><summary>Should I use Google's Performance Max or manual search campaigns?</summary><p>For a first campaign, manual search gives you more control over keywords, ad copy and budget. Performance Max uses Google's AI across all channels but is less transparent. Start with manual search, then experiment with Performance Max once you understand what works.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://support.google.com/google-ads/answer/6343147" target="_blank" rel="noreferrer">Google Ads for real estate, Google Ads Help</a></li>
                  <li><a href="https://support.google.com/google-ads/answer/1704384" target="_blank" rel="noreferrer">Create effective text ads, Google Ads Help</a></li>
                  <li><a href="https://support.google.com/google-ads/answer/6321" target="_blank" rel="noreferrer">About search ads, Google Ads Help</a></li>
                  <li><a href="https://support.google.com/google-ads/answer/6308119" target="_blank" rel="noreferrer">Optimise your ad campaigns, Google Ads Help</a></li>
                  <li><a href="https://support.google.com/google-ads/answer/6327" target="_blank" rel="noreferrer">Real estate landing page best practices, Google Ads Help</a></li>
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
