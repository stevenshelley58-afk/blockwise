import type { Metadata } from "next";
import Link from "next/link";

import { ArticleProgress } from "@/components/guides/article-progress";
import { GuideCopyBlock } from "@/components/guides/guide-copy-block";
import { GuidesShell } from "@/components/guides/guides-shell";

import "../guides.css";

const title = "A practical 14-day follow-up cadence for real estate leads";
const description = "Use a documented call, email and SMS cadence for the first 14 days, branch on the person’s response, and keep consent and suppression records.";
const canonical = "/guides/lead-follow-up-playbook";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: { type: "article", title, description, url: canonical },
  twitter: { card: "summary", title, description },
};

const articleSchema = { "@context": "https://schema.org", "@type": "Article", headline: title, description, datePublished: "2026-07-24", dateModified: "2026-09-07", author: { "@type": "Organization", name: "Blockwise" }, publisher: { "@type": "Organization", name: "Blockwise", url: "https://blockwise.sale" }, mainEntityOfPage: `https://blockwise.sale${canonical}` };

const faqItems = [
  ["How many times should I contact someone who does not answer?", "Use the light 14-day resource cadence only where the channel is permitted and the person has not opted out. Ask before adding another channel; there is no universal attempt count."],
  ["Can I send SMS or email after someone requests a list?", "Only where the request and your consent record cover that message. Identify the sender, provide a working unsubscribe method and honour an unsubscribe request within five working days. A request for a resource is not automatic consent to every future marketing channel."],
  ["What is different about telephone follow-up?", "Phone calls have separate obligations, including checking the Do Not Call Register where relevant, having consent or another lawful basis, calling only in allowed hours, showing caller ID and ending immediately when asked. ACMA guidance applies; a service call is not an automatic exemption."],
  ["What should I do after a reply or appointment?", "Pause the generic cadence, answer the question, record the person’s preference and agree the next step. Suppress commercial messages when they refuse, unsubscribe or ask you to stop."],
];

const cadence: Array<[string, string, string, string]> = [
  ["Day 0", "Email", "Resource requested; email permitted", "Deliver the resource and identify the sender."],
  ["Day 1", "No send", "Review", "Check delivery, replies, consent and channel preference."],
  ["Day 2", "Call", "Phone requested or permitted; allowed hour", "One service-led check. If not requested, do not add a phone call."],
  ["Day 3", "No send", "No reply", "Wait. Do not add another channel."],
  ["Day 4", "No send", "No reply", "Wait. Record a bounce or suppression."],
  ["Day 5", "No send", "Review", "If the person asks for a call or SMS, agree timing and channel first."],
  ["Day 6", "No send", "No reply", "Wait."],
  ["Day 7", "Email or SMS", "One preferred channel, with consent", "One helpful follow-up; include opt-out for commercial electronic messages."],
  ["Day 8", "No send", "No reply", "Wait."],
  ["Day 9", "No send", "No reply", "Wait."],
  ["Day 10", "No send", "No reply", "Do not infer intent from a click or view."],
  ["Day 11", "No send", "No reply", "Wait."],
  ["Day 12", "No send", "Review", "Remove refusals and update suppression."],
  ["Day 13", "No send", "No reply", "Wait."],
  ["Day 14", "Review", "All", "Agree a next step with engaged people; otherwise pause."],
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })),
};

export default function FollowUpPlaybookGuidePage() {
  return (
    <GuidesShell>
      <ArticleProgress />
      <main id="main-content">
        <article className="bw-article">
          <header className="bw-article-hero"><div className="bw-article-hero-copy"><div className="bw-article-breadcrumbs"><Link href="/guides">Guides</Link><span aria-hidden>/</span><span>Lead conversion</span></div><p className="bw-guides-label">The first 14 days</p><h1>{title}</h1><p className="bw-article-deck">{description}</p><div className="bw-article-byline"><span>Blockwise</span><span>Updated 7 September 2026</span><span>7 minute read</span></div></div></header>
          <div className="bw-article-at-glance"><h2>At a glance</h2><dl><div><dt>Default</dt><dd>Three-touch resource cadence for a silent, low-intent lead</dd></div><div><dt>Branches</dt><dd>Reply, no answer, appointment, refusal or unsubscribe</dd></div><div><dt>Phone</dt><dd>DNCR, consent, allowed hours, caller ID and immediate stop</dd></div><div><dt>Electronic messages</dt><dd>Sender identification and unsubscribe within 5 working days</dd></div><div><dt>After day 14</dt><dd>Pause or agree a permission-based next step; no default long nurture</dd></div></dl></div>
          <div className="bw-article-body"><aside className="bw-article-toc" aria-label="On this page"><strong>On this page</strong><a href="#principles">Principles</a><a href="#cadence">14-day cadence</a><a href="#messages">Reusable messages</a><a href="#branches">Branches</a><a href="#telephone">Telephone rules</a><a href="#electronic">Email and SMS rules</a></aside><div className="bw-article-prose">
            <section id="principles" className="bw-opening"><p className="bw-drop-intro"><span>Follow up as a service, not a chase.</span> Deliver what the person requested, make one clear next step available and record their preference. A click or one form submission does not prove urgency or shorten a selling timeline.</p><p>The default for a silent, low-intent resource downloader is light: delivery email, one permitted check and one preferred-channel follow-up. If the person actively asks for a call or appointment, negotiate the time and channel; do not expand into an all-channel sequence automatically.</p><p>Use a contact record or spreadsheet with source, timestamp, resource, channels permitted, preference, attempts, replies, next step and suppression date. Limit access to authorised staff.</p></section>
            <section id="cadence" className="bw-followup-section"><div className="bw-section-heading"><span>Day by day</span><h2>A light first-14-day cadence.</h2><p>“If consented” means your record covers that channel and message. “Allowed hour” means check the current Australian rules and your agency policy before calling. Day 7 is one channel, not both.</p></div><div className="bw-measure-table" role="table" aria-label="Fourteen day follow-up cadence"><div role="row" className="bw-measure-head"><span role="columnheader">Day</span><span role="columnheader">Channel</span><span role="columnheader">Condition</span><span role="columnheader">Purpose</span></div>{cadence.map(([day, channel, condition, purpose]) => <div role="row" key={`${day}-${channel}`}><strong role="cell">{day}</strong><span role="cell">{channel}</span><span role="cell">{condition}</span><span role="cell">{purpose}</span></div>)}</div><a href="/guides/resources/lead-follow-up-playbook/14-day-cadence.csv" download>Download the 14-day cadence CSV</a></section>
            <section id="messages" className="bw-creative-section"><div className="bw-section-heading"><span>Copy specimens</span><h2>Say what happened and what happens next.</h2></div><GuideCopyBlock title="Delivery email" text={`Subject: Your [resource] from [agency]

Hi [first name],

Here is the [resource] you requested: [link]. It covers [scope] and was updated [date]. Reply with a question. If you opted into updates, unsubscribe here: [link].

Regards,
[name] | [agency] | [phone] | [privacy link]`}/><GuideCopyBlock title="First SMS (only when consent and preference permit)" text="Hi [first name], [agent] from [agency] here. Your [resource] is here: [link]. Reply with a question. Reply STOP to unsubscribe."/><GuideCopyBlock title="Reply email" text={`Subject: Re: [their question]

Hi [first name],

Thanks for replying. [Answer the question in plain language.] If a call would help, tell me a suitable time. If you would prefer no further messages, reply unsubscribe and I will update our records.

Regards,
[name] | [agency] | [phone]`}/><GuideCopyBlock title="Voicemail" text="Hi [first name], it’s [name] from [agency]. You requested [resource], and I’m checking that the link worked. Call [number] if a question comes up. I won’t keep calling if you prefer no further contact."/><GuideCopyBlock title="Appointment confirmation" text="Hi [first name], confirming our [date/time] appointment about [purpose]. I’ll call from [number]. Reply if you need to change it."/><GuideCopyBlock title="Refusal or suppression response" text="Thanks for letting me know. I have recorded that you do not want further commercial messages from [agency]. We will not continue this sequence."/><a href="/guides/resources/lead-follow-up-playbook/message-specimens.txt" download>Download the message specimens</a></section>
            <section id="branches" className="bw-list-section"><div className="bw-section-heading"><span>Branch immediately</span><h2>Five outcomes, five next actions.</h2></div><div className="bw-list-grid"><div className="bw-list-item"><b>Reply</b><div><h3>Answer the question</h3><p>Pause the generic cadence, respond in the same channel where practical and record the agreed next step.</p><span>Do not resume automatically</span></div></div><div className="bw-list-item"><b>None</b><div><h3>No answer</h3><p>Make only the next light, permitted touch. If there is still no reply, pause rather than adding channels.</p><span>Respect preference</span></div></div><div className="bw-list-item"><b>Meet</b><div><h3>Appointment booked</h3><p>Confirm time, purpose and any preparation. Suppress generic reminders once the appointment is set.</p><span>Human agreement wins</span></div></div><div className="bw-list-item"><b>No</b><div><h3>Refusal</h3><p>Thank them, mark “do not contact” for the requested channels and stop the sequence.</p><span>Suppress promptly</span></div></div><div className="bw-list-item"><b>STOP</b><div><h3>Unsubscribe</h3><p>Stop commercial electronic messages and update suppression records. Do not send a confirmation that itself markets.</p><span>Honour within five working days</span></div></div></div></section>
            <section id="telephone" className="bw-compliance-section"><div className="bw-section-heading"><span>Phone is its own channel</span><h2>Check the rules before dialling.</h2></div><aside className="bw-compliance-note"><strong>Australian telephone checklist</strong><ul><li>Check the <a href="https://www.donotcall.gov.au/" target="_blank" rel="noreferrer">Do Not Call Register</a> where relevant and keep evidence of the check.</li><li>Have consent or another lawful basis covering the purpose; a resource request is not an automatic exemption.</li><li>Call only Monday–Friday 9 am–8 pm and Saturday 9 am–5 pm in the recipient’s local time where those ordinary telemarketing hours apply; do not call Sunday or national public holidays. Check current ACMA guidance and any narrower rule that applies.</li><li>Display caller ID and identify yourself, the agency and the purpose at the start.</li><li>End the call immediately when asked, and record suppression so another person does not call.</li></ul><p>See <a href="https://www.acma.gov.au/say-no-to-telemarketers" target="_blank" rel="noreferrer">ACMA: Say no to telemarketers</a>. This is general guidance, not legal certification.</p></aside></section>
            <section id="electronic" className="bw-compliance-section"><div className="bw-section-heading"><span>Email and SMS are different</span><h2>Consent, identification and opt-out.</h2></div><aside className="bw-compliance-note"><p>Commercial email and SMS require consent unless a narrow exception applies. Identify the sender, provide a functional unsubscribe facility and honour an unsubscribe request within five working days. Keep evidence of wording, source, timestamp, channel and suppression.</p><p>These rules are separate from telephone rules. The Spam Act does not turn a phone service call into blanket permission for SMS or email.</p><ul><li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">ACMA: Avoid sending spam</a></li><li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">OAIC: Direct marketing</a></li></ul></aside></section>
            <section className="bw-text-section"><h2>After day 14</h2><p>Do not default to weekly email for a year. If the person engaged, agree a useful next step and frequency. If they did not engage, record the preference and pause. Resume only with a permitted, relevant reason and consent that still covers the channel.</p></section>
            <section className="bw-faq-section"><div className="bw-section-heading"><span>Questions</span><h2>The practical details.</h2></div>{faqItems.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
            <footer className="bw-article-sources"><h2>Sources</h2><ol><li><a href="https://www.acma.gov.au/say-no-to-telemarketers" target="_blank" rel="noreferrer">ACMA: Say no to telemarketers</a></li><li><a href="https://www.donotcall.gov.au/" target="_blank" rel="noreferrer">Australian Do Not Call Register</a></li><li><a href="https://www.acma.gov.au/avoid-sending-spam" target="_blank" rel="noreferrer">ACMA: Avoid sending spam</a></li><li><a href="https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/direct-marketing" target="_blank" rel="noreferrer">OAIC: Direct marketing</a></li></ol><p className="bw-last-reviewed">Updated 7 September 2026</p></footer>
          </div></div>
        </article>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </GuidesShell>
  );
}
