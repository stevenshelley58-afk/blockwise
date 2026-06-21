"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

type SlabState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; cards: PublicAdRadarCard[]; areaLabel: string | null };

type LandingEvidenceSlabAdsProps = {
  /** Area to seed the slab with. Falls back to longest-running coverage if thin. */
  initialLocation?: string;
  /** Max number of real ads to pull into the deck. */
  limit?: number;
};

/** Browsers that support same-document morphing expose this on `document`. */
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

const MIN_CARDS = 3;
const MAX_VISIBLE_LAYERS = 4; // front creative + 3 peeking behind it
const AUTO_ADVANCE_MS = 4800;

/**
 * "Evidence slab" — real Meta Ad Library creative rendered as a layered 3D
 * object, paired with a readout that explains one ad at a time (advertiser,
 * headline, body, CTA, area, how long it has run). Replaces the placeholder
 * live-ads marquee. Never invents ads: it shows a skeleton while loading,
 * backfills with longest-running coverage, drops creatives that fail to load,
 * and collapses to nothing if no real ad with creative is available.
 *
 * Backend is unchanged — this reads the existing /api/research/local-ad-radar.
 */
export function LandingEvidenceSlabAds({
  initialLocation = "Perth, WA",
  limit = 7,
}: LandingEvidenceSlabAdsProps) {
  const [state, setState] = useState<SlabState>({ status: "loading" });
  // Track the selection by stable card id, not position, so it stays pinned to
  // the same ad if the deck reindexes (e.g. a background creative fails to load).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Load real ads once on mount: the requested area first, then backfill with
  // the longest-running ads we track if the area is thin on creative.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      let cards: PublicAdRadarCard[] = [];
      let areaLabel: string | null = null;

      try {
        const area = await fetchRadarCards(initialLocation, limit, controller.signal);
        const areaCards = area.ads.filter(hasCreative);
        if (area.location.matched && areaCards.length > 0) {
          areaLabel = area.location.label;
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
      setState(usable.length > 0 ? { status: "ready", cards: usable, areaLabel } : { status: "empty" });
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialLocation, limit]);

  // Respect the visitor's motion preference (no auto-advance, no view transitions).
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
  const activeIndex = Math.max(0, cards.findIndex((card) => card.id === selectedId));

  // Seed the selection once the deck is ready, and recover if the selected card
  // later drops out (its creative failed to load) by falling back to the front.
  useEffect(() => {
    if (total > 0 && (selectedId === null || !cards.some((card) => card.id === selectedId))) {
      setSelectedId(cards[0].id);
    }
  }, [cards, total, selectedId]);

  // Ambient auto-advance through the deck while idle.
  useEffect(() => {
    if (total <= 1 || paused || reducedMotion) return;
    const id = window.setInterval(() => {
      setSelectedId((prev) => {
        const index = cards.findIndex((card) => card.id === prev);
        const next = ((index < 0 ? 0 : index) + 1) % cards.length;
        return cards[next]?.id ?? prev;
      });
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [cards, total, paused, reducedMotion]);

  function selectCard(id: string) {
    const doc = typeof document === "undefined" ? null : (document as DocumentWithViewTransition);
    // Progressive enhancement: morph the front creative + readout where the
    // browser supports it. flushSync keeps React's update inside the snapshot.
    if (!reducedMotion && doc?.startViewTransition) {
      doc.startViewTransition(() => flushSync(() => setSelectedId(id)));
    } else {
      setSelectedId(id);
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

  const activeCard = cards[activeIndex];

  return (
    <section className="lp-slab" aria-labelledby="lp-slab-title">
      <div className="lp-shell lp-slab-grid">
        <div
          className="lp-slab-stage"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="lp-slab-deck">
            {cards.map((card, index) => {
              const rel = (index - activeIndex + total) % total;
              const isActive = rel === 0;
              return (
                <button
                  key={card.id}
                  type="button"
                  className="lp-slab-layer"
                  data-active={isActive || undefined}
                  aria-hidden="true"
                  tabIndex={-1}
                  style={layerStyle(rel, total)}
                  onClick={() => selectCard(card.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="lp-slab-creative"
                    src={creativeUrl(card) ?? ""}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={() => handleCreativeError(card.id)}
                    style={isActive ? ({ viewTransitionName: "lp-slab-front" } as CSSProperties) : undefined}
                  />
                </button>
              );
            })}
          </div>

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
        </div>

        <SlabReadout
          areaLabel={state.areaLabel}
          card={activeCard}
          index={activeIndex}
          total={total}
        />
      </div>
    </section>
  );
}

function SlabReadout({
  card,
  areaLabel,
  index,
  total,
}: {
  card: PublicAdRadarCard;
  areaLabel: string | null;
  index: number;
  total: number;
}) {
  const place = formatPlace(card);
  const platforms = card.platforms.slice(0, 3).join(" · ");

  return (
    <div
      className="lp-slab-readout"
      aria-live="polite"
      style={{ viewTransitionName: "lp-slab-readout" } as CSSProperties}
    >
      <p className="lp-slab-eyebrow">
        <span className="lp-slab-eyebrow-dot" aria-hidden />
        Local Ad Radar
      </p>
      <h2 className="lp-slab-h2" id="lp-slab-title">
        {areaLabel ? `Real ads running near ${areaLabel}` : "Real ads we’re tracking right now"}
      </h2>
      <p className="lp-slab-intro">
        Pulled straight from the Meta Ad Library — this is what agents in the area are actually
        spending on today.
      </p>

      {/* key remounts on selection so the readout fades in as a single object.
          The live region is the stable wrapper above, so the swap is announced. */}
      <div className="lp-slab-card" key={card.id}>
        <div className="lp-slab-card-head">
          <Avatar card={card} />
          <div className="lp-slab-card-id">
            <span className="lp-slab-page">{card.pageName}</span>
            <span className="lp-slab-sub">
              Sponsored{card.destinationDomain ? ` · ${card.destinationDomain}` : ""}
            </span>
          </div>
          <StatusPill status={card.activeStatus} />
        </div>

        {card.headline ? <p className="lp-slab-headline">{card.headline}</p> : null}
        {card.body ? <p className="lp-slab-body">{truncate(card.body, 180)}</p> : null}

        <dl className="lp-slab-facts">
          {place ? <Fact label="Area" value={place} /> : null}
          {card.durationLabel ? <Fact label="Live" value={card.durationLabel} /> : null}
          {platforms ? <Fact label="Where" value={platforms} /> : null}
        </dl>

        <div className="lp-slab-actions">
          {card.cta ? <span className="lp-slab-cta-chip">{card.cta}</span> : null}
          <a className="lp-btn lp-btn-primary lp-slab-cta" href={signupHref(card, areaLabel)}>
            Build ads like this
          </a>
        </div>
      </div>

      <p className="lp-slab-counter" aria-hidden>
        {index + 1} / {total}
      </p>
    </div>
  );
}

function Avatar({ card }: { card: PublicAdRadarCard }) {
  if (card.pageImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="lp-slab-avatar" src={card.pageImageUrl} alt="" loading="lazy" />;
  }
  return (
    <span className="lp-slab-avatar-fallback" style={{ background: avatarColor(card.pageName) }}>
      {card.pageName.slice(0, 1).toUpperCase()}
    </span>
  );
}

function StatusPill({ status }: { status: PublicAdRadarCard["activeStatus"] }) {
  if (status === "active") return <span className="lp-badge lp-badge-active">Active now</span>;
  if (status === "inactive") return <span className="lp-badge lp-badge-neutral">Recently ran</span>;
  return null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="lp-slab-fact">
      <dt className="lp-slab-fact-label">{label}</dt>
      <dd className="lp-slab-fact-value">{value}</dd>
    </div>
  );
}

function SlabSkeleton() {
  return (
    <section className="lp-slab" aria-hidden>
      <div className="lp-shell lp-slab-grid">
        <div className="lp-slab-stage">
          <div className="lp-slab-skel-deck" />
        </div>
        <div className="lp-slab-readout">
          <div className="lp-slab-skel-line" style={{ width: "38%" }} />
          <div className="lp-slab-skel-line" style={{ width: "85%", height: 30, marginTop: 14 }} />
          <div className="lp-slab-skel-line" style={{ width: "66%", marginTop: 12 }} />
          <div className="lp-slab-skel-card" />
        </div>
      </div>
    </section>
  );
}

function layerStyle(rel: number, total: number): CSSProperties {
  const beyond = rel >= MAX_VISIBLE_LAYERS;
  const depth = Math.min(rel, MAX_VISIBLE_LAYERS);
  const translateX = depth * 30;
  const translateY = depth * 16;
  const translateZ = depth * -90;
  const scale = 1 - depth * 0.05;
  const opacity = beyond ? 0 : rel === 0 ? 1 : Math.max(0, 0.92 - depth * 0.16);

  return {
    transform: `translate3d(${translateX}px, ${translateY}px, ${translateZ}px) scale(${scale})`,
    opacity,
    zIndex: total - rel,
    pointerEvents: beyond ? "none" : "auto",
  };
}

function avatarColor(name: string): string {
  let hue = 0;
  for (let i = 0; i < name.length; i += 1) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hue}, 42%, 38%)`;
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

function formatPlace(card: PublicAdRadarCard): string | null {
  const region = [card.suburb, card.state].filter(Boolean).join(", ");
  const full = card.postcode ? `${region} ${card.postcode}`.trim() : region;
  return full || null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function mergeCards(existing: PublicAdRadarCard[], next: PublicAdRadarCard[]): PublicAdRadarCard[] {
  const seen = new Set(existing.map((card) => card.id));
  return [...existing, ...next.filter((card) => !seen.has(card.id))];
}

function signupHref(card: PublicAdRadarCard, areaLabel: string | null): string {
  const params = new URLSearchParams({ source: "landing-evidence", adRef: card.id });
  if (areaLabel) params.set("market", areaLabel);
  const angle = card.headline ?? card.body?.slice(0, 120) ?? card.pageName;
  if (angle) params.set("angle", angle);
  return `/signup?${params.toString()}`;
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
