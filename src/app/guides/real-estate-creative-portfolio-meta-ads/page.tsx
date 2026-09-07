import type { Metadata } from "next";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuideCopyBlock } from "@/components/guides/guide-copy-block";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "Build a real estate ad portfolio around seller decisions";
const description = "A practical way to test distinct real estate ad hypotheses for different homeowner situations, with clear proof, offers and review measures.";
const canonical = "/guides/real-estate-creative-portfolio-meta-ads";
const carouselCopy = `Card 1 — What needs attention before photos?
Start with presentation: light, clutter and the condition buyers will see. Ask which work is necessary before committing to a renovation.

Card 2 — What is worth the cost?
Compare the quote, disruption and selling timeframe. A renovation is a cost, not a guaranteed price uplift.

Card 3 — Compare your options.
An as-is sale and a prepared sale involve different trade-offs. Get our pre-sale decision guide before choosing. [Agency] | Get the guide.`;
const videoCopy = `Before a property conversation, we ask what you are weighing and when. We review comparable evidence and explain what we can—and cannot—say from it. You choose the next step: a question, a follow-up call or no further action. There is no obligation to list. See what to expect.`;
const brief = `Creative portfolio brief

Composite campaign: Como seller research (illustrative only)
Market: [verified service area]

For each concept record:
- homeowner problem and audience self-selection
- evidence or proof that you have permission to use
- one offer and one CTA
- format and review measure

Concept 1 — local evidence
Hook: What did three-bedroom Como homes sell for this quarter?
Proof: three verified sale examples with dates and property type
Offer: source-noted sales list
CTA: Get the local sales list
Measure: contactable leads and evidence-download completion

Concept 2 — seller decision
Hook: Renovate before selling, or leave it alone?
Proof: documented preparation checklist; no promised uplift
Offer: pre-sale decision guide
CTA: Get the guide
Measure: qualified conversations

Concept 3 — process clarity
Hook: What happens in a first property conversation?
Proof: your actual process, reviewed by the team
Offer: 15-minute conversation
CTA: See what to expect
Measure: completed conversations and follow-up quality

Production checks
- Verify local claims, rights and consent.
- Keep Housing category and current geographic requirements visible.
- Review spend, impressions, contactability and downstream quality together.
- Pause or revise a concept only after enough delivery to form a fair hypothesis.`;

export const metadata: Metadata = { title, description, alternates: { canonical }, openGraph: { type: "article", title, description, url: canonical, images: [{ url: "/guides/og-guides-index.webp", alt: "Blockwise real estate advertising guides" }] }, twitter: { card: "summary_large_image", title, description, images: ["/guides/og-guides-index.webp"] } };
const articleSchema = { "@context": "https://schema.org", "@type": "Article", headline: title, description, datePublished: "2026-07-24", dateModified: "2026-09-07", author: { "@type": "Organization", name: "Blockwise" }, publisher: { "@type": "Organization", name: "Blockwise", url: "https://blockwise.sale" }, mainEntityOfPage: `https://blockwise.sale${canonical}` };
const faq = [
  ["How many ads should I run at once?", "Use the number your budget can support and your team can review. Start with a small set of genuinely different hypotheses, not a mandatory count. A portfolio is useful only when each concept receives enough delivery and follow-up to learn from."],
  ["Do I need professional video production?", "No. Choose the format that carries the message: a clear static card for one fact, a carousel for a sequence, or a phone-shot video for a real explanation. Production polish is not proof."],
  ["Can I use a sold price in the ad?", "Only when the example is accurate and you have permission to publish it. Label the source and do not present a comparable sale as a valuation."],
  ["How do I choose my first concepts?", "Start with a local-evidence concept and a direct-response concept. Add a seller-problem or process concept when its proof, form and follow-up are ready."],
];
const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) };

export default function CreativePortfolioGuidePage() {
  return <GuidesShell><ArticleProgress /><main id="main-content"><article className="bw-article">
    <header className="bw-article-hero"><div className="bw-article-hero-copy"><div className="bw-article-breadcrumbs"><Link href="/guides">Guides</Link><span aria-hidden>/</span><span>Creative strategy</span></div><p className="bw-guides-label">The portfolio guide</p><h1>{title}</h1><p className="bw-article-deck">A suburb is a place, not a motivation. Give the delivery system a few specific, evidence-led reasons for a homeowner to stop, read and act.</p><div className="bw-article-byline"><span>By Blockwise</span><span>7 September 2026</span><span>6 minute read</span></div></div><div className="bw-article-hero-media" aria-label="Three finished ad concepts: evidence, seller problem and process clarity"><span>Evidence</span><span>Seller problem</span><span>Process clarity</span></div></header>
    <div className="bw-article-body"><aside className="bw-article-toc" aria-label="On this page"><strong>On this page</strong><a href="#principle">The portfolio principle</a><a href="#specimens">Three finished specimens</a><a href="#annotations">How to annotate each ad</a><a href="#formats">Choose the format</a><a href="#review">Review the hypothesis</a></aside><div className="bw-article-prose">
      <section className="bw-opening" id="principle"><p className="bw-drop-intro"><span>One hero ad cannot express every seller situation.</span> A curious owner checking the market needs a different reason to stop than an active seller comparing agents. Build a manageable portfolio of distinct arguments, each with a proof placeholder you can verify, a single offer and a review measure.</p><div className="bw-contrast-row"><div><span>Not a portfolio</span><strong>Three appraisal ads with different colours and near-identical copy.</strong></div><div><span>Portfolio</span><strong>Evidence, seller problem and process clarity with different next steps.</strong></div></div><aside className="bw-compliance-note"><strong>Housing and geography</strong><p>Meta’s published restrictions cover US-based advertisers and housing ads reaching the US, Canada or Europe. An Australian business advertising only in Australia is not automatically subject to those same audience restrictions; verify the current account controls and markets reached. Australia is not a universal radius rule. Check account country and current markets, verify your reachable service area and keep nondiscrimination checks in the production brief.</p><a href="https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/" target="_blank" rel="noreferrer">Read Meta’s housing guidance →</a></aside></section>
      <section id="specimens" className="bw-measure-section"><div className="bw-section-heading"><span>Fictional/composite campaign</span><h2>Three finished ads you can inspect.</h2><p>These Como examples are illustrative, not a real performed case. Replace the proof placeholders with evidence you have permission to use.</p></div><div className="bw-copy-specimen"><div className="bw-copy-specimen-labels"><span>Ad 01 · market evidence · static</span><span>Illustrative</span></div><h3>What did three-bedroom Como homes sell for this quarter?</h3><p>Three recent comparable sales, shown with sale date, property type and source note. This is research, not a valuation.</p><p><strong>Audience problem:</strong> curious owner checking the market<br /><strong>Verified proof placeholder:</strong> [three approved sale records]<br /><strong>Offer:</strong> source-noted sales list<br /><strong>CTA:</strong> Get the local sales list<br /><strong>Success measure:</strong> contactable lead and guide completion</p></div><div className="bw-copy-specimen"><div className="bw-copy-specimen-labels"><span>Ad 02 · seller problem · carousel</span><span>Illustrative</span></div><h3>Renovate before selling, or leave it alone?</h3><GuideCopyBlock title="Three-card carousel copy" text={carouselCopy} /><p><strong>Audience problem:</strong> owner weighing preparation against an as-is sale<br /><strong>Verified proof placeholder:</strong> [approved checklist and local examples]<br /><strong>Offer:</strong> pre-sale decision guide<br /><strong>CTA:</strong> Get the guide<br /><strong>Success measure:</strong> qualified conversations against the written criteria</p></div><div className="bw-copy-specimen"><div className="bw-copy-specimen-labels"><span>Ad 03 · process clarity · short video</span><span>Illustrative</span></div><h3>What happens in a first property conversation?</h3><GuideCopyBlock title="30-second video script" text={videoCopy} /><p><strong>Audience problem:</strong> active seller worried about a pressured appointment<br /><strong>Verified proof placeholder:</strong> [your actual reviewed process]<br /><strong>Offer:</strong> 15-minute property conversation<br /><strong>CTA:</strong> See what to expect<br /><strong>Success measure:</strong> completed conversations and follow-up quality</p></div></section>
      <section id="annotations" className="bw-text-section"><div className="bw-section-heading"><span>Make each decision visible</span><h2>Annotate the work before you publish.</h2></div><p>For every concept, write the homeowner problem, evidence source, offer, CTA, format and the one downstream measure that would change your decision. That record prevents “creative variety” from becoming decoration.</p><div className="bw-measure-table" role="table" aria-label="Creative annotation checklist"><div role="row" className="bw-measure-head"><span role="columnheader">Field</span><span role="columnheader">Question</span></div><div role="row"><strong role="cell">Audience problem</strong><span role="cell">What situation should make the right homeowner recognise themselves?</span></div><div role="row"><strong role="cell">Proof</strong><span role="cell">What can you verify and legally use?</span></div><div role="row"><strong role="cell">Offer and CTA</strong><span role="cell">What single next step does this ad promise?</span></div><div role="row"><strong role="cell">Success measure</strong><span role="cell">Which quality or progression signal will you review?</span></div></div></section>
      <section id="formats" className="bw-text-section"><div className="bw-section-heading"><span>Format selection</span><h2>Let the message choose the format.</h2></div><div className="bw-measure-table" role="table" aria-label="Creative formats"><div role="row" className="bw-measure-head"><span role="columnheader">Format</span><span role="columnheader">Useful when</span><span role="columnheader">Example</span></div><div role="row"><strong role="cell">Static</strong><span role="cell">One fact or one offer needs a fast read</span><span role="cell">Three verified sales with dates</span></div><div role="row"><strong role="cell">Carousel</strong><span role="cell">The explanation has a clear sequence</span><span role="cell">Preparation decisions, one per card</span></div><div role="row"><strong role="cell">Short video</strong><span role="cell">The agent’s explanation reduces uncertainty</span><span role="cell">What happens in a first conversation</span></div></div></section>
      <section id="review" className="bw-followup-section"><div className="bw-section-heading"><span>Review the hypothesis</span><h2>Spend enough to learn, then decide.</h2></div><p>Track spend, impressions, lead contactability and quality together. A low cost per lead is not proof of a useful concept; a low impression count is not proof that it failed. Set a review date and a minimum evidence threshold appropriate to your budget, then pause, revise or extend one hypothesis at a time.</p><ol><li>Confirm rights, sources, Special Ad Category and current geographic requirements.</li><li>Check that each ad has one offer, one CTA and a ready follow-up path.</li><li>Review delivery and downstream quality at the same time.</li><li>Record what changed and what you learned; do not invent a result.</li></ol><GuideCopyBlock title="Copy the creative brief and production checklist" text={`${brief}

CAROUSEL COPY
${carouselCopy}

VIDEO SCRIPT
${videoCopy}`} /><p><a href="/guides/resources/real-estate-creative-portfolio-meta-ads/creative-brief.txt" download>Download creative-brief.txt</a></p></section>
      <section className="bw-blockwise-cta"><div><span>Where Blockwise fits</span><h2>Turn distinct propositions into reviewable creative.</h2><p>Blockwise can help prepare editable creative and campaign materials. You still supply local evidence, approvals and any real client proof; Meta publishing remains a gated step.</p></div><Link href="/signup">Prepare the portfolio <span aria-hidden="true">→</span></Link></section>
      <section className="bw-faq-section"><div className="bw-section-heading"><span>Questions</span><h2>The practical details.</h2></div>{faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
      <footer className="bw-article-sources"><h2>Sources and further reading</h2><ol><li><a href="https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/" target="_blank" rel="noreferrer">Meta Andromeda, Meta Engineering</a></li><li><a href="https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/" target="_blank" rel="noreferrer">Special Ad Category, Meta for Developers</a></li><li><a href="https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms" target="_blank" rel="noreferrer">Lead ads with forms, Meta for Business</a></li></ol></footer>
    </div></div>
  </article></main><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} /></GuidesShell>;
}
