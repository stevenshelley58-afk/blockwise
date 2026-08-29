import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "How Meta's 2026 ad algorithm changes real estate advertising";
const description =
  "Understand how Andromeda, GEM and Meta's Adaptive Ranking Model affect Facebook and Instagram advertising for real estate agents in 2026.";
const canonical = "/guides/meta-ads-algorithm-changes-real-estate";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/meta-algorithm/hero.webp", width: 1920, height: 1080, alt: "Abstract layers representing Meta's ad retrieval and ranking pipeline" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/meta-algorithm/hero.webp"] },
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
  image: "https://blockwise.sale/guides/meta-algorithm/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Do I still need to set a location target?",
      acceptedAnswer: { "@type": "Answer", text: "Yes. Your geographic service area is a genuine business constraint, and Meta's system respects it. What you should remove is the layering of speculative interests inside that location. Let the creative identify the homeowner situation; let the location setting define where you can operate." },
    },
    {
      "@type": "Question",
      name: "Does this mean I should run 50 ads at once?",
      acceptedAnswer: { "@type": "Answer", text: "No. A local agent spending a modest daily budget should not blindly upload dozens of ads. Start with six to twelve genuinely distinct assets — different problems, different proofs, different offers — and let the system learn which messages create real conversations." },
    },
    {
      "@type": "Question",
      name: 'Is "creative is the new targeting" just a marketing phrase?',
      acceptedAnswer: { "@type": "Answer", text: "It reflects a real architectural change. Andromeda retrieves ads by reading creative signals. Advantage+ audience treats your audience inputs as suggestions. The content of your ad now plays a larger role in determining who responds. Audience settings have not disappeared — they have been demoted." },
    },
    {
      "@type": "Question",
      name: "Should I select the Housing Special Ad Category for real estate ads?",
      acceptedAnswer: { "@type": "Answer", text: "Yes, when the campaign relates to housing. Meta requires advertisers to select the relevant Special Ad Category, and failing to do so may result in ad rejection. The algorithm changes do not remove compliance obligations." },
    },
  ],
};

export default function MetaAlgorithmGuidePage() {
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
                <span>Meta ads strategy</span>
              </div>
              <p className="bw-guides-label">The algorithm guide</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                Meta replaced three layers of its ad system in twelve months. The agents who adapt are the ones who stop over-targeting and start diversifying their creative.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>12 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/meta-algorithm/hero.webp"
                alt="Abstract layers representing Meta's ad retrieval and ranking pipeline"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#three-layers">The three layers</a>
              <a href="#pace-framework">The PACE framework</a>
              <a href="#stop-over-targeting">Stop over-targeting</a>
              <a href="#different-problems">Give Meta different problems</a>
              <a href="#track-outcomes">Track outcomes</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="three-layers">
                <p className="bw-drop-intro">
                  <span>Most explanations of Meta's advertising system begin and end with Andromeda.</span> That is now incomplete. Meta replaced three layers of its ad system in roughly twelve months — the retrieval engine, the shared knowledge model, and the real-time ranking process. Each change shifts more of the matching work away from the targeting panel and toward the creative itself.
                </p>

                <div className="bw-section-heading">
                  <span>What changed</span>
                  <h2>Three systems, one shift.</h2>
                </div>

                <div className="bw-measure-table" role="table" aria-label="Meta's three new ad system layers">
                  <div role="row" className="bw-measure-head"><span role="columnheader">System</span><span role="columnheader">What it does</span><span role="columnheader">Meta-reported lift</span></div>
                  <div role="row"><strong role="cell">Andromeda</strong><span role="cell">Retrieves relevant ads from tens of millions of candidates by reading creative signals</span><span role="cell">6% recall, 8% ad quality</span></div>
                  <div role="row"><strong role="cell">GEM</strong><span role="cell">Foundation model sharing learning across all Meta advertising models</span><span role="cell">5% Instagram, 3% Facebook Feed</span></div>
                  <div role="row"><strong role="cell">Adaptive Ranking</strong><span role="cell">LLM-scale model complexity in real-time ad ranking</span><span role="cell">3% conversions, 5% CTR</span></div>
                  <div role="row"><strong role="cell">Sequence learning</strong><span role="cell">Examines patterns across previous interactions, not just manual targeting</span><span role="cell">2–4% conversions</span></div>
                </div>
                <p className="bw-article-note">These are Meta-reported platform averages, not performance guarantees for an individual advertiser.</p>
              </section>

              <section id="pace-framework" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The PACE framework</span>
                  <h2>Four checks before you build your next campaign.</h2>
                  <p>If one of these is weak, fix it before spending.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>P</b><div><h3>Problem diversity</h3><p>Do your ads address different homeowner problems, or the same problem reworded?</p><span>Good: sold-price report + renovation guide + buyer-demand update</span></div></div>
                  <div className="bw-list-item"><b>A</b><div><h3>Audience as suggestion</h3><p>Are you treating location as a constraint and leaving the rest to Meta?</p><span>Good: suburb targeting + Advantage+ expansion</span></div></div>
                  <div className="bw-list-item"><b>C</b><div><h3>Creative as signal</h3><p>Does each ad contain enough specific information for the algorithm to match it?</p><span>Good: "Four-bedroom Baldivis homes — see recent sales"</span></div></div>
                  <div className="bw-list-item"><b>E</b><div><h3>Evidence over assertion</h3><p>Does each ad demonstrate local knowledge with verifiable proof?</p><span>Good: three recent sales with dates and types</span></div></div>
                </div>
              </section>

              <section id="stop-over-targeting" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>The targeting panel</span>
                  <h2>Stop over-targeting.</h2>
                </div>
                <p>The old approach was to build a precise audience: an age range, several property interests, a postcode and an income proxy, then show everyone in that audience the same appraisal ad. The new system makes that approach counterproductive.</p>
                <p>Advantage+ audience can use your inputs as suggestions and search more broadly when it predicts better performance. Advantage+ is now the default for eligible leads campaigns.</p>
                <div className="bw-contrast-row">
                  <div><span>Keep</span><strong>Location, Special Ad Category: Housing, legal exclusions</strong></div>
                  <div><span>Remove</span><strong>Seven interest filters stacked inside one postcode</strong></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>Housing compliance</strong>
                  <p>Real estate advertising on Meta requires selecting the Special Ad Category: Housing. The algorithm changes do not remove this obligation — they make strong creative more important because you cannot depend on unrestricted targeting.</p>
                  <a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">Read the housing ads policy →</a>
                </aside>
              </section>

              <section id="different-problems" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>Creative strategy</span>
                  <h2>Give Meta different problems, not different colours.</h2>
                </div>
                <p>Changing the background colour on an appraisal graphic does not create another targeting option. Changing the homeowner's problem does.</p>
                <div className="bw-measure-table" role="table" aria-label="Ad concepts for different homeowner situations">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Ad concept</span><span role="columnheader">Homeowner situation</span><span role="columnheader">Next step</span></div>
                  <div role="row"><strong role="cell">Sold-price report</strong><span role="cell">Curious owner checking the market</span><span role="cell">Download</span></div>
                  <div role="row"><strong role="cell">Buyer-demand update</strong><span role="cell">Owner considering timing</span><span role="cell">View summary</span></div>
                  <div role="row"><strong role="cell">Renovate-or-sell guide</strong><span role="cell">Preparing seller</span><span role="cell">Download</span></div>
                  <div role="row"><strong role="cell">Appraisal invitation</strong><span role="cell">Active seller</span><span role="cell">Book a call</span></div>
                </div>
                <p>These ads support the same commercial objective — more listings. They approach it through different homeowner situations.</p>
              </section>

              <section id="track-outcomes" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The feedback signal</span>
                  <h2>Track what happens after the lead arrives.</h2>
                </div>
                <p>Meta can only optimise toward the outcomes it receives. If the only signal is "form submitted," the system searches for more people likely to submit forms — not more people likely to become listings.</p>
                <p>If your CRM can send downstream outcomes back to Meta through the Conversions API for CRM, the system can optimise toward leads more likely to become qualified. Meta reports advertisers using this setup saw an average 15% reduction in cost per quality lead.</p>
                <aside className="bw-compliance-note">
                  <strong>Why feedback matters</strong>
                  <p>Without downstream data, two ads that each generate ten form submissions look identical to the algorithm — even if one produced a listing and the other produced nothing.</p>
                </aside>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Stop fighting the algorithm with over-targeting.</h2>
                  <p>The algorithm moved strategy out of the targeting panel and into the ad itself. Blockwise helps turn distinct seller propositions into on-brand creative, prepare the campaign and lead form, and bring Meta leads into a clearer review path.</p>
                </div>
                <Link href="/signup">Build your campaign <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>Do I still need to set a location target?</summary><p>Yes. Your geographic service area is a genuine business constraint. What you should remove is the layering of speculative interests inside that location. Let the creative identify the homeowner situation; let the location setting define where you can operate.</p></details>
                <details><summary>Does this mean I should run 50 ads at once?</summary><p>No. A local agent spending a modest daily budget should start with six to twelve genuinely distinct assets — different problems, different proofs, different offers — and let the system learn which messages create real conversations.</p></details>
                <details><summary>Is "creative is the new targeting" just a marketing phrase?</summary><p>It reflects a real architectural change. Andromeda retrieves ads by reading creative signals. Advantage+ audience treats your audience inputs as suggestions. The content of your ad now plays a larger role in determining who responds. Audience settings have not disappeared — they have been demoted.</p></details>
                <details><summary>Should I select the Housing Special Ad Category for real estate ads?</summary><p>Yes, when the campaign relates to housing. Meta requires advertisers to select the relevant Special Ad Category, and failing to do so may result in ad rejection. The algorithm changes do not remove compliance obligations.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/" target="_blank" rel="noreferrer">Meta Andromeda: Supercharging Advantage+ automation, Meta Engineering</a></li>
                  <li><a href="https://engineering.fb.com/2025/11/10/ml-applications/metas-generative-ads-model-gem-the-central-brain-accelerating-ads-recommendation-ai-innovation/" target="_blank" rel="noreferrer">Meta's Generative Ads Model (GEM), Meta Engineering</a></li>
                  <li><a href="https://engineering.fb.com/2026/03/31/ml-applications/meta-adaptive-ranking-model-bending-the-inference-scaling-curve-to-serve-llm-scale-models-for-ads/" target="_blank" rel="noreferrer">Meta Adaptive Ranking Model, Meta Engineering</a></li>
                  <li><a href="https://engineering.fb.com/2024/11/19/data-infrastructure/sequence-learning-personalized-ads-recommendations/" target="_blank" rel="noreferrer">Sequence learning for personalized ads, Meta Engineering</a></li>
                  <li><a href="https://www.facebook.com/business/help/273363992030035" target="_blank" rel="noreferrer">About Advantage+ audience, Meta Business Help Center</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/generate-leads/conversions-api-for-crm" target="_blank" rel="noreferrer">Improve lead quality with Conversions API for CRM, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">About ads for housing, Meta Business Help Center</a></li>
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
