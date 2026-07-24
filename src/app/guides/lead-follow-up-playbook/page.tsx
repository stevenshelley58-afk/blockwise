import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "The follow-up playbook that turns real estate leads into closed deals";
const description =
  "A proven follow-up cadence, call scripts and CRM automation setup for converting Facebook and Google real estate leads into closed deals.";
const canonical = "/guides/lead-follow-up-playbook";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    type: "article",
    title,
    description,
    url: canonical,
    images: [{ url: "/guides/follow-up/hero.webp", width: 1920, height: 1080, alt: "A real estate lead follow-up desk setup with phone and CRM" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/follow-up/hero.webp"] },
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
  image: "https://blockwise.sale/guides/follow-up/hero.webp",
  mainEntityOfPage: `https://blockwise.sale${canonical}`,
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How many times should I call a lead before giving up?",
      acceptedAnswer: { "@type": "Answer", text: "Follow the 14-day active cadence (roughly 4–5 call attempts), then move to a 21-day rotation for up to 12 months. Most leads who will ever answer will pick up within the first month." },
    },
    {
      "@type": "Question",
      name: "Should I use SMS or email for automated follow-up?",
      acceptedAnswer: { "@type": "Answer", text: "Both. SMS has higher open rates but lower tolerance for frequency. Email allows longer content and listing alerts. Use SMS for short check-ins (no more than once per week) and email for property alerts and market updates." },
    },
    {
      "@type": "Question",
      name: "What if I do not have a CRM?",
      acceptedAnswer: { "@type": "Answer", text: "Get one. Most brokerages provide a free CRM. Without a CRM, you cannot run a systematic follow-up cadence — you are relying on memory, which is not a strategy." },
    },
    {
      "@type": "Question",
      name: "Should I hire an ISA to handle calls?",
      acceptedAnswer: { "@type": "Answer", text: "If your lead volume exceeds what you can call personally within 24 hours, an ISA is the next step. The system works whether the caller is you or a trained ISA." },
    },
    {
      "@type": "Question",
      name: "Does this work for both Facebook and Google leads?",
      acceptedAnswer: { "@type": "Answer", text: "Yes. The cadence is platform-agnostic. Google leads tend to be higher-intent, so they may convert faster. Facebook leads tend to be earlier in the process, so the nurture phase may run longer." },
    },
  ],
};

export default function FollowUpPlaybookGuidePage() {
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
                <span>Lead conversion</span>
              </div>
              <p className="bw-guides-label">The conversion system</p>
              <h1>{title}</h1>
              <p className="bw-article-deck">
                The average lead converts after seven touch points. The average agent follows up once. This is the system that closes the gap.
              </p>
              <div className="bw-article-byline">
                <span>By Blockwise</span>
                <span>24 July 2026</span>
                <span>13 minute read</span>
              </div>
            </div>
            <div className="bw-article-hero-media">
              <Image
                src="/guides/follow-up/hero.webp"
                alt="A real estate lead follow-up desk setup with phone and CRM"
                fill
                priority
                sizes="100vw"
              />
            </div>
          </header>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#problem">Why agents lose leads</a>
              <a href="#system">The 90-day system</a>
              <a href="#first-call">The first call</a>
              <a href="#timeline">Timeline-based intensity</a>
              <a href="#alerts">Listing alerts</a>
              <a href="#crm">Track in your CRM</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="problem">
                <p className="bw-drop-intro">
                  <span>Generating leads is the easy part.</span> A $20-a-day Meta lead ad will produce leads within 24 hours. The hard part — the part that determines whether you close deals or waste money — is what happens after the form is submitted.
                </p>
                <figure className="bw-stat-spread">
                  <div className="bw-stat-ring" aria-label="7 touch points">
                    <svg viewBox="0 0 180 180" role="img" aria-labelledby="followup-stat-title followup-stat-desc">
                      <title id="followup-stat-title">The average lead converts after 7 touch points</title>
                      <desc id="followup-stat-desc">A ring showing 7 out of an average agent's 1 follow-up.</desc>
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-track" />
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-value" />
                    </svg>
                    <strong>7×</strong>
                  </div>
                  <figcaption>
                    <p>The average lead converts after seven touch points. The average agent follows up once.</p>
                    <span>That gap is where 74% of agents fail to close a deal in a given year.</span>
                  </figcaption>
                </figure>
              </section>

              <section className="bw-flow-section" aria-labelledby="failure-title">
                <div className="bw-section-heading">
                  <span>Three failure patterns</span>
                  <h2 id="failure-title">Why most agents lose leads.</h2>
                </div>
                <div className="bw-signal-flow" role="img" aria-label="Three common ways agents lose leads">
                  <div><b>01</b><strong>No CRM</strong><span>Leads sit unseen in Ads Manager</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>02</b><strong>One call, then quit</strong><span>9/10 leads don't answer the first call</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>03</b><strong>No system</strong><span>Follow-up becomes a memory test</span></div>
                </div>
                <p className="bw-article-note">One call is not a follow-up strategy — it is a coincidence check. The practical standard is: call within 24 hours, then stay on a cadence.</p>
              </section>

              <section id="system" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The 90-day follow-up system</span>
                  <h2>Two phases: active, then nurture.</h2>
                </div>
                <p>The system assumes you have a CRM and can set up automated emails and SMS. Phone calls are manual. Everything else should be automated.</p>
                <div className="bw-timeline">
                  <div><b>Day 1</b><span /><section><h3>Call within 24 hours</h3><p>Introduce yourself and confirm the lead received what they requested.</p></section></div>
                  <div><b>Day 2</b><span /><section><h3>Personalised email</h3><p>Reference the specific property or list they viewed.</p></section></div>
                  <div><b>Day 3</b><span /><section><h3>Call again</h3><p>Second attempt.</p></section></div>
                  <div><b>Day 5</b><span /><section><h3>SMS check-in</h3><p>Low-friction re-engagement: "Any questions about specific properties?"</p></section></div>
                  <div><b>Day 7</b><span /><section><h3>Call again</h3><p>Third attempt.</p></section></div>
                  <div><b>Day 10</b><span /><section><h3>Market update</h3><p>Send a relevant local market update or new matching listing.</p></section></div>
                  <div><b>Day 12</b><span /><section><h3>Call again</h3><p>Fourth attempt.</p></section></div>
                  <div><b>Day 14</b><span /><section><h3>Appointment attempt</h3><p>SMS offering a 15-minute call to discuss their search.</p></section></div>
                  <div><b>Weeks 3+</b><span /><section><h3>21-day rotation</h3><p>One call every 21 days. Automated emails and listing alerts continue. Runs for up to 12 months.</p></section></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>The CRM automation layer</strong>
                  <p>Set up a drip campaign that runs for up to 1,000 days. Include property alerts (automated listing matches), a weekly email, a monthly market report, and interspersed SMS touches. The goal is not to replace the phone call — it is to keep your name in front of the lead between calls.</p>
                </aside>
              </section>

              <section id="first-call" className="bw-creative-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The first call</span>
                  <h2>Three goals, in this order.</h2>
                  <p>Do not pitch on the first call unless they ask. The goal is information, not an appointment. Appointments come later, once you understand what they need and when.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>1</b><div><h3>Build human connection</h3><p>Let them know you are a real person. Confirm they received what they requested.</p><span>Not an automated system</span></div></div>
                  <div className="bw-list-item"><b>2</b><div><h3>Understand their goal</h3><p>What are they looking for? What area? Let them tell you — do not recite their search history.</p><span>Listen, don't observe</span></div></div>
                  <div className="bw-list-item"><b>3</b><div><h3>Establish timeline</h3><p>When are they hoping to move? This is the single most important piece of information.</p><span>Determines everything that follows</span></div></div>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>First call script</span><span>Copy specimen</span></div>
                  <blockquote>Hi <mark>[name]</mark>, it's <mark>[your name]</mark> from <mark>[agency]</mark>. You recently requested the <mark>[list]</mark> — I just wanted to make sure you got that and see if you had any questions. So I can point you in the right direction — are you looking to buy, sell, or both? And what's your timeline?</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>Information, not a pitch</strong><span>Listen more than you talk</span></div>
                </div>
              </section>

              <section id="timeline" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>After the first conversation</span>
                  <h2>Match your cadence to their timeline.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Timeline-based follow-up intensity">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Timeline</span><span role="columnheader">Call frequency</span></div>
                  {[
                    ["0–30 days (hot)", "Once per week + listing alerts"],
                    ["30–90 days (warm)", "Every 2 weeks + listing alerts"],
                    ["3–6 months (nurture)", "Every 3 weeks + market emails"],
                    ["6–12 months (pipeline)", "Monthly + market emails"],
                    ["12+ months (long-term)", "Quarterly + market emails"],
                  ].map(([timeline, frequency]) => (
                    <div role="row" key={timeline}><strong role="cell">{timeline}</strong><span role="cell">{frequency}</span></div>
                  ))}
                </div>
                <p>When a lead's timeline shortens — they call you, reply to an email, or click through on a listing alert — move them up a tier immediately.</p>
              </section>

              <section id="alerts" className="bw-text-section">
                <h2>The listing alert advantage</h2>
                <p>Automated listing alerts are the highest-leverage tool in your CRM. When you set a lead up on alerts, they receive new properties matching their search criteria automatically.</p>
                <div className="bw-source-checklist">
                  <h3>What listing alerts do</h3>
                  <ul>
                    <li><span aria-hidden>✓</span> Deliver ongoing value without manual effort</li>
                    <li><span aria-hidden>✓</span> Generate intent signals — your CRM tracks clicks and views</li>
                    <li><span aria-hidden>✓</span> Create a natural reason to call about a specific property</li>
                    <li><span aria-hidden>✓</span> Keep the lead on your website instead of a portal</li>
                  </ul>
                </div>
                <p>A spike in activity is your signal to call: "I noticed you've been looking at [property] — would you like me to arrange a viewing?"</p>
              </section>

              <section id="crm" className="bw-text-section">
                <h2>Track follow-up in your CRM</h2>
                <p>Your CRM is not just a contact database. It is your follow-up scoreboard. Track these fields for every lead:</p>
                <div className="bw-contrast-row">
                  <div><span>Essential fields</span><strong>Source, date registered, call attempts, last contact, timeline, status</strong></div>
                  <div><span>Review weekly</span><strong>20 leads in "attempting" and zero in "contacted" = cadence not working</strong></div>
                </div>
              </section>

              <section className="bw-blockwise-cta">
                <div>
                  <span>Where Blockwise fits</span>
                  <h2>Stop losing leads to slow follow-up.</h2>
                  <p>Blockwise brings Meta and Google leads into one organised review queue, so no lead sits unseen in Ads Manager. The follow-up system works within any CRM, but having all your leads in a single view makes the cadence easier to run.</p>
                </div>
                <Link href="/signup">Start closing more leads <span aria-hidden>→</span></Link>
              </section>

              <section className="bw-faq-section">
                <div className="bw-section-heading">
                  <span>Questions</span>
                  <h2>The practical details.</h2>
                </div>
                <details><summary>How many times should I call a lead before giving up?</summary><p>Do not give up after a fixed number. Follow the 14-day active cadence (roughly 4–5 call attempts), then move to a 21-day rotation for up to 12 months. Most leads who will ever answer will pick up within the first month, but the 21-day rotation catches late bloomers.</p></details>
                <details><summary>Should I use SMS or email for automated follow-up?</summary><p>Both. SMS has higher open rates but lower tolerance for frequency. Email allows longer content and listing alerts. Use SMS for short check-ins (no more than once per week) and email for property alerts, market updates and newsletters.</p></details>
                <details><summary>What if I do not have a CRM?</summary><p>Get one. Most brokerages provide a free CRM. If your brokerage does not, Follow Up Boss, Lofty and Real Geeks all offer affordable plans. Without a CRM, you cannot run a systematic follow-up cadence.</p></details>
                <details><summary>Should I hire an ISA to handle calls?</summary><p>If your lead volume exceeds what you can call personally within 24 hours, an ISA is the next step. The system works whether the caller is you or a trained ISA. The key is that someone calls within 24 hours and stays on the cadence.</p></details>
                <details><summary>Does this work for both Facebook and Google leads?</summary><p>Yes. The cadence is platform-agnostic. Google leads tend to be higher-intent, so they may convert faster. Facebook leads tend to be earlier in the process, so the nurture phase may run longer. The system handles both.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a></li>
                  <li><a href="https://www.followupboss.com/real-estate-crm" target="_blank" rel="noreferrer">Real estate CRM best practices, Follow Up Boss</a></li>
                  <li><a href="https://support.google.com/google-ads/answer/6343147" target="_blank" rel="noreferrer">Google Ads for real estate, Google Ads Help</a></li>
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
