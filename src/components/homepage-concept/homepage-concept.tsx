"use client";

import {
  Check,
  ChevronRight,
  Globe2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { CreativeEditPreview } from "@/components/homepage-concept/creative-edit-preview";
import { CREATIVE_EDIT_EXAMPLES } from "@/lib/homepage-concept/creative-edit";
import { ResultsReporting } from "@/components/homepage-concept/results-reporting";
import { FAQS, withBasePath } from "@/lib/homepage-concept/content";
import { requestMockTrial, validateTrialEmail } from "@/lib/homepage-concept/mock-trial";

type FormState = "idle" | "loading" | "success" | "error";

function PrimaryLink({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <a className={`hc-button hc-button--primary ${className}`} href="#trial">
      {children}
    </a>
  );
}

function TrialForm() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;

    const validationError = validateTrialEmail(email);
    if (validationError) {
      setState("error");
      setMessage(validationError);
      return;
    }

    setState("loading");
    setMessage("");
    try {
      const result = await requestMockTrial(email);
      setState("success");
      setMessage(result.message);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <form className="hc-trial-form" onSubmit={handleSubmit} noValidate>
      <noscript><p className="hc-form-note">Enable JavaScript to try the preview form.</p></noscript>
      <label htmlFor="trial-email">Work email</label>
      <div className="hc-trial-row">
        <input
          id="trial-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@agency.com.au"
          value={email}
          aria-invalid={state === "error"}
          aria-describedby="trial-note trial-status"
          disabled={!hydrated || state === "loading"}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state !== "idle") {
              setState("idle");
              setMessage("");
            }
          }}
        />
        <button className="hc-button hc-button--light" type="submit" disabled={!hydrated || state === "loading"}>
          {state === "loading" ? "Preparing demo…" : "Start free trial"}
          {state === "loading" ? <span className="hc-spinner" aria-hidden="true" /> : null}
        </button>
      </div>
      <p id="trial-note" className="hc-form-note">No card required. Ad spend is separate.</p>
      <p
        id="trial-status"
        className={`hc-form-status hc-form-status--${state}`}
        role={state === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {message || "Preview only. Your email is not sent or saved."}
      </p>
    </form>
  );
}

type MetaShowcaseAd = {
  id: string;
  format: "feed" | "story";
  page: string;
  initials: string;
  tone: "navy" | "blue" | "gold" | "charcoal";
  image: string;
  copy: string;
  headline: string;
  domain: string;
  reactions: string;
  comments: string;
};

const META_SHOWCASE_ADS: readonly MetaShowcaseAd[] = [
  {
    id: "just-listed-feed",
    format: "feed",
    page: "Blockwise Realty",
    initials: "BR",
    tone: "navy",
    image: "/home/home-dusk.webp",
    copy: "Just listed in Mount Lawley. View the photos, floorplan and inspection times.",
    headline: "A new address worth seeing",
    domain: "BLOCKWISEREALTY.COM.AU",
    reactions: "36",
    comments: "5",
  },
  {
    id: "buyers-story",
    format: "story",
    page: "West & Co Property",
    initials: "W&C",
    tone: "blue",
    image: "/hero/hero-tall.jpg",
    copy: "Qualified buyers are looking now.",
    headline: "See buyer demand",
    domain: "WESTANDCO.COM.AU",
    reactions: "21",
    comments: "3",
  },
  {
    id: "local-advice-feed",
    format: "feed",
    page: "Jordan Lee Property",
    initials: "JL",
    tone: "charcoal",
    image: "/home/open-home-living.webp",
    copy: "Local advice. Clear next steps. Talk with Jordan about your property plans.",
    headline: "Book a no-pressure property call",
    domain: "JORDANLEE.COM.AU",
    reactions: "48",
    comments: "7",
  },
  {
    id: "appraisal-story",
    format: "story",
    page: "Mia Calloway Real Estate",
    initials: "MC",
    tone: "gold",
    image: "/ads/ad-coastline.jpg",
    copy: "Find out what your home could be worth.",
    headline: "Request an appraisal",
    domain: "MIACALLOWAY.COM.AU",
    reactions: "29",
    comments: "4",
  },
  {
    id: "first-home-feed",
    format: "feed",
    page: "Northside Property",
    initials: "NP",
    tone: "navy",
    image: "/home/mt-lawley-federation.webp",
    copy: "Buying your first home? Start with the questions that make every inspection easier.",
    headline: "A smarter first-home checklist",
    domain: "NORTHSIDEPROPERTY.COM.AU",
    reactions: "63",
    comments: "11",
  },
  {
    id: "mobile-appraisal-story",
    format: "story",
    page: "Alex Morgan Property",
    initials: "AM",
    tone: "blue",
    image: "/home/workspace-hero/agent-ad.png",
    copy: "Your local property appraisal, made simple.",
    headline: "Book an appraisal",
    domain: "ALEXMORGAN.COM.AU",
    reactions: "34",
    comments: "6",
  },
  {
    id: "market-report-feed",
    format: "feed",
    page: "Harbourline Realty",
    initials: "HR",
    tone: "charcoal",
    image: "/home/home-pool.webp",
    copy: "Prices, recent sales and buyer activity. See what changed in your local market.",
    headline: "Your suburb market report",
    domain: "HARBOURLINE.COM.AU",
    reactions: "57",
    comments: "9",
  },
  {
    id: "planning-story",
    format: "story",
    page: "Oak & Key Property",
    initials: "O&K",
    tone: "gold",
    image: "/ads/ad-hillview.jpg",
    copy: "Plan your next move with a clearer property checklist.",
    headline: "Get the checklist",
    domain: "OAKANDKEY.COM.AU",
    reactions: "42",
    comments: "8",
  },
] as const;

const META_DECK_POSITIONS = [
  { x: "0%", y: 0, scale: 1, rotate: 0, opacity: 1 },
  { x: "28%", y: 18, scale: 0.91, rotate: 3, opacity: 0.66 },
  { x: "-28%", y: 30, scale: 0.82, rotate: -4, opacity: 0.38 },
  { x: "12%", y: 50, scale: 0.74, rotate: 2, opacity: 0 },
  { x: "-12%", y: 62, scale: 0.69, rotate: -2, opacity: 0 },
  { x: "8%", y: 72, scale: 0.65, rotate: 2, opacity: 0 },
  { x: "-8%", y: 80, scale: 0.62, rotate: -2, opacity: 0 },
  { x: "0%", y: 88, scale: 0.6, rotate: 0, opacity: 0 },
] as const;

const META_DECK_TRANSITION = { duration: 0.72, ease: [0.16, 1, 0.3, 1] as const };

function MetaAvatar({ ad }: { ad: MetaShowcaseAd }) {
  return <span className={`hc-meta-avatar hc-meta-avatar--${ad.tone}`}>{ad.initials}</span>;
}

function MetaFeedAd({ ad }: { ad: MetaShowcaseAd }) {
  return (
    <article className="hc-meta-ad hc-meta-feed" aria-label={`${ad.page} sponsored Facebook Feed ad`}>
      <header className="hc-meta-feed-head">
        <MetaAvatar ad={ad} />
        <span><strong>{ad.page}</strong><small>Sponsored · <Globe2 aria-hidden="true" size={9} /></small></span>
        <MoreHorizontal aria-hidden="true" size={19} />
      </header>
      <p className="hc-meta-feed-copy">{ad.copy}</p>
      <img className="hc-meta-feed-image" src={withBasePath(ad.image)} alt="" width="1080" height="1350" />
      <div className="hc-meta-link-preview">
        <span><small>{ad.domain}</small><strong>{ad.headline}</strong></span>
        <b>Learn more</b>
      </div>
      <div className="hc-meta-social-proof">
        <span><i><ThumbsUp aria-hidden="true" size={9} fill="currentColor" /></i>{ad.reactions}</span>
        <span>{ad.comments} comments</span>
      </div>
      <div className="hc-meta-actions">
        <span><ThumbsUp aria-hidden="true" size={15} />Like</span>
        <span><MessageCircle aria-hidden="true" size={15} />Comment</span>
        <span><Share2 aria-hidden="true" size={15} />Share</span>
      </div>
    </article>
  );
}

function MetaStoryAd({ ad }: { ad: MetaShowcaseAd }) {
  return (
    <article className="hc-meta-ad hc-meta-story" aria-label={`${ad.page} sponsored Instagram Story ad`}>
      <img className="hc-meta-story-image" src={withBasePath(ad.image)} alt="" width="1080" height="1920" />
      <div className="hc-meta-story-shade" />
      <div className="hc-meta-story-progress"><i /><i /><i /></div>
      <header className="hc-meta-story-head">
        <MetaAvatar ad={ad} />
        <span><strong>{ad.page}</strong><small>Sponsored</small></span>
        <MoreHorizontal aria-hidden="true" size={19} />
      </header>
      <div className="hc-meta-story-cta">
        <strong>{ad.headline}</strong>
        <span>Learn more <ChevronRight aria-hidden="true" size={13} /></span>
      </div>
      <div className="hc-meta-story-reply">
        <span>Send message</span>
        <ThumbsUp aria-hidden="true" size={18} />
        <Send aria-hidden="true" size={18} />
      </div>
    </article>
  );
}

function MetaAdShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const reduceMotion = Boolean(useReducedMotion());
  const [order, setOrder] = useState(() => META_SHOWCASE_ADS.map((_, index) => index));
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const shouldPlay = inView && pageVisible && !reduceMotion;

  useEffect(() => {
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    syncVisibility();
    if (sectionRef.current) observer.observe(sectionRef.current);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!shouldPlay) return;
    const timer = window.setTimeout(() => {
      setOrder((current) => [current[current.length - 1], ...current.slice(0, -1)]);
    }, 1850);
    return () => window.clearTimeout(timer);
  }, [order, shouldPlay]);

  return (
    <div className="hc-meta-showcase" ref={sectionRef}>
      <div className="hc-meta-stage" aria-label="Examples of Facebook Feed and Instagram Story ads">
        <p className="hc-sr-only">
          Showing {META_SHOWCASE_ADS[order[0]].format === "feed" ? "Facebook Feed" : "Instagram Story"} ad from {META_SHOWCASE_ADS[order[0]].page}
        </p>
        <div className="hc-meta-deck">
          {META_SHOWCASE_ADS.map((ad, index) => {
            const position = order.indexOf(index);
            const pose = META_DECK_POSITIONS[position];
            return (
              <div className="hc-meta-card-positioner" key={ad.id}>
                <motion.div
                  className={`hc-meta-card hc-meta-card--${ad.format}${position === 0 ? " is-front" : ""}`}
                  aria-hidden={position !== 0}
                  style={{ zIndex: META_SHOWCASE_ADS.length - position }}
                  animate={pose}
                  transition={reduceMotion ? { duration: 0 } : META_DECK_TRANSITION}
                >
                  {ad.format === "feed" ? <MetaFeedAd ad={ad} /> : <MetaStoryAd ad={ad} />}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HomepageConcept() {
  const [selectedExample, setSelectedExample] = useState(0);

  return (
    <div className="hc-root">
      <header className="hc-header">
        <a className="hc-logo" href="#top" aria-label="Blockwise homepage concept">
          <img src={withBasePath("/brand/blockwise-logo-white.svg")} alt="Blockwise" width="142" height="32" />
        </a>
        <nav aria-label="Primary navigation">
          <a href="#examples">Examples</a>
          <a href="#results">Results</a>
          <a href="https://blockwise.sale/pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="hc-header-cta" href="#trial">Start free trial</a>
      </header>

      <main>
        <section className="hc-hero" id="top">
          <div className="hc-shell hc-hero-grid">
            <div className="hc-hero-copy">
              <h1><span>Your competition is running ads.</span> <span className="hc-hero-prompt">Are you?</span></h1>
              <p>More listings, less marketing stress.</p>
              <div className="hc-hero-actions">
                <PrimaryLink>Start free trial</PrimaryLink>
                <span><Check aria-hidden="true" size={16} /> No card required.</span>
              </div>
            </div>
            <div className="hc-hero-visual">
              <MetaAdShowcase />
            </div>
          </div>
        </section>


        <section className="hc-examples" id="examples" aria-labelledby="examples-heading">
          <div className="hc-shell hc-examples-layout">
            <div className="hc-section-copy hc-examples-intro">
              <h2 id="examples-heading">Your brand.<br />Your ads.</h2>
              <div className="hc-example-tabs" role="group" aria-label="Choose an ad example">
                {CREATIVE_EDIT_EXAMPLES.map((example, index) => (
                  <button
                    key={example.id}
                    type="button"
                    id={`example-tab-${example.id}`}
                    aria-pressed={selectedExample === index}
                    aria-controls="example-panel"
                    onClick={() => setSelectedExample(index)}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </div>
            <div id="example-panel" className="hc-example-stage" role="region" aria-label={`${CREATIVE_EDIT_EXAMPLES[selectedExample].label} ad example`}>
              <CreativeEditPreview selectedExample={selectedExample} />
            </div>
          </div>
        </section>

        <ResultsReporting />

        <section className="hc-faq" id="faq">
          <div className="hc-shell hc-faq-grid">
            <div className="hc-section-copy">
              <h2>FAQ</h2>
            </div>
            <div className="hc-faq-list">
              {FAQS.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="hc-trial" id="trial">
          <div className="hc-shell hc-trial-grid">
            <div>
              <h2>Start with your email.</h2>

            </div>
            <TrialForm />
          </div>
        </section>
      </main>

      <footer className="hc-footer">
        <div className="hc-shell">
          <img src={withBasePath("/brand/blockwise-logo.svg")} alt="Blockwise" width="134" height="30" />
          <nav aria-label="Footer navigation">
            <a href="https://blockwise.sale/pricing">Pricing</a>
            <a href="https://blockwise.sale/guides">Guides</a>
            <a href="#top">Back to top</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
