"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

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

const MIN_CARDS = 3;
const MIN_CREATIVE_EDGE_PX = 240;
const MAX_VISIBLE_LAYERS = 4; // front creative + 3 peeking behind it
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
.lp-slab-stage { width: 100%; perspective: 1800px; min-height: clamp(400px, 41vw, 540px); padding: 28px 40px 56px; }
.lp-slab-stage::after { filter: none; opacity: .7; }
.lp-slab-deck { width: min(460px, 82%); }

/* Cheaper, layered shadows (the heavy base shadow repainted on every layer was
   a big part of the scroll cost). */
.lp-slab-layer { box-shadow: 0 12px 28px -20px rgba(15, 23, 42, 0.48); backface-visibility: hidden; contain: paint; will-change: transform; }
.lp-slab-layer[data-active] { box-shadow: 0 34px 64px -34px rgba(0, 107, 255, 0.44), 0 8px 18px -14px rgba(15, 23, 42, 0.32); }
.lp-slab-creative { content-visibility: auto; object-fit: contain; background: #f8fafc; image-rendering: auto; }
.lp-slab-creative-placeholder { display: block; background: #eef2f7; }

/* SCRUB - the deck advances through the stack as the section scrolls past. */
.lp-slab--scrub { min-height: max(1040px, 185vh); overflow: visible; }
.lp-slab--scrub .lp-slab-grid { position: sticky; top: clamp(76px, 11vh, 116px); }
.lp-slab--scrub .lp-slab-deck { animation: none; transform: none; }
.lp-slab--scrub .lp-slab-layer { transition: transform .28s cubic-bezier(.22,.61,.36,1), opacity .24s ease; }
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
  .lp-slab--scrub { min-height: max(840px, 165vh); }
  .lp-slab--scrub .lp-slab-grid { top: 74px; }
  .lp-slab-stage { min-height: clamp(360px, 86vw, 480px); padding-inline: 28px; }
  .lp-slab-deck { width: min(390px, 86%); }
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
  const requestedLimit = Math.max(MIN_CARDS, Math.min(limit, 7));
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
  const sectionRef = useRef<HTMLElement | null>(null);
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
        const area = await fetchRadarCards(initialLocation, requestedLimit, controller.signal);
        const areaCards = area.ads.filter(hasCreative);
        if (area.location.matched && areaCards.length > 0) {
          cards = areaCards;
        }
      } catch {
        // Fall through to the longest-running backfill.
      }

      if (cards.length < MIN_CARDS) {
        try {
          const longest = await fetchRadarCards("", requestedLimit, controller.signal);
          cards = mergeCards(cards, longest.ads.filter(hasCreative));
        } catch {
          // Keep whatever loaded.
        }
      }

      if (!active || controller.signal.aborted) return;
      const usable = cards.slice(0, requestedLimit);
      setState(usable.length > 0 ? { status: "ready", cards: usable } : { status: "empty" });
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialLocation, requestedLimit]);

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
      const viewport = window.innerHeight || 1;
      const progress =
        mode === "scrub"
          ? sectionScrollProgress(sectionRef.current ?? stage, viewport)
          : viewportProgress(stage, viewport);

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
    setSelectedId(id);
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
    removeCard(cardId);
  }

  function handleCreativeLoad(cardId: string, image: HTMLImageElement) {
    const smallestEdge = Math.min(image.naturalWidth, image.naturalHeight);
    if (smallestEdge > 0 && smallestEdge < MIN_CREATIVE_EDGE_PX) removeCard(cardId);
  }

  function removeCard(cardId: string) {
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
    <section className={sectionClass} ref={sectionRef} aria-label="Real local ads from the Meta Ad Library">
      <style dangerouslySetInnerHTML={{ __html: SLAB_SCROLL_CSS }} />
      <div className="lp-shell lp-slab-grid">
        <div className="lp-slab-stage" ref={stageRef}>
          <div className="lp-slab-deck" data-active-index={activeIndex} ref={deckRef} style={deckStyle}>
            {cards.map((card, index) => {
              const rel = (index - activeIndex + total) % total;
              const isActive = index === activeIndex;
              const shouldRenderCreative = mode === "fan" || rel < MAX_VISIBLE_LAYERS;
              const creative = shouldRenderCreative ? creativeUrl(card) : null;
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
                  {creative ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="lp-slab-creative"
                      src={creative}
                      alt=""
                      loading={isActive ? "eager" : "lazy"}
                      fetchPriority={isActive ? "high" : "low"}
                      decoding="async"
                      draggable={false}
                      onLoad={(event) => handleCreativeLoad(card.id, event.currentTarget)}
                      onError={() => handleCreativeError(card.id)}
                    />
                  ) : (
                    <span className="lp-slab-creative lp-slab-creative-placeholder" aria-hidden />
                  )}
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
  const translateX = depth * 52;
  const translateY = depth * 18;
  const translateZ = depth * -92;
  const scale = 1 - depth * 0.055;
  const opacity = beyond ? 0 : rel === 0 ? 1 : Math.max(0, 0.92 - depth * 0.16);

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

function viewportProgress(element: HTMLElement, viewport: number): number {
  const rect = element.getBoundingClientRect();
  const start = viewport * 0.9;
  const end = viewport * 0.25;
  return clamp((start - rect.top) / (start - end), 0, 1);
}

function sectionScrollProgress(element: HTMLElement, viewport: number): number {
  const rect = element.getBoundingClientRect();
  const stickyOffset = clamp(viewport * 0.11, 76, 116);
  const travel = Math.max(rect.height - viewport, viewport * 0.55);
  return clamp((stickyOffset - rect.top) / travel, 0, 1);
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
  const params = new URLSearchParams({ includeSurrounding: "0", limit: String(limit), sort: "longest" });
  if (location) params.set("location", location);

  const response = await fetch(`/api/research/local-ad-radar?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error((payload as { error?: string })?.error ?? "Could not load ads.");
  return payload as PublicAdRadarResponse;
}
