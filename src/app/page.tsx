import { ArrowRight, MapPin } from "lucide-react";
import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CtaLink } from "@/components/landing/cta-link";
import { DemoForm } from "@/components/landing/demo-form";

type AdProps = {
  agency: string;
  initial: string;
  brand: string;
  suburb: string;
  status: string;
  price: string;
  headline: string;
  copy: string;
  scene: 1 | 2 | 3 | 4 | 5 | 6;
  image: string;
};

function FacebookAd({ agency, initial, brand, suburb, status, price, headline, copy, scene, image }: AdProps) {
  return (
    <article className="mock-ad mock-ad-feed">
      <header className="mock-ad-head">
        <span className="mock-ad-avatar" style={{ background: brand }}>
          {initial}
        </span>
        <div className="mock-ad-meta">
          <strong>{agency}</strong>
          <span>Sponsored</span>
        </div>
        <span className="mock-ad-tag">Ad</span>
      </header>
      <p className="mock-ad-copy">{copy}</p>
      <div
        className={`mock-ad-image scene-${scene}`}
        style={{ backgroundImage: `url("${image}")`, backgroundSize: "cover", backgroundPosition: "center" }}
        aria-hidden
      >
        <span className="mock-ad-status">{status}</span>
        <span className="mock-ad-price">{price}</span>
        <span className="mock-ad-pin">
          <MapPin aria-hidden size={12} />
          {suburb}
        </span>
      </div>
      <footer className="mock-ad-foot">
        <div>
          <strong>{headline}</strong>
          <span>blockwise.sale</span>
        </div>
        <span className="mock-ad-cta">Book appraisal</span>
      </footer>
    </article>
  );
}

function InstagramStory({ agency, brand, suburb, price, headline, scene, image }: AdProps) {
  return (
    <article className="mock-ad mock-ad-story">
      <div
        className={`mock-ad-story-bg scene-${scene}`}
        style={{ backgroundImage: `url("${image}")`, backgroundSize: "cover", backgroundPosition: "center" }}
        aria-hidden
      />
      <div className="mock-ad-story-overlay">
        <header className="mock-ad-story-head">
          <span className="mock-ad-story-bar" />
          <span className="mock-ad-story-bar" />
          <span className="mock-ad-story-bar dim" />
        </header>
        <div className="mock-ad-story-agency">
          <span className="mock-ad-avatar sm" style={{ background: brand }}>
            ●
          </span>
          <strong>{agency}</strong>
          <span className="mock-ad-tag light">Sponsored</span>
        </div>
        <div className="mock-ad-story-body">
          <span className="mock-ad-story-suburb">{suburb}</span>
          <h4>{headline}</h4>
          <strong className="mock-ad-story-price">{price}</strong>
        </div>
        <div className="mock-ad-story-cta">
          <span>Swipe up</span>
        </div>
      </div>
    </article>
  );
}

const ads: Array<AdProps & { format: "facebook" | "instagram" }> = [
  {
    format: "facebook",
    agency: "Northstar Realty",
    initial: "N",
    brand: "#1a3a55",
    suburb: "Mount Lawley",
    status: "Just listed",
    price: "$1.4M",
    headline: "Federation home, 3 streets back from Beaufort St",
    copy: "Mt Lawley owners — three homes like yours sold above reserve this month. Free 15-min appraisal.",
    scene: 1,
    image: "/ads/ad-northstar.jpg",
  },
  {
    format: "instagram",
    agency: "Coastline Property",
    initial: "C",
    brand: "#2c4773",
    suburb: "Cottesloe",
    status: "Off-market",
    price: "Guide $2.8M",
    headline: "Ocean glimpse. 4 bed, 2 bath.",
    copy: "",
    scene: 4,
    image: "/ads/ad-coastline.jpg",
  },
  {
    format: "facebook",
    agency: "Hill & Co.",
    initial: "H",
    brand: "#0a0a0a",
    suburb: "South Perth",
    status: "Auction Sat",
    price: "$2.1M+",
    headline: "Riverside terrace. Wide block. 1pm Saturday.",
    copy: "Saturday auction, 1pm. Three bidders registered. Inspections Thursday 5:30pm.",
    scene: 3,
    image: "/ads/ad-hillco.jpg",
  },
  {
    format: "instagram",
    agency: "Hillview Agents",
    initial: "H",
    brand: "#3a4763",
    suburb: "Subiaco",
    status: "New listing",
    price: "Guide $1.6M",
    headline: "Subi cottage. Walk to Rokeby Rd.",
    copy: "",
    scene: 5,
    image: "/ads/ad-hillview.jpg",
  },
];

function HowItWorksFlow() {
  return (
    <div className="flow" aria-label="How Blockwise works">
      <div className="flow-step">
        <div className="flow-art flow-art-suburb">
          <div className="flow-pill">
            <MapPin aria-hidden size={14} />
            <span>Mount Lawley</span>
          </div>
          <span className="flow-cursor" aria-hidden>|</span>
        </div>
        <span className="flow-num">01</span>
        <strong className="flow-label">Pick a suburb</strong>
      </div>

      <svg className="flow-arrow" viewBox="0 0 80 14" aria-hidden>
        <line x1="0" y1="7" x2="72" y2="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 4" />
        <polyline points="66,2 74,7 66,12" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>

      <div className="flow-step">
        <div className="flow-art flow-art-ads">
          <span className="flow-ad-mini m1" />
          <span className="flow-ad-mini m2" />
          <span className="flow-ad-mini m3" />
          <span className="flow-ad-mini m4" />
          <span className="flow-ad-mini m5" />
          <span className="flow-ad-mini m6" />
        </div>
        <span className="flow-num">02</span>
        <strong className="flow-label">Approve the ads</strong>
      </div>

      <svg className="flow-arrow" viewBox="0 0 80 14" aria-hidden>
        <line x1="0" y1="7" x2="72" y2="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 4" />
        <polyline points="66,2 74,7 66,12" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>

      <div className="flow-step">
        <div className="flow-art flow-art-leads">
          <div className="flow-lead-row">
            <span className="flow-lead-dot" />
            <span className="flow-lead-bar" />
          </div>
          <div className="flow-lead-row">
            <span className="flow-lead-dot" />
            <span className="flow-lead-bar short" />
          </div>
          <div className="flow-lead-row">
            <span className="flow-lead-dot" />
            <span className="flow-lead-bar" />
          </div>
          <div className="flow-lead-row">
            <span className="flow-lead-dot" />
            <span className="flow-lead-bar short" />
          </div>
        </div>
        <span className="flow-num">03</span>
        <strong className="flow-label">Watch the leads land</strong>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-nav" aria-label="Primary">
        <Link className="site-brand" href="/" aria-label="Blockwise home">
          <BlockwiseLogo />
        </Link>
        <nav className="site-links" aria-label="Landing page">
          <a href="#ads">See the ads</a>
          <a href="#how">How it works</a>
        </nav>
        <nav className="site-nav-actions" aria-label="Account">
          <Link href="/login">Client sign in</Link>
          <CtaLink location="nav" className="button">
            Request access
          </CtaLink>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-left">
          <h1>
            More listings.
            <br />
            Nothing hidden.
          </h1>
          <p className="hero-sub">
            Selling isn&apos;t the hard bit. Getting the listing is. We run the ads. You watch every cent.
          </p>
          <div className="hero-cta">
            <CtaLink location="hero" className="button primary">
              Book a demo
              <ArrowRight aria-hidden size={18} />
            </CtaLink>
            <a className="button ghost" href="#ads">
              See the ads
            </a>
          </div>
        </div>

        <aside className="hero-right" aria-label="Sample Blockwise ad">
          <div className="hero-ad-stack">
            <div className="hero-ad-card hero-ad-back" aria-hidden>
              <span className="hero-ad-mini">Instagram</span>
            </div>
            <div className="hero-ad-card hero-ad-mid" aria-hidden>
              <span className="hero-ad-mini">Reels</span>
            </div>
            <div className="hero-ad-card hero-ad-front">
              <FacebookAd {...ads[0]} />
            </div>
          </div>
        </aside>
      </section>

      <section id="ads" className="ads-section" aria-labelledby="ads-heading">
        <div className="ads-head">
          <h2 id="ads-heading">Ads worth running. Numbers worth watching.</h2>
        </div>

        <div className="ads-gallery">
          {ads.map((ad, index) =>
            ad.format === "facebook" ? (
              <FacebookAd key={index} {...ad} />
            ) : (
              <InstagramStory key={index} {...ad} />
            ),
          )}
        </div>

        <div className="live-strip" aria-label="Live campaign performance">
          <div className="live-head">
            <span className="live-dot" aria-hidden />
            <span>Live · Mt Lawley campaign · day 6 of 14</span>
          </div>
          <div className="live-metrics">
            <div className="live-metric">
              <strong>12,847</strong>
              <span>Impressions</span>
            </div>
            <div className="live-metric">
              <strong>247</strong>
              <span>Clicks</span>
            </div>
            <div className="live-metric live-metric-highlight">
              <strong>18</strong>
              <span>Appraisal requests</span>
            </div>
            <div className="live-metric">
              <strong>$324 / $500</strong>
              <span>Week spend</span>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="how-section" aria-labelledby="how-heading">
        <div className="how-head">
          <h2 id="how-heading" className="sr-only">Three steps</h2>
        </div>
        <HowItWorksFlow />
      </section>

      <section id="demo" className="demo-section" aria-labelledby="demo-heading">
        <div className="demo-intro">
          <p className="eyebrow">Book a demo</p>
          <h2 id="demo-heading">See it in 15 minutes.</h2>
          <p className="demo-lead">
            Tell us your patch. We&apos;ll show you the ads we&apos;d run and the numbers
            you&apos;d watch — live, on a call.
          </p>
        </div>
        <DemoForm />
      </section>

      <footer className="site-footer" aria-label="Footer">
        <BlockwiseLogo />
        <nav className="site-footer-legal" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </nav>
        <span className="footer-fine">hello@blockwise.sale · © {new Date().getFullYear()}</span>
      </footer>
    </main>
  );
}
