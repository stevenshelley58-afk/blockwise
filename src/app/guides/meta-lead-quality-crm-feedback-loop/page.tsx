import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "Meta cannot optimise for listings if you only report leads";
const description =
  "Learn how real estate agents can improve Meta lead quality by sending appraisal, qualification and listing outcomes back through the Conversions API.";
const canonical = "/guides/meta-lead-quality-crm-feedback-loop";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/lead-quality/hero.webp", width: 1920, height: 1080, alt: "A feedback loop diagram showing lead quality signals returning to the advertising platform" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/lead-quality/hero.webp"] },
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
  image: "https://blockwise.sale/guides/lead-quality/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is the difference between lead ads and conversion leads?",
      acceptedAnswer: { "@type": "Answer", text: "Lead ads optimise for form submissions. Conversion leads is a performance goal that uses CRM data returned through the Conversions API to optimise toward leads more likely to become qualified. You need a CRM integration with the Meta Lead ID stored for each lead to use it." },
    },
    {
      "@type": "Question",
      name: "Do I need 200 leads per month to benefit from CRM feedback?",
      acceptedAnswer: { "@type": "Answer", text: "Meta recommends at least 200 leads per month for the conversion-leads goal to have enough data to optimise. Below that volume, you can still log outcomes and measure your funnel internally — you just may not see the full algorithmic benefit." },
    },
    {
      "@type": "Question",
      name: "What if my CRM does not store the Meta Lead ID?",
      acceptedAnswer: { "@type": "Answer", text: "You need the Meta Lead ID (a 15–17 digit number) stored in your CRM for each lead to send outcomes back through the Conversions API. Most modern CRMs that integrate with Meta lead ads will capture this automatically. If yours does not, check whether a Meta Business Partner integration can bridge the gap." },
    },
    {
      "@type": "Question",
      name: "Should I send every stage of my pipeline back to Meta?",
      acceptedAnswer: { "@type": "Answer", text: "No. Pick the one or two stages that best predict a listing — typically appraisal booked or qualified seller. Sending too many events dilutes the signal. The event should occur within 28 days of lead generation and have a conversion rate between 1% and 40%." },
    },
  ],
};

export default function LeadQualityGuidePage() {
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
                <span>Lead quality</span>
              </div>
              <p className="bw-guides-label">The feedback loop guide</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                A cheap Meta lead is not necessarily a useful real estate lead. Meta can only optimise toward the outcomes it receives — and most agencies only send form submissions.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>12 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/lead-quality/hero.webp"
                alt="A feedback loop diagram showing lead quality signals returning to the advertising platform"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#what-meta-offers">What Meta offers</a>
              <a href="#loop-framework">The LOOP framework</a>
              <a href="#define-quality">Define what counts as quality</a>
              <a href="#why-discipline">Why CRM discipline matters</a>
              <a href="#connect-api">Connect the Conversions API</a>
              <a href="#measure">Measure the funnel</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="what-meta-offers">
                <p className="bw-drop-intro">
                  <span>A cheap Meta lead is not necessarily a useful real estate lead.</span> It may contain a correct name, phone number and property address. That still does not tell you whether the person owns the property, plans to sell, answers the phone or eventually signs an agency agreement. Meta can only optimise toward the outcomes it receives. If the final signal is "form submitted," the system will search for more people likely to submit forms.
                </p>

                <div className="bw-section-heading">
                  <span>What Meta offers</span>
                  <h2>Advantage+ and the conversion-leads goal.</h2>
                </div>
                <p>Advantage+ is now enabled by default for eligible leads campaigns. For advertisers with suitable CRM integrations, Meta also offers a conversion-leads performance goal that allows downstream CRM outcomes to be returned through the Conversions API so delivery can optimise toward leads more likely to become qualified.</p>
                <figure className="bw-stat-spread">
                  <div className="bw-stat-ring" aria-label="44 percent">
                    <svg viewBox="0 0 180 180" role="img" aria-labelledby="lead-stat-title lead-stat-desc">
                      <title id="lead-stat-title">44% increase in quality leads with CRM feedback</title>
                      <desc id="lead-stat-desc">Nearly half the circle is highlighted.</desc>
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-track" />
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-value" />
                    </svg>
                    <strong>44%</strong>
                  </div>
                  <figcaption>
                    <p>increase in the rate at which leads became quality leads, for advertisers using the conversion-leads setup with CRM data.</p>
                    <a href="https://www.facebook.com/business/generate-leads/conversions-api-for-crm" target="_blank" rel="noreferrer">Source: Meta for Business</a>
                  </figcaption>
                </figure>
                <p className="bw-article-note">Meta also reports an average 15% reduction in cost per quality lead. These are Meta-reported averages, not guaranteed results.</p>
              </section>

              <section id="loop-framework" className="bw-list-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The LOOP framework</span>
                  <h2>Four stages to close the gap.</h2>
                  <p>If you are only logging outcomes for internal use, you are giving Meta nothing to learn from.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>L</b><div><h3>Log every outcome</h3><p>Record what happens after each lead arrives — contact, qualification, appointment, listing.</p><span>Good: outcomes in the CRM, not notebooks</span></div></div>
                  <div className="bw-list-item"><b>O</b><div><h3>Objective definition</h3><p>Define what counts as a qualified seller lead using written criteria.</p><span>Good: written rules, not "the vibe"</span></div></div>
                  <div className="bw-list-item"><b>O</b><div><h3>Outcome return</h3><p>Send at least one downstream event back to Meta through the Conversions API.</p><span>Good: appraisal- booked event connected</span></div></div>
                  <div className="bw-list-item"><b>P</b><div><h3>Pipeline measurement</h3><p>Measure cost per qualified lead, appraisal and listing — not just cost per lead.</p><span>Good: full funnel in the dashboard</span></div></div>
                </div>
              </section>

              <section id="define-quality" className="bw-text-section">
                <div className="bw-section-heading">
                  <span>Qualification</span>
                  <h2>Define what counts as a quality lead.</h2>
                </div>
                <p>Each agency needs a consistent definition. Without one, salespeople will mark leads as qualified based on feeling, and the data becomes unreliable.</p>
                <div className="bw-measure-table" role="table" aria-label="Lead qualification progression">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Stage</span><span role="columnheader">Definition</span></div>
                  <div role="row"><strong role="cell">1. Lead received</strong><span role="cell">Form submitted with contact details</span></div>
                  <div role="row"><strong role="cell">2. Valid contact</strong><span role="cell">Phone or email reaches a real person</span></div>
                  <div role="row"><strong role="cell">3. Owner confirmed</strong><span role="cell">The person owns or decides on the property</span></div>
                  <div role="row"><strong role="cell">4. Conversation completed</strong><span role="cell">A two-way discussion about their situation</span></div>
                  <div role="row"><strong role="cell">5. Timeframe identified</strong><span role="cell">When they plan to move</span></div>
                  <div role="row"><strong role="cell">6. Appraisal booked</strong><span role="cell">They agreed to a property assessment</span></div>
                  <div role="row"><strong role="cell">7. Appraisal completed</strong><span role="cell">The assessment happened</span></div>
                  <div role="row"><strong role="cell">8. Listing opportunity</strong><span role="cell">A genuine chance to pitch</span></div>
                  <div role="row"><strong role="cell">9. Agreement signed</strong><span role="cell">The listing is yours</span></div>
                </div>
                <p>Not every stage needs to be sent to Meta. Identify at least one downstream event that represents substantially more value than a basic enquiry — typically appraisal booked or qualified seller.</p>
              </section>

              <section id="why-discipline" className="bw-creative-section">
                <div className="bw-section-heading">
                  <span>Why discipline matters</span>
                  <h2>Two ads, ten leads each — only one produces a listing.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Comparison of two ads with same lead count but different quality">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Metric</span><span role="columnheader">Ad A</span><span role="columnheader">Ad B</span></div>
                  <div role="row"><strong role="cell">Leads</strong><span role="cell">10</span><span role="cell">10</span></div>
                  <div role="row"><strong role="cell">Cost per lead</strong><span role="cell">A$4</span><span role="cell">A$12</span></div>
                  <div role="row"><strong role="cell">Answered calls</strong><span role="cell">0</span><span role="cell">6</span></div>
                  <div role="row"><strong role="cell">Appraisals booked</strong><span role="cell">0</span><span role="cell">4</span></div>
                  <div role="row"><strong role="cell">Listings</strong><span role="cell">0</span><span role="cell">1</span></div>
                </div>
                <p>If Meta only receives form submissions, both ads look identical — ten conversions each. If you optimise around cost per lead, Ad A looks superior. The system is being rewarded for the wrong outcome.</p>
              </section>

              <section id="connect-api" className="bw-campaign-section">
                <div className="bw-section-heading">
                  <span>The integration</span>
                  <h2>Connect the Conversions API for CRM.</h2>
                </div>
                <div className="bw-campaign-settings">
                  <dl>
                    <div><dt>What you need</dt><dd>A CRM that stores the 15–17 digit Meta Lead ID</dd></div>
                    <div><dt>Minimum volume</dt><dd>At least 200 leads per month</dd></div>
                    <div><dt>Event timing</dt><dd>The stage occurs within 28 days of lead generation</dd></div>
                    <div><dt>Conversion rate</dt><dd>Between 1% and 40% for the chosen stage</dd></div>
                  </dl>
                </div>
                <div className="bw-source-checklist">
                  <h3>Setup steps</h3>
                  <ul>
                    <li><span aria-hidden>✓</span> Sync your CRM with Meta so leads flow in with their Lead ID</li>
                    <li><span aria-hidden>✓</span> Set up the Conversions API connection via a Business Partner or custom build</li>
                    <li><span aria-hidden>✓</span> In Ads Manager, select the conversion-leads performance goal</li>
                    <li><span aria-hidden>✓</span> Run the campaign and let the system learn from returned outcomes</li>
                  </ul>
                </div>
              </section>

              <section id="measure" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>The full funnel</span>
                  <h2>Measure the funnel, not one number.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Real estate lead funnel metrics">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Stage</span><span role="columnheader">What it reveals</span></div>
                  <div role="row"><strong role="cell">Cost per lead</strong><span role="cell">What Meta charges for a submitted form</span></div>
                  <div role="row"><strong role="cell">Contact rate</strong><span role="cell">Whether the form review and delivery steps work</span></div>
                  <div role="row"><strong role="cell">Cost per qualified seller</strong><span role="cell">Whether the offer attracts the right homeowners</span></div>
                  <div role="row"><strong role="cell">Cost per appraisal booked</strong><span role="cell">Whether follow-up converts interest to action</span></div>
                  <div role="row"><strong role="cell">Cost per listing opportunity</strong><span role="cell">Whether appraisals produce pitchable business</span></div>
                  <div role="row"><strong role="cell">Cost per signed listing</strong><span role="cell">The true cost of customer acquisition</span></div>
                </div>
                <p>This often reveals that the cheapest lead source is not the cheapest source of listings.</p>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Stop asking Meta for more leads while withholding what makes a lead good.</h2>
                  <p>Blockwise brings Meta leads into one organised review queue, so no lead sits unseen in Ads Manager. That makes the logging stage easier — every lead is visible, assignable and trackable from the moment it arrives. The CRM integration, qualification rules and Conversions API setup remain your responsibility — Blockwise makes the upstream half of the loop work cleanly.</p>
                </div>
                <Link href="/signup">Build your loop <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>What is the difference between lead ads and conversion leads?</summary><p>Lead ads optimise for form submissions. Conversion leads is a performance goal that uses CRM data returned through the Conversions API to optimise toward leads more likely to become qualified. You need a CRM integration with the Meta Lead ID stored for each lead to use it.</p></details>
                <details><summary>Do I need 200 leads per month to benefit from CRM feedback?</summary><p>Meta recommends at least 200 leads per month for the conversion-leads goal to have enough data to optimise. Below that volume, you can still log outcomes and measure your funnel internally — you just may not see the full algorithmic benefit.</p></details>
                <details><summary>What if my CRM does not store the Meta Lead ID?</summary><p>You need the Meta Lead ID (a 15–17 digit number) stored in your CRM for each lead to send outcomes back through the Conversions API. Most modern CRMs that integrate with Meta lead ads will capture this automatically. If yours does not, check whether a Meta Business Partner integration can bridge the gap.</p></details>
                <details><summary>Should I send every stage of my pipeline back to Meta?</summary><p>No. Pick the one or two stages that best predict a listing — typically appraisal booked or qualified seller. Sending too many events dilutes the signal. The event should occur within 28 days of lead generation and have a conversion rate between 1% and 40%.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/business/generate-leads/conversions-api-for-crm" target="_blank" rel="noreferrer">Improve lead quality with the Conversions API for CRM, Meta for Business</a></li>
                  <li><a href="https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration" target="_blank" rel="noreferrer">Conversions API for CRM integration, Meta for Developers</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/help/1198401317374558" target="_blank" rel="noreferrer">About ads for housing, Meta Business Help Center</a></li>
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
