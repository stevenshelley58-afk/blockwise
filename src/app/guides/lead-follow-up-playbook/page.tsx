import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "A practical follow-up cadence for real estate leads";
const description =
  "A documented call, email and SMS cadence for real estate leads, with scripts, CRM setup and compliance guidance.";
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
      acceptedAnswer: { "@type": "Answer", text: "Follow the 14-day response cadence (roughly 4–5 call attempts), then move to a 21-day rotation through the qualification phase (day 15 to 90), then to a longer nurture cadence after day 90. A lead who has not engaged in an extended period should be reviewed — if they have unsubscribed, stop all commercial messages." },
    },
    {
      "@type": "Question",
      name: "Should I use SMS or email for automated follow-up?",
      acceptedAnswer: { "@type": "Answer", text: "Both, but only with consent. SMS has higher open rates but lower tolerance for frequency. Use SMS for short check-ins (no more than once per week) and email for property alerts and market updates. Ensure every message includes a functional unsubscribe mechanism, and honour unsubscribe requests within five working days." },
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
      acceptedAnswer: { "@type": "Answer", text: "Yes. The cadence is platform-agnostic. Google leads tend to be higher-intent, so they may engage faster. Facebook leads tend to be earlier in the process, so the nurture phase may run longer." },
    },
    {
      "@type": "Question",
      name: "What are my compliance obligations for SMS and email follow-up?",
      acceptedAnswer: { "@type": "Answer", text: "Australian commercial email and SMS rules require consent, accurate sender identification and a functional unsubscribe mechanism. Unsubscribe requests must be honoured within five working days. See the ACMA guidance on avoiding spam and the OAIC direct marketing guidance." },
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
                Use a documented call, email and SMS cadence, then adjust frequency according to the lead's intent, engagement and timing.
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

          <div className="bw-article-at-glance">
            <h2>At a glance</h2>
            <dl>
              <div><dt>System</dt><dd>Call, email and SMS cadence in three phases</dd></div>
              <div><dt>Phase 1</dt><dd>Response — Day 0 to 14</dd></div>
              <div><dt>Phase 2</dt><dd>Qualification — Day 15 to 90</dd></div>
              <div><dt>Phase 3</dt><dd>Permission-based nurture — after day 90</dd></div>
              <div><dt>Primary metric</dt><dd>Conversation and appointment rate</dd></div>
              <div><dt>Compliance</dt><dd>Consent, sender ID, unsubscribe within 5 days</dd></div>
            </dl>
          </div>

          <div className="bw-article-body">
            <aside className="bw-article-toc" aria-label="On this page">
              <strong>On this page</strong>
              <a href="#problem">Why agents lose leads</a>
              <a href="#system">The follow-up cadence</a>
              <a href="#compliance">Compliance</a>
              <a href="#first-call">The first call</a>
              <a href="#timeline">Timeline-based intensity</a>
              <a href="#alerts">Listing alerts</a>
              <a href="#crm">Track in your CRM</a>
            </aside>

            <div className="bw-article-prose">
              <section className="bw-opening" id="problem">
                <p className="bw-drop-intro">
                  <span>Generating leads is the easy part.</span> The hard part — the part that determines whether you build a pipeline or waste money — is what happens after the form is submitted.
                </p>
                <figure className="bw-stat-spread">
                  <div className="bw-stat-ring" aria-label="Documented cadence">
                    <svg viewBox="0 0 180 180" role="img" aria-labelledby="followup-stat-title followup-stat-desc">
                      <title id="followup-stat-title">A documented cadence beats ad-hoc calling</title>
                      <desc id="followup-stat-desc">A written follow-up schedule outperforms calling from memory.</desc>
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-track" />
                      <circle cx="90" cy="90" r="70" pathLength="100" className="bw-stat-ring-value" />
                    </svg>
                    <strong>Written</strong>
                  </div>
                  <figcaption>
                    <p>A documented cadence beats ad-hoc calling.</p>
                    <span>When you have a written schedule of calls, emails and SMS, you do not rely on memory — and leads do not go cold.</span>
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
                  <div><b>02</b><strong>One call, then quit</strong><span>Most leads don't answer the first call</span></div>
                  <span className="bw-flow-arrow" aria-hidden>→</span>
                  <div><b>03</b><strong>No system</strong><span>Follow-up becomes a memory test</span></div>
                </div>
                <p className="bw-article-note">One call is not a follow-up strategy — it is a coincidence check. The practical standard is: call within 24 hours, then stay on a cadence.</p>
              </section>

              <section id="system" className="bw-followup-section">
                <div className="bw-section-heading">
                  <span>The follow-up cadence</span>
                  <h2>Three phases: response, qualification, nurture.</h2>
                </div>
                <p>The system assumes you have a CRM and can set up automated emails and SMS. Phone calls are manual. Everything else should be automated.</p>
                <div className="bw-timeline">
                  <div><b>Phase 1</b><span /><section><h3>Response — Day 0 to 14</h3><p>Deliver the resource and establish contact. Call within 24 hours, then follow a 14-day cadence of calls, emails and SMS to reach the lead and start a conversation.</p></section></div>
                  <div><b>Phase 2</b><span /><section><h3>Qualification — Day 15 to 90</h3><p>Understand intent, timing and next action. Move to a 21-day call rotation with weekly emails and ongoing listing alerts. If the lead engages, move them to a tailored cadence.</p></section></div>
                  <div><b>Phase 3</b><span /><section><h3>Permission-based nurture — After day 90</h3><p>Continue useful updates while consent remains valid. Monthly calls, weekly emails and listing alerts. Review and prune regularly. Stop all commercial messages if the lead unsubscribes.</p></section></div>
                </div>
              </section>

              <section id="compliance" className="bw-compliance-section">
                <div className="bw-section-heading">
                  <span>Before you send any SMS or email</span>
                  <h2>Compliance obligations.</h2>
                </div>
                <aside className="bw-compliance-note">
                  <strong>Australian commercial email and SMS rules</strong>
                  <p>Consent, accurate sender identification and a functional unsubscribe mechanism are required. Unsubscribe requests must be honoured within five working days. Only send commercial messages to people who have consented or who fall within the limited exceptions in the Spam Act.</p>
                  <p><strong>Behavioural data</strong> (such as listing views) should be used in a way consistent with the person's reasonable expectations and the agency's privacy notice.</p>
                  <ul>
                    <li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">ACMA — Avoid sending spam</a></li>
                    <li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">OAIC — Direct marketing guidance</a></li>
                  </ul>
                </aside>
              </section>

              <section id="first-call" className="bw-creative-section">
                <div className="bw-section-heading bw-section-heading-split">
                  <span>The first call</span>
                  <h2>Four steps, in this order.</h2>
                  <p>Do not ask multiple questions at once. Let the lead engage at their own pace. Ask timing only after they are talking — not as the opening question.</p>
                </div>
                <div className="bw-list-grid">
                  <div className="bw-list-item"><b>1</b><div><h3>Confirm they got the resource</h3><p>Did they receive the list, the property details, the link? This is a service call, not a sales call.</p><span>Service, not sales</span></div></div>
                  <div className="bw-list-item"><b>2</b><div><h3>Ask what caught their attention</h3><p>If they have looked at the resource, what stood out? This tells you what they care about without asking them to commit.</p><span>Listen for intent</span></div></div>
                  <div className="bw-list-item"><b>3</b><div><h3>Ask what they're trying to achieve</h3><p>What are they looking for? What area? Let them tell you — do not recite their search history.</p><span>Listen, don't observe</span></div></div>
                  <div className="bw-list-item"><b>4</b><div><h3>Ask timing once they engage</h3><p>When are they hoping to move? This is the most important piece of information — but ask it only once they are talking.</p><span>Determines everything that follows</span></div></div>
                </div>
                <div className="bw-copy-specimen">
                  <div className="bw-copy-specimen-labels"><span>First call script</span><span>Copy specimen</span></div>
                  <blockquote>Hi <mark>[name]</mark>, it's <mark>[your name]</mark> from <mark>[agency]</mark>. You recently requested the <mark>[list]</mark> — I just wanted to make sure you got that and see if you had any questions. Was there anything in particular that caught your attention? So I can point you in the right direction — what are you trying to achieve? And what's your timeline?</blockquote>
                  <div className="bw-copy-specimen-foot"><strong>Information, not a pitch</strong><span>Ask timing only after they engage</span></div>
                </div>
              </section>

              <section id="timeline" className="bw-measure-section">
                <div className="bw-section-heading">
                  <span>After the first conversation</span>
                  <h2>Match your cadence to their timeline.</h2>
                </div>
                <div className="bw-measure-table" role="table" aria-label="Timeline-based follow-up intensity">
                  <div role="row" className="bw-measure-head"><span role="columnheader">Timeline</span><span role="columnheader">Call frequency</span><span role="columnheader">Email frequency</span><span role="columnheader">Purpose</span><span role="columnheader">Stop condition</span></div>
                  {[
                    ["0–30 days (hot)", "Once per week", "Weekly + listing alerts", "Set an appointment", "Books or asks you to stop"],
                    ["30–90 days (warm)", "Every 2 weeks", "Weekly + listing alerts", "Identify properties, move toward appointment", "Books, unsubscribes, or asks to stop"],
                    ["3–6 months (nurture)", "Every 3 weeks", "Weekly market email + alerts", "Stay top-of-mind", "Unsubscribes or asks to stop"],
                    ["6–12 months (pipeline)", "Monthly", "Weekly market email + alerts", "Gentle presence", "Unsubscribes or asks to stop"],
                    ["12+ months (long-term)", "Quarterly", "Weekly market email + alerts", "Maintain minimum contact", "Unsubscribes or asks to stop"],
                  ].map(([timeline, callFreq, emailFreq, purpose, stopCondition]) => (
                    <div role="row" key={timeline}>
                      <strong role="cell">{timeline}</strong>
                      <span role="cell">{callFreq}</span>
                      <span role="cell">{emailFreq}</span>
                      <span role="cell">{purpose}</span>
                      <span role="cell">{stopCondition}</span>
                    </div>
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
                <p>A spike in activity is your signal to call: "You recently viewed this property through our site. Would you like the details or inspection times?"</p>
              </section>

              <section id="crm" className="bw-text-section">
                <h2>Track follow-up in your CRM</h2>
                <p>Your CRM is not just a contact database. It is your follow-up scoreboard. Track these fields for every lead:</p>
                <div className="bw-contrast-row">
                  <div><span>Essential fields</span><strong>Source, date registered, call attempts, last contact, timeline, status, consent status, unsubscribe date</strong></div>
                  <div><span>Review weekly</span><strong>20 leads in "attempting" and zero in "contacted" = cadence not working</strong></div>
                </div>
                <aside className="bw-compliance-note">
                  <strong>The CRM automation layer</strong>
                  <p>Set up an automated nurture sequence that continues while consent remains valid. Review and prune the sequence regularly — a three-year automated flow that no one has reviewed in three years is a compliance risk, not a strategy. Include property alerts, a weekly email, a monthly market report, and interspersed SMS touches — only to leads who have consented.</p>
                </aside>
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
                <details><summary>How many times should I call a lead before giving up?</summary><p>Do not give up after a fixed number. Follow the 14-day response cadence (roughly 4–5 call attempts), then move to a 21-day rotation through the qualification phase (day 15 to 90), then to a longer nurture cadence after day 90. A lead who has not engaged in an extended period should be reviewed — if they have unsubscribed, stop all commercial messages.</p></details>
                <details><summary>Should I use SMS or email for automated follow-up?</summary><p>Both, but only with consent. SMS has higher open rates but lower tolerance for frequency. Email allows longer content and listing alerts. Use SMS for short check-ins (no more than once per week) and email for property alerts, market updates and newsletters. Ensure every message includes a functional unsubscribe mechanism, and honour unsubscribe requests within five working days.</p></details>
                <details><summary>What if I do not have a CRM?</summary><p>Get one. Most brokerages provide a free CRM. If your brokerage does not, Follow Up Boss, Lofty and Real Geeks all offer affordable plans. Without a CRM, you cannot run a systematic follow-up cadence.</p></details>
                <details><summary>Should I hire an ISA to handle calls?</summary><p>If your lead volume exceeds what you can call personally within 24 hours, an ISA is the next step. The system works whether the caller is you or a trained ISA. The key is that someone calls within 24 hours and stays on the cadence.</p></details>
                <details><summary>Does this work for both Facebook and Google leads?</summary><p>Yes. The cadence is platform-agnostic. Google leads tend to be higher-intent, so they may engage faster. Facebook leads tend to be earlier in the process, so the nurture phase may run longer. The system handles both.</p></details>
                <details><summary>What are my compliance obligations for SMS and email follow-up?</summary><p>Australian commercial email and SMS rules require consent, accurate sender identification and a functional unsubscribe mechanism. Unsubscribe requests must be honoured within five working days. Only send commercial messages to people who have consented or who fall within the limited exceptions in the Spam Act. See the <a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">ACMA guidance on avoiding spam</a> and the <a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">OAIC direct marketing guidance</a>.</p></details>
              </section>

              <footer className="bw-article-sources">
                <h2>Sources and further reading</h2>
                <ol>
                  <li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Avoid sending spam, ACMA</a> <span className="bw-source-claim">— supports consent, sender ID and unsubscribe requirements</span></li>
                  <li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">Direct marketing guidance, OAIC</a> <span className="bw-source-claim">— supports direct marketing and privacy obligations</span></li>
                  <li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a> <span className="bw-source-claim">— supports lead delivery setup</span></li>
                  <li><a href="https://www.facebook.com/business/ads/meta-advantage-plus/leads" target="_blank" rel="noreferrer">Advantage+ leads campaigns, Meta for Business</a> <span className="bw-source-claim">— supports Meta lead campaign context</span></li>
                  <li><a href="https://support.google.com/google-ads/answer/6343147" target="_blank" rel="noreferrer">Google Ads for real estate, Google Ads Help</a> <span className="bw-source-claim">— supports Google Ads lead context</span></li>
                </ol>
                <p className="bw-last-reviewed">Last reviewed: 24 July 2026</p>
              </footer>

              <nav className="bw-guide-nav" aria-label="More guides">
                <Link href="/guides/sold-price-list-seller-leads" className="bw-guide-nav-link">
                  <span>Related guide</span>
                  <strong>How to win seller leads with a suburb sold-price list</strong>
                </Link>
                <Link href="/guides/custom-list-facebook-ad-buyer-leads" className="bw-guide-nav-link">
                  <span>Related guide</span>
                  <strong>How to generate buyer enquiries with a tightly filtered property list</strong>
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
