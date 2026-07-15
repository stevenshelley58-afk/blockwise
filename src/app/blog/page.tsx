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
          <p className="bw-blog-label">Blockwise field guides</p>
          <h1>Useful advertising advice, without the theatre.</h1>
          <p>Detailed playbooks for agents who want a clear campaign, a better lead path and fewer invented benchmarks.</p>
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
            <span>Seller lead generation · 12 min</span>
            <h2 id="featured-guide">The sold-price list</h2>
            <p>
              A visual field guide to turning recent local sales into a focused Meta campaign and a useful homeowner conversation.
            </p>
            <Link href="/blog/sold-price-list-seller-leads" className="bw-blog-read-link">
              Read the field guide <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>
    </BlogShell>
  );
}
