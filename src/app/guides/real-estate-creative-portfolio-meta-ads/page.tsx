import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "Build a real estate creative portfolio that does the targeting for you";
const description =
  "Learn how to build a portfolio of distinct real estate ad concepts that let Meta's algorithm match your ads to different homeowner situations.";
const canonical = "/guides/real-estate-creative-portfolio-meta-ads";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/creative-portfolio/hero.webp", width: 1920, height: 1080, alt: "A portfolio wall of five different real estate ad concepts" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/creative-portfolio/hero.webp"] },
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
  image: "https://blockwise.sale/guides/creative-portfolio/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How many ads should I run at the same time?",
      acceptedAnswer: { "@type": "Answer", text: "For a local agent with a modest daily budget, six to twelve genuinely distinct assets is a practical starting point. Three appraisal ads with different headline wording is one concept rendered three times, not a portfolio." },
    },
    {
      "@type": "Question",
      name: "Do I need professional video production?",
      acceptedAnswer: { "@type": "Answer", text: "No. A short Reel filmed on a phone outside a recognisable local location can be more effective than a polished studio video. The format should serve the message — agent-led video builds familiarity, client video provides proof." },
    },
    {
      "@type": "Question",
      name: "Should I show sold prices in the ad?",
      acceptedAnswer: { "@type": "Answer", text: "The ad can show a verified example if you have the right to use it, but it does not need to reveal the full list. The offer should make clear that the requested resource contains the disclosed results. Avoid implying that comparable sales establish a valuation." },
    },
    {
      "@type": "Question",
      name: "How do I know which concept families to start with?",
      acceptedAnswer: { "@type": "Answer", text: "Start with market evidence and direct response. Market evidence attracts curious owners who are not ready for an appraisal. Direct response captures active sellers. Once those two are running, add a seller-problem ad and a proof ad to broaden the portfolio." },
    },
  ],
};

export default function CreativePortfolioGuidePage() {
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
                <span>Creative strategy</span>
              </div>
              <p className="bw-guides-label">The portfolio guide</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                One suburb does not equal one audience. Homeowners in the same area have different motivations — and the algorithm can only match them if you give it different ads to work with.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>13 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/creative-portfolio/hero.webp"
                alt="A portfolio wall of five different real estate ad concepts"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#one-suburb">One suburb, many audiences</a>
              <a href="#craft-framework">The CRAFT framework</a>
              <a href="#concept-families">Five concept families</a>
              <a href="#local-detail">Local detail creates relevance</a>
              <a href="#formats">Choose formats deliberately</a>
              <a href="#rhythm">A monthly rhythm</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="one-suburb">
                <p className="bw-drop-intro">
                  <span>Real estate agents are often told to find a winning ad and scale it.</span> That advice is incomplete. A strong ad can keep running while it performs, but no single concept can address every homeowner, motivation and stage of intent. Meta's Andromeda retrieval system was designed to handle rapid growth in eligible ad creatives — it scans creative signals to predict which user is most likely to respond. If you only give it one concept, you give it one thing to match with.
                </p>

                <div className="bw-contrast-row">
                  <div><span>Same suburb, same ad</span><strong>Everyone sees the same appraisal offer regardless of motivation</strong></div>
                  <div><span>Same suburb, different ads</span><strong>Meta matches each ad to the homeowner it fits best</strong></div>
                </div>

                <aside className="bw-compliance-note">
                  <strong>Housing compliance</strong>
                  <p>Real estate advertising on Meta requires selecting the Special Ad Category: Housing during campaign creation. The algorithm changes that make creative more important do not remove this compliance obligation.</p>
                  <a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">Read the housing ads policy →</a>
                </aside>
              </section>

              <section id="craft-framework" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The CRAFT framework</span>
                  <h2>Five checks before you build your next set of ads.</h2>
                  <p>If three of these checks are weak, your portfolio is probably one concept rendered several times.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>C</b><div><h3>Concept families</h3><p>Do your ads cover at least three of the five concept families?</p><span>Good: evidence + problem + proof + response</span></div></div>
                  <div className="bw-list-item"><b>R</b><div><h3>Real local detail</h3><p>Does each ad contain specific, verifiable local information?</p><span>Good: "Four-bedroom Baldivis homes — recent sales"</span></div></div>
                  <div className="bw-list-item"><b>A</b><div><h3>One argument per ad</h3><p>Does each ad make a single clear point with supporting proof?</p><span>Good: one argument, three sales as proof, one offer</span></div></div>
                  <div className="bw-list-item"><b>F</b><div><h3>Format serves the message</h3><p>Is each format chosen for what it does best, not just resized?</p><span>Good: Reel for familiarity, carousel for process</span></div></div>
                  <div className="bw-list-item"><b>T</b><div><h3>Test different hypotheses</h3><p>Is each ad testing a different reason a homeowner might engage?</p><span>Good: price evidence vs selling costs vs renovation</span></div></div>
                </div>
              </section>

              <section id="concept-families" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>The portfolio</span>
                  <h2>Build around the five concept families.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Five concept families for a real estate creative portfolio">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Family</span><span role="columnheader">What it provides</span><span role="columnheader">Example</span></div>
                  <div role="row"><strong role="cell">Market evidence</strong><span role="cell">Facts about the local market</span><span role="cell">Recent comparable sales by property type</span></div>
                  <div role="row"><strong role="cell">Seller problems</strong><span role="cell">A decision or concern</span><span role="cell">Whether to renovate before selling</span></div>
                  <div role="row"><strong role="cell">Process clarity</strong><span role="cell">Making selling less uncertain</span><span role="cell">Stages from appraisal to settlement</span></div>
                  <div role="row"><strong role="cell">Proof</strong><span role="cell">Demonstrating capability</span><span role="cell">A documented client result</span></div>
                  <div role="row"><strong role="cell">Direct response</strong><span role="cell">Asking for action</span><span role="cell">Request an appraisal</span></div>
                </div>
                <p>You need ads from at least three families to give Meta meaningful choices. Market evidence attracts curiosity. Seller problems attract consideration. Proof reduces risk. Direct response captures active intent.</p>
              </section>

              <section id="local-detail" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Local specificity</span>
                  <h2>Make the ad identify the seller.</h2>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>Compare these two</span><span>Self-selection</span></div>
                  <blockquote>Own a four-bedroom home in Baldivis? See what comparable properties actually sold for during the past 90 days.</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>vs. "Find out what your property is worth"</strong><span>Speaks to no one in particular</span></div>
                </div>
                <p>The first message contains self-selection signals: the person owns a home, it is in Baldivis, it is probably four bedrooms, and the next step is research — not a sales appointment. A homeowner who recognises themselves is more likely to stop.</p>
              </section>

              <section id="formats" className="bw-creative-section">
                <div className="bw-section-heading">
                  <span>Format selection</span>
                  <h2>Choose formats deliberately.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Format selection for real estate ads">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Format</span><span role="columnheader">Best for</span><span role="columnheader">Example</span></div>
                  <div role="row"><strong role="cell">Static image</strong><span role="cell">One fact, one comparison, one offer</span><span role="cell">Three recent sales with dates and prices</span></div>
                  <div role="row"><strong role="cell">Carousel</strong><span role="cell">A sequence or group of comparable sales</span><span role="cell">Five properties that sold above expectations</span></div>
                  <div role="row"><strong role="cell">Short video</strong><span role="cell">Explanation, familiarity, direct communication</span><span role="cell">Agent explains the month's buyer trend</span></div>
                  <div role="row"><strong role="cell">Client-led video</strong><span role="cell">Proof and objection handling</span><span role="cell">A seller describing their experience</span></div>
                  <div role="row"><strong role="cell">Property footage</strong><span role="cell">When the visual supports the point</span><span role="cell">A walk-through showing renovation quality</span></div>
                </div>
              </section>

              <section id="rhythm" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The monthly cycle</span>
                  <h2>A simple monthly rhythm.</h2>
                </div>
                <div className="bw-timeline">
                  <div><b>Week 1</b><span /><section><h3>Launch</h3><p>Publish a balanced set of distinct concepts. Do not launch all appraisal ads at once.</p></section></div>
                  <div><b>Week 2</b><span /><section><h3>Diagnose</h3><p>Check lead quality, contact rate and which messages attract each type of enquiry.</p></section></div>
                  <div><b>Week 3</b><span /><section><h3>Expand</h3><p>Create a new execution of a proven concept. Do not duplicate the same ad.</p></section></div>
                  <div><b>Week 4</b><span /><section><h3>Replace</h3><p>Remove ads with consistently weak engagement or poor lead quality. Document what changed.</p></section></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Build a creative portfolio, not one hero ad.</h2>
                  <p>You still need the local knowledge — the comparable sales, the buyer patterns, the client stories. Blockwise helps turn those distinct propositions into on-brand creative across Feed, Story and Reel formats, prepare each campaign and lead form, and bring the resulting leads into one review path.</p>
                </div>
                <Link href="/signup">Build your portfolio <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>How many ads should I run at the same time?</summary><p>For a local agent with a modest daily budget, six to twelve genuinely distinct assets is a practical starting point. The key word is distinct — three appraisal ads with different headline wording is one concept rendered three times, not a portfolio.</p></details>
                <details><summary>Do I need professional video production?</summary><p>No. A short Reel filmed on a phone outside a recognisable local location can be more effective than a polished studio video. The format should serve the message — agent-led video builds familiarity, client video provides proof, and property footage supports a point about the home itself.</p></details>
                <details><summary>Should I show sold prices in the ad?</summary><p>The ad can show a verified example if you have the right to use it, but it does not need to reveal the full list. The offer should make clear that the requested resource contains the disclosed results. Avoid implying that comparable sales establish a valuation.</p></details>
                <details><summary>How do I know which concept families to start with?</summary><p>Start with market evidence and direct response. Market evidence attracts curious owners who are not ready for an appraisal. Direct response captures active sellers. Once those two are running, add a seller-problem ad and a proof ad to broaden the portfolio.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/" target="_blank" rel="noreferrer">Meta Andromeda: Supercharging Advantage+ automation, Meta Engineering</a></li>
                  <li><a href="https://www.facebook.com/business/help/273363992030035" target="_blank" rel="noreferrer">About Advantage+ audience, Meta Business Help Center</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">About ads for housing, Meta Business Help Center</a></li>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
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
