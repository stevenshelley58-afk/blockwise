import type { Metadata } from "next";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuideCopyBlock } from "@/components/guides/guide-copy-block";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "Stop showing every homeowner the same appraisal ad";
const description = "Build a practical seller offer ladder that gives curious, considering and ready-to-talk homeowners a useful next step.";
const canonical = "/guides/seller-offer-ladder-real-estate-ads";
const evidenceEmail = `Subject: Your Como sales list

Hi [first name],
Here is the source-noted sales list you requested: [link]. It covers [period and property type], updated [date]. It is market context, not a valuation of your home. Reply if you want help comparing a result. Receiving this list does not sign you up for recurring updates.

[name] | [agency] | [contact details] | [privacy link]`;
const appraisalConfirmation = `Hi [first name], thanks for requesting a property conversation with [agency]. Is [date/time] suitable for a call from [number]? We will discuss your questions, preparation, timing and comparable evidence. There is no obligation to list. Reply to change the time or cancel. [agent]`;
const marketingConsent = "Optional: Yes, email me occasional Como market updates from [Agency]. This is separate from my resource or appointment request. I can unsubscribe at any time.";
const campaignBrief = `Seller offer ladder campaign brief

Market: [service area]
Audience: homeowners reachable under the current Special Ad Category: Housing rules
Primary outcome: [qualified seller definition]

Offer 1 — local evidence
Hook: What did [property type] homes in [suburb] sell for this quarter?
Form: full name, email, ownership question, express follow-up consent
Follow-up: send: “Here is the source-noted sales list you requested. Was there a particular result or property type you were comparing?”

Offer 2 — appraisal
Hook: Planning to sell [property type] in [suburb]? Request a property conversation.
Form: full name, email, phone, address, preferred contact time, consent
Follow-up: send: “We will cover preparation, timing and comparable evidence; there is no obligation to list. Is [time] still suitable?”

Prerequisites
- Verify every local sale example and permission to publish it.
- Confirm account country and current markets before choosing geographic settings.
- Select Special Ad Category: Housing where required.
- Write the thank-you page, owner assignment and follow-up before launch.
- Start with a budget you can review for lead quality, not a universal promise.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: { type: "article", title, description, url: canonical, images: [{ url: "/guides/og-guides-index.webp", alt: "Blockwise real estate advertising guides" }] },
  twitter: { card: "summary_large_image", title, description, images: ["/guides/og-guides-index.webp"] },
};

const articleSchema = { "@context": "https://schema.org", "@type": "Article", headline: title, description, datePublished: "2026-07-24", dateModified: "2026-09-07", author: { "@type": "Organization", name: "Blockwise" }, publisher: { "@type": "Organization", name: "Blockwise", url: "https://blockwise.sale" }, mainEntityOfPage: `https://blockwise.sale${canonical}` };
const faq = [
  ["Should I stop running appraisal ads entirely?", "No. Keep the appraisal for active sellers; make it one entry point alongside lower-commitment evidence and education offers."],
  ["How many offers should I start with?", "Start with two complete offers: a local-evidence download and an appraisal invitation. Add another only when its form, follow-up and review owner are ready."],
  ["Will lower-commitment offers attract unqualified people?", "Some will. That is a known trade-off. Use one useful qualifying question, then judge the offer by contactable and progressing leads rather than raw form volume."],
  ["Do people move through the offers in order?", "Not necessarily. The offers are entry points, not a guaranteed sequence. Keep geography, consent and follow-up clear at every stage."],
];
const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) };

export default function SellerOfferLadderGuidePage() {
  return <GuidesShell><ArticleProgress /><main id="main-content"><article className="bw-article">
    <header className="bw-article-hero"><div className="bw-article-hero-copy"><div className="bw-article-breadcrumbs"><Link href="/guides">Guides</Link><span aria-hidden>/</span><span>Offer strategy</span></div><p className="bw-guides-label">The offer ladder guide</p><h1>{title}</h1><p className="bw-article-deck">A direct appraisal is a sensible offer for an active seller, but it is a large first step for someone still researching. Give each homeowner a useful choice.</p><div className="bw-article-byline"><span>By Blockwise</span><span>7 September 2026</span><span>6 minute read</span></div></div><div className="bw-article-hero-media" aria-label="Two offer entry points: local evidence and appraisal"><span>Local evidence</span><span aria-hidden="true">→</span><span>Conversation</span><span aria-hidden="true">→</span><span>Appraisal</span></div></header>
    <div className="bw-article-body"><aside className="bw-article-toc" aria-label="On this page"><strong>On this page</strong><a href="#gap">The commitment gap</a><a href="#offers">Two complete offers</a><a href="#forms">Forms and follow-up</a><a href="#budget">A conservative test</a><a href="#staging">Staging checklist</a></aside>
    <div className="bw-article-prose">
      <section className="bw-opening" id="gap"><p className="bw-drop-intro"><span>The appraisal is not a bad offer.</span> It is simply a high-commitment first step. A homeowner checking recent sales may not be ready to share an address, answer a sales call or discuss a move. A ladder gives that person a credible way to learn while keeping the appraisal available for people who are ready.</p><div className="bw-contrast-row"><div><span>High commitment</span><strong>“Request an appraisal” can imply a visit and sales conversation.</strong></div><div><span>Lower commitment</span><strong>“See recent comparable sales” asks for information first.</strong></div></div><aside className="bw-compliance-note"><strong>Housing and geography</strong><p>Meta’s published restrictions cover US-based advertisers and housing ads reaching the US, Canada or Europe. An Australian business advertising only in Australia is not automatically subject to those same audience restrictions; verify the current account controls and markets reached. Australia is not a universal radius-or-location rule. Check account country and current markets before launch, and apply nondiscrimination principles throughout.</p><a href="https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/" target="_blank" rel="noreferrer">Read Meta’s housing guidance →</a></aside></section>
      <section id="offers" className="bw-text-section"><div className="bw-section-heading"><span>Start with two</span><h2>Complete offers beat four unfinished ideas.</h2></div><p>Use two deliberately different hypotheses: one helps a curious owner understand the local market; the other invites an active seller to speak with you. They can run in the same service area, with different forms and follow-up.</p><div className="bw-copy-specimen"><div className="bw-copy-specimen-labels"><span>Finished ad 01 · local evidence</span><span>Illustrative copy</span></div><h3>What did three-bedroom Como homes sell for this quarter?</h3><p>See three recent comparable sales, with sale dates, property type and source notes. No valuation is implied.</p><p><strong>CTA:</strong> Get the local sales list</p><p><strong>Form:</strong> Full name · email · “Do you own a home of this type in Como?” · express consent for the promised follow-up</p></div><div className="bw-copy-specimen"><div className="bw-copy-specimen-labels"><span>Finished ad 02 · appraisal</span><span>Illustrative copy</span></div><h3>Planning to sell your Como home this year?</h3><p>Talk through likely preparation, timing and comparable evidence with an agent. The conversation is not a promise to list.</p><p><strong>CTA:</strong> Request a property conversation</p><p><strong>Form:</strong> Full name · email · phone · property address · preferred contact time · consent</p></div><p>These are illustrative ads, not a guaranteed sequence or universal template. Replace every local claim with evidence you can verify and use.</p></section>
      <section id="forms" className="bw-text-section"><div className="bw-section-heading"><span>Make the hand-off match</span><h2>Ask only for what the next step needs.</h2></div><div className="bw-measure-table" role="table" aria-label="Offer forms and follow-up"><div role="row" className="bw-measure-head"><span role="columnheader">Offer</span><span role="columnheader">Fields</span><span role="columnheader">First follow-up</span></div><div role="row"><strong role="cell">Local evidence</strong><span role="cell">Name, email, ownership question, consent</span><span role="cell">“Here is the source-noted sales list you requested. Was there a particular result or property type you were comparing?”</span></div><div role="row"><strong role="cell">Appraisal</strong><span role="cell">Name, email, phone, address, preferred time, consent</span><span role="cell">“Thanks for requesting a property conversation. We will cover preparation, timing and comparable evidence; there is no obligation to list. Is [time] still suitable?”</span></div></div><GuideCopyBlock title="Local-evidence delivery email" text={evidenceEmail} /><GuideCopyBlock title="Appraisal confirmation" text={appraisalConfirmation} /><GuideCopyBlock title="Separate recurring-email permission" text={marketingConsent} /><p>Do not promise monthly messages unless the person consented to them. Include a privacy notice, sender identity and unsubscribe path appropriate to your market.</p><p>For the flagship evidence-led version, read <Link href="/guides/sold-price-list-seller-leads">How to use a sold-price list to earn seller leads</Link>.</p></section>
      <section id="budget" className="bw-measure-section"><div className="bw-section-heading"><span>Hypothetical planning example</span><h2>Allocate for learning, not a magic ratio.</h2></div><p>Suppose you can spend A$600 over 14 days. One conservative starting hypothesis is A$360 toward the local-evidence offer and A$240 toward the appraisal. That is a decision based on the stage you want to learn about, not a universal allocation.</p><div className="bw-measure-table" role="table" aria-label="Hypothetical offer budget allocation"><div role="row" className="bw-measure-head"><span role="columnheader">Offer</span><span role="columnheader">Hypothetical spend</span><span role="columnheader">Review</span></div><div role="row"><strong role="cell">Local evidence</strong><span role="cell">A$360</span><span role="cell">Delivery, contactability, useful conversations</span></div><div role="row"><strong role="cell">Appraisal</strong><span role="cell">A$240</span><span role="cell">Appointment requests, contact rate, fit</span></div></div><p>Do not call this a “winning” split before delivery. Review enough impressions and leads to make a fair comparison, then change one decision at a time.</p></section>
      <section id="staging" className="bw-followup-section"><div className="bw-section-heading"><span>Before you publish</span><h2>Stage the work in this order.</h2></div><ol><li>Verify the local sales evidence and legal permission to publish it.</li><li>Write both finished ads, their exact forms and their first follow-up message.</li><li>Confirm account country, reachable markets, housing-category requirements and nondiscrimination checks.</li><li>Assign a person to review leads and record outcomes in the CRM.</li><li>Choose a sustainable test budget and a review date; do not promise a listing result.</li></ol><GuideCopyBlock title="Copy the campaign brief" text={`${campaignBrief}

DELIVERY EMAIL
${evidenceEmail}

APPOINTMENT CONFIRMATION
${appraisalConfirmation}

OPTIONAL MARKETING CONSENT
${marketingConsent}`} /><p><a href="/guides/resources/seller-offer-ladder-real-estate-ads/campaign-brief.txt" download>Download campaign-brief.txt</a></p></section>
      <section className="bw-blockwise-cta"><div><span>Where Blockwise fits</span><h2>Keep the offer, form and review path together.</h2><p>Blockwise can help prepare editable creative, the Meta campaign and lead-form copy. Meta approval, publishing and any external CRM connection remain gated steps outside the guide.</p></div><Link href="/signup">Prepare the campaign <span aria-hidden="true">→</span></Link></section>
      <section className="bw-faq-section"><div className="bw-section-heading"><span>Questions</span><h2>The practical details.</h2></div>{faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
      <footer className="bw-article-sources"><h2>Sources and further reading</h2><ol><li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li><li><a href="https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/" target="_blank" rel="noreferrer">Special Ad Category, Meta for Developers</a></li><li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">Direct marketing, OAIC</a></li><li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">Avoid sending spam, ACMA</a></li></ol></footer>
    </div></div>
  </article></main><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} /></GuidesShell>;
}
