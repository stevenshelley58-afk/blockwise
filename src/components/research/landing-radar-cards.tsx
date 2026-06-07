"use client";

import { useEffect, useState } from "react";

import { CtaLink } from "@/components/landing/cta-link";
import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

type LocationGuess = { label: string; searchTerm: string; source: "ip" | "fallback" | "query" };

type RadarState =
  | { status: "loading" }
  | { status: "ready"; cards: PublicAdRadarCard[]; areaLabel: string | null };

const CARD_COUNT = 3;

/**
 * Landing radar proof cards. Best-guess the visitor's area from IP and show
 * real scraped ads near them; fall back to the longest-running ads we track.
 * Never renders invented ads: skeletons while loading, one quiet line if the
 * radar API is unavailable.
 */
export function LandingRadarCards() {
  const [state, setState] = useState<RadarState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      let areaLabel: string | null = null;
      let cards: PublicAdRadarCard[] = [];

      try {
        const guess = await fetchLocationGuess(controller.signal);
        if (guess && guess.source === "ip") {
          const area = await fetchRadarCards(guess.searchTerm, controller.signal);
          if (area.location.matched && area.ads.length > 0) {
            areaLabel = area.location.label;
            cards = area.ads;
          }
        }
      } catch {
        // Fall through to the longest-running fallback.
      }

      try {
        if (cards.length < CARD_COUNT) {
          const longest = await fetchRadarCards("", controller.signal);
          cards = mergeCards(cards, longest.ads);
        }
      } catch {
        // Keep whatever loaded; zero cards renders the quiet empty line.
      }

      if (!active || controller.signal.aborted) return;
      setState({ status: "ready", cards: pickDisplayCards(cards, CARD_COUNT), areaLabel });
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="lp-radar-list" aria-hidden>
        {Array.from({ length: CARD_COUNT }).map((_, index) => (
          <div className="lp-radar-card lp-radar-skeleton" key={index}>
            <div className="lp-radar-thumb" />
            <div className="lp-radar-body">
              <span />
              <span />
              <span />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (state.cards.length === 0) {
    return (
      <p className="lp-radar-context">
        Live ad coverage is updating &mdash; scan a suburb above to see active ads in that area.
      </p>
    );
  }

  return (
    <>
      <p className="lp-radar-context" aria-live="polite">
        {state.areaLabel
          ? `Live ads from the Meta Ad Library near ${state.areaLabel}.`
          : "Longest-running ads from our Meta Ad Library coverage."}
      </p>
      <div className="lp-radar-list">
        {state.cards.map((card) => (
          <LandingRadarCard areaLabel={state.areaLabel} card={card} key={card.id} />
        ))}
      </div>
    </>
  );
}

function LandingRadarCard({ card, areaLabel }: { card: PublicAdRadarCard; areaLabel: string | null }) {
  const thumb = cardThumbUrl(card);

  return (
    <article className="lp-radar-card">
      {thumb ? (
        <div
          aria-label={`${card.pageName} ad creative`}
          className="lp-radar-thumb"
          role="img"
          style={{ backgroundImage: `url(${JSON.stringify(thumb)})` }}
        />
      ) : (
        <div aria-hidden className="lp-radar-thumb lp-radar-thumb-empty">
          {card.pageName.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="lp-radar-body">
        <div className="lp-radar-source">
          <strong>{card.pageName}</strong>
          <span>{card.platforms[0] ?? "Meta"}</span>
        </div>
        <h3>{cardHeadline(card)}</h3>
        <div className="lp-radar-meta">
          <span>{cardArea(card)}</span>
          <span>{cardRunning(card)}</span>
        </div>
        <CtaLink className="lp-radar-link" href={signupHref(card, areaLabel)} location="radar-use-angle">
          Use this angle &rarr;
        </CtaLink>
      </div>
    </article>
  );
}

function cardThumbUrl(card: PublicAdRadarCard): string | null {
  for (const media of card.media) {
    if (media.kind === "image") return media.url;
    if (media.posterUrl) return media.posterUrl;
  }
  return card.pageImageUrl;
}

function cardHeadline(card: PublicAdRadarCard): string {
  const text = card.headline ?? card.body ?? card.description ?? "Sponsored real estate campaign";
  return text.length > 96 ? `${text.slice(0, 92).trimEnd()}...` : text;
}

function cardArea(card: PublicAdRadarCard): string {
  return card.suburb ?? card.postcode ?? card.state ?? "Australia";
}

function cardRunning(card: PublicAdRadarCard): string {
  if (card.durationLabel) return card.durationLabel;
  return card.activeStatus === "active" ? "Active now" : "Recently seen";
}

function mergeCards(existing: PublicAdRadarCard[], next: PublicAdRadarCard[]): PublicAdRadarCard[] {
  const seen = new Set(existing.map((card) => card.id));
  return [...existing, ...next.filter((card) => !seen.has(card.id))];
}

/** Prefer cards that have a visible creative; text-only cards fill remaining slots. */
function pickDisplayCards(cards: PublicAdRadarCard[], count: number): PublicAdRadarCard[] {
  const withMedia = cards.filter((card) => cardThumbUrl(card) !== null);
  const withoutMedia = cards.filter((card) => cardThumbUrl(card) === null);
  return [...withMedia, ...withoutMedia].slice(0, count);
}

function signupHref(card: PublicAdRadarCard, areaLabel: string | null): string {
  const params = new URLSearchParams({ source: "local-ad-radar", adRef: card.id });
  if (areaLabel) params.set("market", areaLabel);
  const angle = card.headline ?? card.body?.slice(0, 120) ?? card.pageName;
  if (angle) params.set("angle", angle);
  return `/signup?${params.toString()}`;
}

async function fetchLocationGuess(signal: AbortSignal): Promise<LocationGuess | null> {
  const response = await fetch("/api/research/locations/guess", { signal });
  if (!response.ok) return null;
  const payload = (await response.json()) as { location?: LocationGuess };
  return payload.location ?? null;
}

async function fetchRadarCards(location: string, signal: AbortSignal): Promise<PublicAdRadarResponse> {
  const params = new URLSearchParams({ limit: "9", sort: "longest" });
  if (location) params.set("location", location);

  const response = await fetch(`/api/research/local-ad-radar?${params.toString()}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? "Could not load radar ads.");
  return payload as PublicAdRadarResponse;
}
