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
          <Link href="/guides/sold-price-list-seller-leads" className="bw-guides-feature-image">
            <Image
              src="/guides/sold-price-list/hero.webp"
              alt="Established homes along a tree-lined suburban street"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 62vw"
            />
          </Link>
          <div className="bw-guides-feature-copy">
            <span>Seller lead generation</span>
            <h2 id="featured-guide">The sold-price list</h2>
            <p>
              Turn recent local sales into a focused Meta campaign, a useful homeowner resource and a follow-up path your team can review.
            </p>
            <dl className="bw-guides-feature-details">
              <div><dt>Read time</dt><dd>12 minutes</dd></div>
              <div><dt>For</dt><dd>Real-estate agents</dd></div>
            </dl>
            <Link href="/guides/sold-price-list-seller-leads" className="bw-guides-read-link">
              Read the sold-price guide <span aria-hidden>→</span>
            </Link>
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
