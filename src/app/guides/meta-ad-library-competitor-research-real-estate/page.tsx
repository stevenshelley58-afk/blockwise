import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "How to use the Meta Ad Library without copying competitors";
const description =
  "Learn how real estate agents can use the Meta Ad Library to understand local advertising patterns, find message gaps and build better ads without copying competitors.";
const canonical = "/guides/meta-ad-library-competitor-research-real-estate";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/ad-library/hero.webp", width: 1920, height: 1080, alt: "A magnifying glass examining a grid of advertisements to find gaps" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/ad-library/hero.webp"] },
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
  image: "https://blockwise.sale/guides/ad-library/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Can I see how much my competitors are spending on Meta ads?",
      acceptedAnswer: { "@type": "Answer", text: "No. The Ad Library shows active ads and some basic information, but it does not display spend, impressions, click-through rates or lead volume for ordinary commercial advertisements. An active ad means the ad exists — not that it is performing well." },
    },
    {
      "@type": "Question",
      name: "Is it legal to look at competitor ads in the Ad Library?",
      acceptedAnswer: { "@type": "Answer", text: "Yes. The Meta Ad Library is a public tool. Viewing ads that Pages are running is its intended purpose. The issue is not viewing — it is copying. Extract the principle behind a competitor's approach, then produce original ads from your own evidence." },
    },
    {
      "@type": "Question",
      name: "How often should I check the Ad Library?",
      acceptedAnswer: { "@type": "Answer", text: "Monthly is a practical cadence for most local agents. Set a calendar reminder, record what you see, and compare against previous reviews. Patterns emerge over three to six months that a single snapshot cannot reveal." },
    },
    {
      "@type": "Question",
      name: "What if every competitor is already running the same offers I planned to run?",
      acceptedAnswer: { "@type": "Answer", text: "That is the most useful finding you can make. If everyone is running appraisal ads and sold-price reports, look for the next layer: renovation guides, selling-cost explanations, buyer-demand updates, or client case studies. The goal is not to match the market — it is to find the proposition nobody else is offering." },
    },
  ],
};

export default function AdLibraryGuidePage() {
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
                <span>Competitor research</span>
              </div>
              <p className="bw-guides-label">The Ad Library guide</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                The Ad Library tells you what other agents are saying. The opportunity is finding what they are not saying — and building original ads that fill the gap.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>10 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/ad-library/hero.webp"
                alt="A magnifying glass examining a grid of advertisements to find gaps"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#scan-framework">The SCAN framework</a>
              <a href="#survey">Survey the market</a>
              <a href="#classify">Classify the patterns</a>
              <a href="#assess">Assess the gaps</a>
              <a href="#navigate">Navigate to original ads</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="scan-framework">
                <p className="bw-drop-intro">
                  <span>The Meta Ad Library lets anyone view advertisements that Pages are currently running.</span> That makes it useful for local real estate research. It does not make it a performance database. For ordinary commercial advertisements, seeing an ad in the library does not tell you how much the agent is spending, how many leads it generated or whether it produced a listing. An active advertisement is evidence that the ad exists. It is not proof that the ad works.
                </p>
              </section>

              <section className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The SCAN framework</span>
                  <h2>Four steps to turn research into action.</h2>
                  <p>If you only survey, you have a snapshot. If you survey and classify but do not assess and navigate, you have a map with no plan.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>S</b><div><h3>Survey the market</h3><p>Search for local agents and record every active ad.</p><span>Good: every competitor in your service area</span></div></div>
                  <div className="bw-list-item"><b>C</b><div><h3>Classify the patterns</h3><p>Sort ads by offer, situation, proof and format.</p><span>Good: a table showing concentration</span></div></div>
                  <div className="bw-list-item"><b>A</b><div><h3>Assess the gaps</h3><p>Identify which seller situations nobody addresses.</p><span>Good: "nobody runs renovation guides"</span></div></div>
                  <div className="bw-list-item"><b>N</b><div><h3>Navigate to original ads</h3><p>Build ads from your own evidence that fill the gaps.</p><span>Good: your own client case study</span></div></div>
                </div>
              </section>

              <section id="survey" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Step 1 — Survey</span>
                  <h2>Open the library and record what you see.</h2>
                </div>
                <p>Search for local agents by name or Page. Record the suburb mentioned, the offer, the audience situation, the property type, the format, whether the agent appears on camera, the proof provided, and the call to action.</p>
                <p className="bw-article-note">An ad that has been running for months may be profitable. It may also be an ad the agent forgot to turn off. Longevity is a signal worth noting, not a performance metric.</p>
              </section>

              <section id="classify" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>Step 2 — Classify</span>
                  <h2>Build a local advertising map.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Local advertising map classifying competitor ads">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Agent</span><span role="columnheader">Offer</span><span role="columnheader">Situation</span><span role="columnheader">Proof</span><span role="columnheader">Format</span></div>
                  <div role="row"><strong role="cell">Agent A</strong><span role="cell">Appraisal</span><span role="cell">Active seller</span><span role="cell">Sales count</span><span role="cell">Static</span></div>
                  <div role="row"><strong role="cell">Agent B</strong><span role="cell">Market report</span><span role="cell">Curious owner</span><span role="cell">Recent sales</span><span role="cell">Carousel</span></div>
                  <div role="row"><strong role="cell">Agent C</strong><span role="cell">Strategy call</span><span role="cell">Preparing seller</span><span role="cell">Testimonial</span><span role="cell">Video</span></div>
                  <div role="row"><strong role="cell">Agent D</strong><span role="cell">Appraisal</span><span role="cell">Active seller</span><span role="cell">No proof</span><span role="cell">Static</span></div>
                </div>
                <p>Once several agents are mapped, the local sameness becomes obvious. In most markets, the table fills up with one or two offers repeated across nearly every agent.</p>
              </section>

              <section id="assess" className="bw-creative-section">
                <div className="bw-section-heading">
                  <span>Step 3 — Assess</span>
                  <h2>Find the gaps everyone else is missing.</h2>
                </div>
                <p>Suppose nearly every local agent runs: free appraisal, just listed, just sold, meet your local agent, we have buyers waiting. That concentration creates an opportunity.</p>
                <div className="bw-contrast-row">
                  <div><span>Concentrated</span><strong>Everyone runs appraisal ads — no differentiation</strong></div>
                  <div><span>Open gap</span><strong>Nobody runs renovation guides, selling-cost explanations or buyer-demand updates</strong></div>
                </div>
                <p>The gap may be conceptual rather than visual. The three-question test:</p>
                <div className="bw-source-checklist">
                  <ul>
                    <li><span aria-hidden>1.</span> What is everyone saying?</li>
                    <li><span aria-hidden>2.</span> What useful seller problem is being ignored?</li>
                    <li><span aria-hidden>3.</span> What evidence can we provide that competitors cannot?</li>
                  </ul>
                </div>
                <p>The third question is the most important. Your strongest material comes from your own market activity — real buyer questions, real appraisal objections, real sales patterns, real client experiences.</p>
              </section>

              <section id="navigate" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>Step 4 — Navigate</span>
                  <h2>Build original ads from your own evidence.</h2>
                </div>
                <p>The goal is not to look more like the other agents. It is to give homeowners a better reason to stop.</p>
                <div className="bw-measure-table" role="table" aria-label="Gap-to-ad mapping">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Gap identified</span><span role="columnheader">Ad concept</span><span role="columnheader">Your evidence</span></div>
                  <div role="row"><strong role="cell">Nobody addresses renovation</strong><span role="cell">"Renovate before selling, or leave it alone?"</span><span role="cell">Your renovated vs unrenovated sales</span></div>
                  <div role="row"><strong role="cell">No buyer-demand data</strong><span role="cell">"What Como buyers are paying more for"</span><span role="cell">Your buyer enquiry and open-home data</span></div>
                  <div role="row"><strong role="cell">No selling-cost explanation</strong><span role="cell">"What it actually costs to sell in [Suburb]"</span><span role="cell">Your fee structure and typical costs</span></div>
                  <div role="row"><strong role="cell">No client video</strong><span role="cell">A seller describing their experience</span><span role="cell">Your past clients who consented</span></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>Extract the principle, not the asset</strong>
                  <p>A competitor's repeated use of client video may indicate testimonials are strategically important. That does not justify copying the script, visual arrangement or wording. Extract the principle — local seller proof deserves a place in our portfolio — then produce original evidence from your own business.</p>
                </aside>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Find the gaps your competitors are leaving.</h2>
                  <p>The Ad Library gives you the research. Blockwise helps you act on it — turning the gaps you identified into on-brand creative, preparing the campaign and lead form for each new concept, and showing you how your ads compare once they are live. Competitor research is the input, not the output. The output is a set of original ads that give homeowners a reason your competitors are not giving them.</p>
                </div>
                <Link href="/signup">Build your ads <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Can I see how much my competitors are spending on Meta ads?</summary><p>No. The Ad Library shows active ads and some basic information, but it does not display spend, impressions, click-through rates or lead volume for ordinary commercial advertisements. An active ad means the ad exists — not that it is performing well.</p></details>
                <details><summary>Is it legal to look at competitor ads in the Ad Library?</summary><p>Yes. The Meta Ad Library is a public tool. Viewing ads that Pages are running is its intended purpose. The issue is not viewing — it is copying. Extract the principle behind a competitor's approach, then produce original ads from your own evidence.</p></details>
                <details><summary>How often should I check the Ad Library?</summary><p>Monthly is a practical cadence for most local agents. Set a calendar reminder, record what you see, and compare against previous reviews. Patterns emerge over three to six months that a single snapshot cannot reveal.</p></details>
                <details><summary>What if every competitor is already running the same offers I planned to run?</summary><p>That is the most useful finding you can make. If everyone is running appraisal ads and sold-price reports, look for the next layer: renovation guides, selling-cost explanations, buyer-demand updates, or client case studies. The goal is not to match the market — it is to find the proposition nobody else is offering.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/ads/library" target="_blank" rel="noreferrer">Meta Ad Library</a></li>
                  <li><a href="https://www.facebook.com/business/help/2405092116183307" target="_blank" rel="noreferrer">About the Meta Ad Library, Meta Business Help Center</a></li>
                  <li><a href="https://www.facebook.com/help/259468828226154" target="_blank" rel="noreferrer">What is the Meta Ad Library and how do I search it?, Meta Help Center</a></li>
                  <li><a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">About ads for housing, Meta Business Help Center</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
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
