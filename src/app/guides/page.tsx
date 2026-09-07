import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { GuidesShell } from "@/components/guides/guides-shell";
import { niche } from "@/config/niche";

import "./guides.css";

export const metadata: Metadata = {
  title: "Practical guides for real-estate advertising",
  description:
    "Choose the next advertising decision, then work through a practical plan your team can review before spending.",
  alternates: { canonical: "/guides" },
  openGraph: {
    type: "website",
    title: "Practical guides for real-estate advertising | Blockwise",
    description:
      "Choose the next advertising decision, then work through a practical plan your team can review before spending.",
    url: "/guides",
    images: [{ url: "/guides/og-guides-index.webp", width: 1200, height: 630, alt: "Blockwise guides for real-estate advertising" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Practical guides for real-estate advertising | Blockwise",
    description:
      "Choose the next advertising decision, then work through a practical plan your team can review before spending.",
    images: ["/guides/og-guides-index.webp"],
  },
};

type Guide = {
  href: string;
  label: string;
  title: string;
  summary: string;
  readTime: string;
};

type GuideGroup = {
  title: string;
  description: string;
  guides: Guide[];
};

const flagship: Guide = {
  href: "/guides/sold-price-list-seller-leads",
  label: "Seller leads",
  title: "The sold-price list",
  summary:
    "Get a sample sold-price resource, the ad and form to offer it, a delivery email, and a review plan for the test.",
  readTime: "6 minutes",
};

const guideGroups: GuideGroup[] = [
  {
    title: "Choose the offer",
    description: "Start with what you can make useful before you ask someone to talk.",
    guides: [
      flagship,
      {
        href: "/guides/seller-offer-ladder-real-estate-ads",
        label: "Offer strategy",
        title: "The seller offer ladder",
        summary:
          "Match the ask to homeowner intent, from a low-commitment resource to a strategy call.",
        readTime: "6 minutes",
      },
      {
        href: "/guides/custom-list-facebook-ad-buyer-leads",
        label: "Buyer leads",
        title: "The custom-list Facebook ad",
        summary:
          "Make a buyer campaign specific with a filtered local list and one clear constraint.",
        readTime: "5 minutes",
      },
    ],
  },
  {
    title: "Build the campaign",
    description: "Turn the offer into creative and delivery choices you can actually test.",
    guides: [
      {
        href: "/guides/real-estate-creative-portfolio-meta-ads",
        label: "Creative strategy",
        title: "The creative portfolio",
        summary:
          "Build distinct concepts for different homeowner situations instead of relying on one hero ad.",
        readTime: "6 minutes",
      },
      {
        href: "/guides/downsizing-ad-seller-leads",
        label: "Seller leads",
        title: "The downsizing ad",
        summary:
          "Use a buyer campaign to reach downsizers who may need to sell before they move.",
        readTime: "6 minutes",
      },
      {
        href: "/guides/meta-ads-algorithm-changes-real-estate",
        label: "Meta ads strategy",
        title: "Meta's 2026 algorithm changes",
        summary:
          "Understand what changing delivery systems mean for creative variety and testing.",
        readTime: "5 minutes",
      },
    ],
  },
  {
    title: "Improve what happens next",
    description: "Keep the useful signal after someone submits a form.",
    guides: [
      {
        href: "/guides/meta-lead-quality-crm-feedback-loop",
        label: "Lead quality",
        title: "The lead quality feedback loop",
        summary:
          "Connect downstream outcomes to ad decisions so lead volume is not the only signal.",
        readTime: "6 minutes",
      },
      {
        href: "/guides/lead-follow-up-playbook",
        label: "Lead conversion",
        title: "The follow-up playbook",
        summary:
          "Set a practical call, email and SMS cadence with ownership and review points.",
        readTime: "7 minutes",
      },
    ],
  },
];

function groupId(title: string) {
  return "group-" + title.toLowerCase().replaceAll(" ", "-");
}

export default function GuidesIndexPage() {
  if (!niche.features.guides) notFound();

  return (
    <GuidesShell>
      <main className="bw-guides-index" id="main-content">
        <section className="bw-guides-index-intro" aria-labelledby="guides-title">
          <p className="bw-guides-label">Guides for the next campaign decision</p>
          <h1 id="guides-title">Better real-estate leads. A clear next step.</h1>
          <p className="bw-guides-index-deck">
            Practical guidance for the moment before you spend: choose an offer, build the campaign, and set the review point.
          </p>
          <Link href={flagship.href} className="bw-guides-primary-link">
            Start with the sold-price list <span aria-hidden>→</span>
          </Link>
        </section>

        <section className="bw-guides-feature" aria-labelledby="featured-guide">
          <div className="bw-guides-feature-copy">
            <span className="bw-guides-feature-kicker">Flagship guide · seller leads</span>
            <h2 id="featured-guide">{flagship.title}</h2>
            <p>{flagship.summary}</p>
            <dl className="bw-guides-feature-details">
              <div><dt>Read time</dt><dd>{flagship.readTime}</dd></div>
              <div><dt>Best for</dt><dd>A first seller-lead test</dd></div>
            </dl>
            <Link href={flagship.href} className="bw-guides-read-link">
              Read the guide <span aria-hidden>→</span>
            </Link>
          </div>
        </section>

        <section className="bw-guides-groups" aria-labelledby="all-guides">
          <div className="bw-guides-groups-heading">
            <p className="bw-guides-label">The guide shelf</p>
            <h2 id="all-guides">Find the decision you need to make.</h2>
          </div>
          {guideGroups.map((group) => (
            <section key={group.title} className="bw-guides-group" aria-labelledby={groupId(group.title)}>
              <div className="bw-guides-group-heading">
                <h3 id={groupId(group.title)}>{group.title}</h3>
                <p>{group.description}</p>
              </div>
              <div className="bw-guide-list">
                {group.guides.map((guide) => (
                  <Link key={guide.href} href={guide.href} className="bw-guide-card">
                    <div className="bw-guide-card-body">
                      <span className="bw-guide-card-category">{guide.label}</span>
                      <h4>{guide.title}</h4>
                      <p>{guide.summary}</p>
                      <div className="bw-guide-card-foot">
                        <span>{guide.readTime} read</span>
                        <span aria-hidden>→</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </section>
      </main>
    </GuidesShell>
  );
}
