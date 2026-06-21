"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

type SlabState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; cards: PublicAdRadarCard[] };

/** How the stacked images react to scroll. Overridable per-visit with ?slab=. */
type SlabMode = "fan" | "scrub" | "reveal";

/** A style object that also carries CSS custom properties. */
type SlabStyle = CSSProperties & Record<`--${string}`, string | number>;

type LandingEvidenceSlabAdsProps = {
  /** Area to seed the slab with. Falls back to longest-running coverage if thin. */
  initialLocation?: string;
  /** Max number of real ads to pull into the deck. */
  limit?: number;
  /** Default scroll behaviour. Overridable per-visit with ?slab=fan|scrub|reveal. */
  mode?: SlabMode;
};

/** Browsers that support same-document morphing expose this on `document`. */
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

const MIN_CARDS = 3;
const MAX_VISIBLE_LAYERS = 5; // front creative + 4 peeking behind it
const SLAB_MODES: readonly SlabMode[] = ["fan", "scrub", "reveal"];
const DEFAULT_MODE: SlabMode = "scrub";

/* Scroll-mode styles, scoped to the slab and injected here (like the page's
   "How it works" CSS) so the whole visual ships with the component and
   landing.css stays untouched. These also override a few base rules to make the
   deck span the page with more depth, and to keep shadows cheap to paint. */
const SLAB_SCROLL_CSS = `
.lp-slab { position: relative; }

/* Full-width single column now that the readout panel is gone. */
.lp-slab-grid { grid-template-columns: 1fr; justify-items: center; }
.lp-slab-stage { width: 100%; perspective: 2000px; min-height: clamp(440px, 46vw, 600px); padding: 36px 40px 64px; }
.lp-slab-deck { width: min(560px, 86%); }

/* Cheaper, layered shadows (the heavy base shadow repainted on every layer was
   a big part of the scroll cost). */
.lp-slab-layer { box-shadow: 0 14px 34px -20px rgba(15, 23, 42, 0.5); will-change: transform; }
.lp-slab-layer[data-active] { box-shadow: 0 42px 84px -34px rgba(0, 107, 255, 0.45), 0 10px 26px -16px rgba(15, 23, 42, 0.32); }
.lp-slab-creative { content-visibility: auto; }

/* SCRUB - the deck advances through the stack as the section scrolls past. */
.lp-slab--scrub .lp-slab-deck { animation: none; }
.lp-slab--scrub .lp-slab-layer { transition: transform .4s cubic-bezier(.22,.61,.36,1), opacity .35s ease; }
.lp-slab-scrollhint { position: absolute; left: 50%; bottom: 2px; transform: translateX(-50%); margin: 0; white-space: nowrap; font-size: 12px; font-weight: 650; letter-spacing: .02em; color: var(--lp-faint); }

/* FAN - the collapsed stack spreads into a hand of cards with scroll progress. */
.lp-slab--fan .lp-slab-deck { animation: none; transform: none; width: min(640px, 92%); }
.lp-slab--fan .lp-slab-layer {
  transform-origin: 50% 92%;
  transform: translateX(calc((var(--index) - var(--mid)) * var(--p, 0) * 70px)) rotate(calc((var(--index) - var(--mid)) * var(--p, 0) * 6deg));
  opacity: 1; pointer-events: auto; transition: transform .2s ease-out;
}

/* REVEAL - the stack fades and lifts in once, then browse with the dots. */
.lp-slab--reveal .lp-slab-deck { animation: none; opacity: 0; transform: rotateY(-18deg) rotateX(6deg) translateY(30px); transition: opacity .6s ease, transform .6s cubic-bezier(.22,.61,.36,1); }
.lp-slab--reveal.is-revealed .lp-slab-deck { opacity: 1; transform: rotateY(-18deg) rotateX(6deg) translateY(0); }

/* Test-only switcher (only rendered when the URL has ?slabtest=1). */
.lp-slab-switcher { position: absolute; top: 14px; right: 16px; z-index: 30; display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 999px; background: rgba(255,255,255,0.92); border: 1px solid var(--lp-border); box-shadow: var(--lp-shadow-soft); font-size: 12px; font-weight: 700; color: var(--lp-ink); }
.lp-slab-switcher span { color: var(--lp-faint); padding-left: 4px; }
.lp-slab-switcher button { border: 0; border-radius: 999px; padding: 5px 11px; cursor: pointer; background: var(--lp-surface); color: var(--lp-muted); font: inherit; text-transform: capitalize; }
.lp-slab-switcher button[data-active] { background: var(--hero-accent); color: #fff; }

@media (max-width: 900px) {
  .lp-slab-deck { width: min(440px, 90%); }
  .lp-slab--fan .lp-slab-layer { transform: translateX(calc((var(--index) - var(--mid)) * var(--p, 0) * 40px)) rotate(calc((var(--index) - var(--mid)) * var(--p, 0) * 5deg)); }
  .lp-slab-switcher { top: 10px; right: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .lp-slab--scrub .lp-slab-layer, .lp-slab--fan .lp-slab-layer, .lp-slab--reveal .lp-slab-deck { transition: none; }
  .lp-slab--reveal .lp-slab-deck { opacity: 1; transform: rotateY(-18deg) rotateX(6deg); }
}
`;

/**
 * "Evidence slab" — real Meta Ad Library creative rendered as a deep, layered
 * stack of images that the visitor flips through by scrolling. Three scroll
 * behaviours are available for review and can be flipped live with ?slabtest=1:
 *   - fan:    the collapsed stack spreads into a hand of cards as you scroll in.
 *   - scrub:  the deck advances through the stack tied to scroll progress.
 *   - reveal: the stack fades and lifts in once, then you browse with the dots.
 *
 * Never invents ads: skeleton while loading, longest-running backfill, drops
 * creatives that fail to load, collapses to nothing if no real ad is available.
 * Backend is unchanged — this reads the existing /api/research/local-ad-radar.
 */
export function LandingEvidenceSlabAds({
  initialLocation = "Perth, WA",
  limit = 7,
  mode: modeProp = DEFAULT_MODE,
}: LandingEvidenceSlabAdsProps) {
  const [state, setState] = useState<SlabState>({ status: "loading" });
  // Track the selection by stable card id, not position, so it stays pinned to
  // the same ad if the deck reindexes (e.g. a background creative fails to load).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Scroll behaviour + the test switcher are read from the URL on the client so
  // the page can stay a server component (no useSearchParams Suspense needed).
  const [mode, setMode] = useState<SlabMode>(modeProp);
  const [showSwitcher, setShowSwitcher] = useState(false);

  // Scroll-driven state.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const [scrollIndex, setScrollIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("slab");
    if (requested && (SLAB_MODES as readonly string[]).includes(requested)) {
      setMode(requested as SlabMode);
    }
    if (params.get("slabtest") === "1") setShowSwitcher(true);
  }, []);

  // Load real ads once on mount: the requested area first, then backfill with
  // the longest-running ads we track if the area is thin on creative.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      let cards: PublicAdRadarCard[] = [];

      try {
        const area = await fetchRadarCards(initialLocation, limit, controller.signal);
        const areaCards = area.ads.filter(hasCreative);
        if (area.location.matched && areaCards.length > 0) {
          cards = areaCards;
        }
      } catch {
        // Fall through to the longest-running backfill.
      }

      if (cards.length < MIN_CARDS) {
        try {
          const longest = await fetchRadarCards("", limit, controller.signal);
          cards = mergeCards(cards, longest.ads.filter(hasCreative));
        } catch {
          // Keep whatever loaded.
        }
      }

      if (!active || controller.signal.aborted) return;
      const usable = cards.slice(0, limit);
      setState(usable.length > 0 ? { status: "ready", cards: usable } : { status: "empty" });
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialLocation, limit]);

  // Respect the visitor's motion preference (no view transitions, instant reveal).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const cards = state.status === "ready" ? state.cards : [];
  const total = cards.length;

  // Seed the click selection (used by fan + reveal browsing) and recover if the
  // selected card later drops out because its creative failed to load.
  useEffect(() => {
    if (total > 0 && (selectedId === null || !cards.some((card) => card.id === selectedId))) {
      setSelectedId(cards[0].id);
    }
  }, [cards, total, selectedId]);

  // Reduced motion shows the reveal entrance immediately.
  useEffect(() => {
    if (reducedMotion) setRevealed(true);
  }, [reducedMotion]);

  // Scroll engine: turn the stage's progress through the viewport into the
  // active card (scrub), a fan spread (--p), or a one-shot reveal. rAF-throttled
  // and only re-renders React when the rounded scrub index actually changes.
  useEffect(() => {
    if (total === 0 || typeof window === "undefined") return;
    const stage = stageRef.current;
    if (!stage) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = stage.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const start = viewport * 0.9;
      const end = viewport * 0.25;
      const progress = clamp((start - rect.top) / (start - end), 0, 1);

      if (mode === "fan") {
        if (deckRef.current) deckRef.current.style.setProperty("--p", progress.toFixed(4));
      } else if (mode === "scrub") {
        const next = Math.round(progress * (total - 1));
        setScrollIndex((prev) => (prev === next ? prev : next));
      } else if (progress > 0.12) {
        setRevealed(true);
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [mode, total]);

  function selectCard(id: string) {
    const doc = typeof document === "undefined" ? null : (document as DocumentWithViewTransition);
    // Progressive enhancement: morph the front creative where the browser
    // supports it. flushSync keeps React's update inside the snapshot.
    if (!reducedMotion && doc?.startViewTransition) {
      doc.startViewTransition(() => flushSync(() => setSelectedId(id)));
    } else {
      setSelectedId(id);
    }
  }

  function switchMode(next: SlabMode) {
    setMode(next);
    setRevealed(reducedMotion);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("slab", next);
      url.searchParams.set("slabtest", "1");
      window.history.replaceState(null, "", url.toString());
    }
  }

  function handleCreativeError(cardId: string) {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const next = prev.cards.filter((card) => card.id !== cardId);
      return next.length > 0 ? { ...prev, cards: next } : { status: "empty" };
    });
  }

  if (state.status === "loading") return <SlabSkeleton />;
  if (state.status === "empty") return null;

  const selectedIndex = Math.max(0, cards.findIndex((card) => card.id === selectedId));
  const activeIndex =
    mode === "scrub" ? Math.min(Math.max(scrollIndex, 0), total - 1) : selectedIndex;

  const sectionClass = ["lp-slab", `lp-slab--${mode}`, revealed ? "is-revealed" : "", reducedMotion ? "is-reduced" : ""]
    .filter(Boolean)
    .join(" ");

  const deckStyle: SlabStyle = { "--mid": (total - 1) / 2, "--n": total };

  return (
    <section className={sectionClass} aria-label="Real local ads from the Meta Ad Library">
      <style dangerouslySetInnerHTML={{ __html: SLAB_SCROLL_CSS }} />
      <div className="lp-shell lp-slab-grid">
        <div className="lp-slab-stage" ref={stageRef}>
          <div className="lp-slab-deck" ref={deckRef} style={deckStyle}>
            {cards.map((card, index) => {
              const rel = (index - activeIndex + total) % total;
              const isActive = index === activeIndex;
              return (
                <button
                  key={card.id}
                  type="button"
                  className="lp-slab-layer"
                  data-active={isActive || undefined}
                  aria-hidden="true"
                  tabIndex={-1}
                  style={mode === "fan" ? fanLayerStyle(index, total) : deckLayerStyle(rel, total)}
                  onClick={() => selectCard(card.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="lp-slab-creative"
                    src={creativeUrl(card) ?? ""}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={() => handleCreativeError(card.id)}
                    style={isActive ? ({ viewTransitionName: "lp-slab-front" } as CSSProperties) : undefined}
                  />
                </button>
              );
            })}
          </div>

          {mode === "scrub" ? (
            <p className="lp-slab-scrollhint" aria-hidden>
              Keep scrolling to flip through {total} real ads
            </p>
          ) : (
            <div className="lp-slab-dots" role="group" aria-label="Choose a local ad to inspect">
              {cards.map((card, index) => (
                <button
                  key={card.id}
                  type="button"
                  className="lp-slab-dot"
                  data-active={index === activeIndex || undefined}
                  aria-pressed={index === activeIndex}
                  aria-label={`Show the ad from ${card.pageName}`}
                  onClick={() => selectCard(card.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showSwitcher ? (
        <div className="lp-slab-switcher" role="group" aria-label="Scroll behaviour (test only)">
          <span>Scroll test</span>
          {SLAB_MODES.map((option) => (
            <button
              key={option}
              type="button"
              data-active={option === mode || undefined}
              onClick={() => switchMode(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SlabSkeleton() {
  return (
    <section className="lp-slab lp-slab--scrub" aria-hidden>
      <style dangerouslySetInnerHTML={{ __html: SLAB_SCROLL_CSS }} />
      <div className="lp-shell lp-slab-grid">
        <div className="lp-slab-stage">
          <div className="lp-slab-skel-deck" />
        </div>
      </div>
    </section>
  );
}

/** Deck layout (scrub + reveal): front creative with several peeking behind, in a wide, deep cascade. */
function deckLayerStyle(rel: number, total: number): CSSProperties {
  const beyond = rel >= MAX_VISIBLE_LAYERS;
  const depth = Math.min(rel, MAX_VISIBLE_LAYERS);
  const translateX = depth * 62;
  const translateY = depth * 22;
  const translateZ = depth * -120;
  const scale = 1 - depth * 0.06;
  const opacity = beyond ? 0 : rel === 0 ? 1 : Math.max(0, 0.9 - depth * 0.15);

  return {
    transform: `translate3d(${translateX}px, ${translateY}px, ${translateZ}px) scale(${scale})`,
    opacity,
    zIndex: total - rel,
    pointerEvents: beyond ? "none" : "auto",
  };
}

/** Fan layout: the actual spread/rotation is computed in CSS from --index/--mid/--p. */
function fanLayerStyle(index: number, total: number): SlabStyle {
  const mid = (total - 1) / 2;
  return {
    "--index": index,
    zIndex: total - Math.round(Math.abs(index - mid)),
  };
}

function creativeUrl(card: PublicAdRadarCard): string | null {
  for (const media of card.media) {
    if (media.kind === "image") return media.url;
    if (media.posterUrl) return media.posterUrl;
  }
  return null;
}

function hasCreative(card: PublicAdRadarCard): boolean {
  return creativeUrl(card) !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mergeCards(existing: PublicAdRadarCard[], next: PublicAdRadarCard[]): PublicAdRadarCard[] {
  const seen = new Set(existing.map((card) => card.id));
  return [...existing, ...next.filter((card) => !seen.has(card.id))];
}

async function fetchRadarCards(
  location: string,
  limit: number,
  signal: AbortSignal,
): Promise<PublicAdRadarResponse> {
  const params = new URLSearchParams({ limit: String(limit), sort: "longest" });
  if (location) params.set("location", location);

  const response = await fetch(`/api/research/local-ad-radar?${params.toString()}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error((payload as { error?: string })?.error ?? "Could not load ads.");
  return payload as PublicAdRadarResponse;
}
