import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { GuidesShell } from "@/components/guides/guides-shell";

import "./guides.css";

export const metadata: Metadata = {
  title: "Practical guides for real-estate advertising",
  description:
    "Real-estate advertising guides built around clear decisions, reliable evidence and campaign steps your team can use.",
  alternates: { canonical: "/guides" },
};

const guides = [
  {
    href: "/guides/seller-offer-ladder-real-estate-ads",
    image: "/guides/offer-ladder/hero.webp",
    alt: "A four-step ladder representing increasing homeowner commitment levels",
    label: "Offer strategy",
    title: "The seller offer ladder",
    hook: "Most homeowners who see your ad are not ready for an appraisal. Build a ladder of offers — from sold-price lists to strategy calls — that meets each person at their actual stage of intent.",
    readTime: "11 minutes",
    category: "Offer strategy",
  },
  {
    href: "/guides/sold-price-list-seller-leads",
    image: "/guides/sold-price-list/hero.webp",
    alt: "Established homes along a tree-lined suburban street",
    label: "Seller lead generation",
    title: "The sold-price list",
    hook: "Turn recent local sales into a focused Meta campaign, a useful homeowner resource and a follow-up path your team can review.",
    readTime: "12 minutes",
    category: "Seller leads",
  },
  {
    href: "/guides/meta-lead-quality-crm-feedback-loop",
    image: "/guides/lead-quality/hero.webp",
    alt: "A feedback loop diagram showing lead quality signals returning to the advertising platform",
    label: "Lead quality",
    title: "The lead quality feedback loop",
    hook: "A cheap Meta lead is not a useful real estate lead. Send appraisal and listing outcomes back through your CRM so the algorithm learns what a quality lead looks like.",
    readTime: "12 minutes",
    category: "Lead quality",
  },
  {
    href: "/guides/real-estate-creative-portfolio-meta-ads",
    image: "/guides/creative-portfolio/hero.webp",
    alt: "A portfolio wall of five different real estate ad concepts",
    label: "Creative strategy",
    title: "The creative portfolio",
    hook: "One suburb does not equal one audience. Build a portfolio of distinct ad concepts that let Meta's algorithm match your ads to different homeowners — instead of running one hero ad.",
    readTime: "13 minutes",
    category: "Creative strategy",
  },
  {
    href: "/guides/downsizing-ad-seller-leads",
    image: "/guides/downsizing/hero.webp",
    alt: "A single-storey home typical of a downsizing market",
    label: "Seller lead generation",
    title: "The downsizing ad",
    hook: "Seller-lead campaigns are the most expensive ads in real estate. There is a cheaper path — a buyer ad that quietly attracts homeowners who must sell before they buy.",
    readTime: "12 minutes",
    category: "Seller leads",
  },
  {
    href: "/guides/meta-ads-algorithm-changes-real-estate",
    image: "/guides/meta-algorithm/hero.webp",
    alt: "Abstract layers representing Meta's ad retrieval and ranking pipeline",
    label: "Meta ads strategy",
    title: "Meta's 2026 algorithm changes",
    hook: "Meta replaced three layers of its ad system in twelve months — Andromeda, GEM and Adaptive Ranking. The agents who adapt stop over-targeting and start diversifying their creative.",
    readTime: "12 minutes",
    category: "Meta ads strategy",
  },
  {
    href: "/guides/lead-follow-up-playbook",
    image: "/guides/follow-up/hero.webp",
    alt: "A real estate lead follow-up desk setup with phone and CRM",
    label: "Lead conversion",
    title: "The follow-up playbook",
    hook: "The average lead converts after seven touch points. The average agent follows up once. This is the 90-day system that closes the gap.",
    readTime: "13 minutes",
    category: "Lead conversion",
  },
  {
    href: "/guides/custom-list-facebook-ad-buyer-leads",
    image: "/guides/custom-list/hero.webp",
    alt: "Meta Ads Manager campaign setup for a custom-list real estate lead ad",
    label: "Buyer lead generation",
    title: "The custom-list Facebook ad",
    hook: "Most real estate Facebook ads fail because the offer is too generic. A custom list of local homes with one desirable feature fixes that — and produces leads within 24 hours.",
    readTime: "14 minutes",
    category: "Buyer leads",
  },
];

export default function GuidesIndexPage() {
  return (
    <GuidesShell>
      <main className="bw-guides-index" id="main-content">
        <section className="bw-guides-index-intro">
          <p className="bw-guides-label">Blockwise guides</p>
          <h1>Practical guides for better real-estate advertising.</h1>
          <p className="bw-guides-index-deck">
            Campaign guidance grounded in real decisions, reliable evidence and steps your team can review before spending.
          </p>
          <ul className="bw-guides-principles" aria-label="What to expect from Blockwise guides">
            <li><strong>Local</strong><span>Market and compliance context</span></li>
            <li><strong>Useful</strong><span>Specific actions, examples and review points</span></li>
            <li><strong>Honest</strong><span>Sources made visible and assumptions labelled</span></li>
          </ul>
        </section>

        <section className="bw-guides-feature" aria-labelledby="featured-guide">
          <Link href={guides[0].href} className="bw-guides-feature-image">
            <Image
              src={guides[0].image}
              alt={guides[0].alt}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 62vw"
            />
          </Link>
          <div className="bw-guides-feature-copy">
            <span>{guides[0].label}</span>
            <h2 id="featured-guide">{guides[0].title}</h2>
            <p>{guides[0].hook}</p>
            <dl className="bw-guides-feature-details">
              <div><dt>Read time</dt><dd>{guides[0].readTime}</dd></div>
              <div><dt>For</dt><dd>Real-estate agents</dd></div>
            </dl>
            <Link href={guides[0].href} className="bw-guides-read-link">
              Read the {guides[0].title.toLowerCase()} <span aria-hidden>→</span>
            </Link>
          </div>
        </section>

        <section className="bw-guides-grid-section" aria-labelledby="all-guides">
          <h2 id="all-guides" className="bw-guides-grid-heading">All guides</h2>
          <div className="bw-guides-grid">
            {guides.map((guide) => (
              <Link key={guide.href} href={guide.href} className="bw-guide-card">
                <div className="bw-guide-card-image">
                  <Image
                    src={guide.image}
                    alt={guide.alt}
                    fill
                    sizes="(max-width: 780px) 100vw, (max-width: 1050px) 50vw, 33vw"
                  />
                </div>
                <div className="bw-guide-card-body">
                  <span className="bw-guide-card-category">{guide.category}</span>
                  <h3>{guide.title}</h3>
                  <p>{guide.hook}</p>
                  <div className="bw-guide-card-foot">
                    <span>{guide.readTime} read</span>
                    <span aria-hidden>→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="bw-guides-method" aria-labelledby="guide-method">
          <div className="bw-guides-method-heading">
            <h2 id="guide-method">Built around the work.</h2>
            <p>
              Every Blockwise guide follows the same practical sequence, so you can move from an idea to a controlled campaign without filling in the gaps yourself.
            </p>
          </div>
          <ol>
            <li><span>01</span><div><h3>Name the decision</h3><p>Start with the campaign choice that needs a clear answer.</p></div></li>
            <li><span>02</span><div><h3>Check the evidence</h3><p>Use primary sources where local context changes the advice.</p></div></li>
            <li><span>03</span><div><h3>Build the campaign</h3><p>Turn the evidence into creative, form, budget and follow-up steps.</p></div></li>
            <li><span>04</span><div><h3>Set the review point</h3><p>Define what to measure and when to continue, revise or stop.</p></div></li>
          </ol>
        </section>
      </main>
    </GuidesShell>
  );
}
