"use client";

import { ChevronRight, Globe2, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { creativeImageSrcSet } from "@/lib/homepage-concept/creative-image";
import { SHOWCASE_ADS, withBasePath, type ShowcaseAd } from "@/lib/homepage-concept/content";

type DeckPose = { x: string; y: number; scale: number; rotate: number; opacity: number };

/** How long the front card is held before the deck advances. */
const DECK_HOLD_MS = 3400;

const DECK_POSES: readonly DeckPose[] = [
  { x: "0%", y: 0, scale: 1, rotate: 0, opacity: 1 },
  { x: "28%", y: 18, scale: 0.91, rotate: 3, opacity: 0.66 },
  { x: "-28%", y: 30, scale: 0.82, rotate: -4, opacity: 0.38 },
  { x: "12%", y: 50, scale: 0.74, rotate: 2, opacity: 0 },
  { x: "-12%", y: 62, scale: 0.69, rotate: -2, opacity: 0 },
  { x: "8%", y: 72, scale: 0.65, rotate: 2, opacity: 0 },
  { x: "-8%", y: 80, scale: 0.62, rotate: -2, opacity: 0 },
  { x: "0%", y: 88, scale: 0.6, rotate: 0, opacity: 0 },
];

const COMPACT_DECK_POSES: readonly DeckPose[] = DECK_POSES.map((pose) => ({ ...pose, x: "0%", rotate: 0 }));

function Avatar({ ad }: { ad: ShowcaseAd }) {
  return <span className={`hc-meta-avatar hc-meta-avatar--${ad.tone}`}>{ad.initials}</span>;
}

function FeedAd({ ad, eager = false }: { ad: ShowcaseAd; eager?: boolean }) {
  return (
    <article className="hc-meta-ad hc-meta-feed" aria-label={`${ad.page} example Facebook Feed ad`}>
      <header className="hc-meta-feed-head">
        <Avatar ad={ad} />
        <span><strong>{ad.page}</strong><small>Sponsored <Globe2 aria-hidden="true" size={9} /></small></span>
        <MoreHorizontal aria-hidden="true" size={19} />
      </header>
      <p className="hc-meta-feed-copy">{ad.copy}</p>
      <img
        className="hc-meta-feed-image"
        src={withBasePath(ad.image)}
        alt=""
        width="1080"
        height="1350"
        sizes="(min-width: 1024px) 326px, (min-width: 601px) 316px, min(296px, 78vw)"
        srcSet={creativeImageSrcSet(ad.image)}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
      />
      <div className="hc-meta-link-preview">
        <span><small>{ad.domain}</small><strong>{ad.headline}</strong></span>
        <b>Learn more</b>
      </div>
      <div className="hc-meta-actions" aria-hidden="true">
        <span><ThumbsUp size={15} />Like</span>
        <span><MessageCircle size={15} />Comment</span>
        <span><Share2 size={15} />Share</span>
      </div>
    </article>
  );
}

function StoryAd({ ad, eager = false }: { ad: ShowcaseAd; eager?: boolean }) {
  return (
    <article className="hc-meta-ad hc-meta-story" aria-label={`${ad.page} example Instagram Story ad`}>
      <img
        className="hc-meta-story-image"
        src={withBasePath(ad.image)}
        alt=""
        width="1080"
        height="1920"
        sizes="(min-width: 1024px) 276px, (min-width: 601px) 266px, min(240px, 64vw)"
        srcSet={creativeImageSrcSet(ad.image)}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
      />
      <div className="hc-meta-story-shade" />
      <div className="hc-meta-story-progress"><i /><i /><i /></div>
      <header className="hc-meta-story-head">
        <Avatar ad={ad} />
        <span><strong>{ad.page}</strong><small>Sponsored</small></span>
        <MoreHorizontal aria-hidden="true" size={19} />
      </header>
      <div className="hc-meta-story-cta"><strong>{ad.headline}</strong><span>Learn more <ChevronRight aria-hidden="true" size={13} /></span></div>
      <div className="hc-meta-story-reply"><span>Send message</span><ThumbsUp aria-hidden="true" size={18} /><Send aria-hidden="true" size={18} /></div>
    </article>
  );
}

function transformFor(pose: DeckPose) {
  return `translateX(${pose.x}) translateY(${pose.y}px) scale(${pose.scale}) rotate(${pose.rotate}deg)`;
}

export function HeroAdShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const reduceMotion = Boolean(useReducedMotion());
  const [order, setOrder] = useState(() => SHOWCASE_ADS.map((_, index) => index));
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [compactDeck, setCompactDeck] = useState(false);
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
    const media = window.matchMedia("(max-width: 600px)");
    const syncDeckSize = () => setCompactDeck(media.matches);
    syncDeckSize();
    media.addEventListener("change", syncDeckSize);
    return () => media.removeEventListener("change", syncDeckSize);
  }, []);

  useEffect(() => {
    if (!shouldPlay) return;
    /* Long enough that the card on top can actually be read before it moves. */
    const timer = window.setTimeout(() => setOrder((current) => [current[current.length - 1], ...current.slice(0, -1)]), DECK_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [order, shouldPlay]);

  return (
    <div className="hc-meta-showcase" ref={sectionRef}>
      <span className="hc-meta-example-label">Example ads</span>
      <div className="hc-meta-stage" aria-label="Animated examples of Facebook Feed and Instagram Story ads">
        <p className="hc-sr-only">Showing {SHOWCASE_ADS[order[0]].format === "feed" ? "Facebook Feed" : "Instagram Story"} example from {SHOWCASE_ADS[order[0]].page}</p>
        <div className="hc-meta-deck">
          {SHOWCASE_ADS.map((ad, index) => {
            const position = order.indexOf(index);
            const pose = (compactDeck ? COMPACT_DECK_POSES : DECK_POSES)[position];
            return (
              <div className="hc-meta-card-positioner" key={ad.id}>
                <motion.div
                  className={`hc-meta-card hc-meta-card--${ad.format}${position === 0 ? " is-front" : ""}`}
                  style={{ zIndex: SHOWCASE_ADS.length - position }}
                  aria-hidden={position !== 0}
                  animate={{ transform: transformFor(pose), opacity: pose.opacity }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.72, ease: [0.16, 1, 0.3, 1] as const }}
                >
                  {ad.format === "feed"
                    ? <FeedAd ad={ad} eager={position <= 1} />
                    : <StoryAd ad={ad} eager={position <= 1} />}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
