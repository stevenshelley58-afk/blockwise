import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { BlogShell } from "@/components/blog/blog-shell";

import "./blog.css";

export const metadata: Metadata = {
  title: "Field guides for real-estate advertising",
  description: "Practical, evidence-led guides for Australian real-estate agents running Meta ads and following up seller leads.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndexPage() {
  return (
    <BlogShell>
      <main className="bw-blog-index">
        <section className="bw-blog-index-intro">
          <div>
            <p className="bw-blog-label">Blockwise field guides</p>
            <h1>Advertising field guides for Australian real estate.</h1>
          </div>
          <div className="bw-blog-index-summary">
            <p>Practical playbooks for agents who want a clearer campaign, a better lead path and fewer invented benchmarks.</p>
            <ul aria-label="What to expect from Blockwise field guides">
              <li>Australian market context</li>
              <li>Evidence before opinion</li>
              <li>Steps you can actually run</li>
            </ul>
          </div>
        </section>

        <section className="bw-blog-feature" aria-labelledby="featured-guide">
          <Link href="/blog/sold-price-list-seller-leads" className="bw-blog-feature-image">
            <Image
              src="/blog/sold-price-list/hero.webp"
              alt="Established Australian homes along a tree-lined suburban street"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 62vw"
            />
          </Link>
          <div className="bw-blog-feature-copy">
            <span>Field guide 01 · Seller lead generation</span>
            <h2 id="featured-guide">The sold-price list</h2>
            <p>
              A visual field guide to turning recent local sales into a focused Meta campaign and a useful homeowner conversation.
            </p>
            <dl className="bw-blog-feature-details">
              <div><dt>Read time</dt><dd>12 minutes</dd></div>
              <div><dt>For</dt><dd>Australian agents</dd></div>
            </dl>
            <Link href="/blog/sold-price-list-seller-leads" className="bw-blog-read-link">
              Read the field guide <span aria-hidden>→</span>
            </Link>
          </div>
        </section>

        <section className="bw-blog-standard" aria-labelledby="field-guide-standard">
          <p>What makes a Blockwise field guide</p>
          <div>
            <h2 id="field-guide-standard">Specific enough to use on Monday.</h2>
            <p>Each guide starts with a real advertising decision, uses Australian sources where they matter, and finishes with a campaign structure your team can review.</p>
          </div>
        </section>
      </main>
    </BlogShell>
  );
}
