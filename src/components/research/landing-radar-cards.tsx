"use client";

import { useEffect, useState } from "react";

import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

type LocationGuess = { label: string; searchTerm: string; source: "ip" | "fallback" | "query" };

type RadarState =
  | { status: "loading" }
  | { status: "ready"; cards: PublicAdRadarCard[]; areaLabel: string | null };

const CARD_COUNT = 3;

/**
 * Landing radar proof cards. Best-guess the visitor's area from IP and show
 * real scraped ads near them; fall back to the longest-running ads we track.
 * Each card renders the same authentic Meta Ad Library unit as the /ad-radar
 * tool (status, platforms, Sponsored, primary text, creative, link preview) so
 * the landing proof matches the real product exactly. The whole card links to
 * signup. Never renders invented ads: skeletons while loading, one quiet line
 * if the radar API is unavailable.
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

/**
 * Renders a public radar card as the real Meta Ad Library ad unit. Mirrors
 * MetaAdLibraryCard from the /ad-radar tool, minus the fields the public API
 * does not expose (Library ID, page link) and minus the logged-in actions row.
 * The whole article is a single link to signup, so it contains no nested
 * anchors.
 */
function LandingRadarCard({ card, areaLabel }: { card: PublicAdRadarCard; areaLabel: string | null }) {
  const dateText = deliveryDateText(card.startedAt, card.stoppedAt);
  const statusLabel =
    card.activeStatus === "inactive" ? "Inactive" : card.activeStatus === "active" ? "Active" : "Unknown";
  const bodyText = cardBody(card);
  const creative = cardCreativeImage(card);
  const hasLinkPreview = Boolean(card.headline || card.description || card.cta || card.destinationDomain);

  return (
    <a className="lp-radar-ad-link" href={signupHref(card, areaLabel)} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <article className="meta-ad-card">
        <header className="meta-ad-headblock">
          <span className="meta-ad-status" data-status={card.activeStatus}>
            <span className="meta-ad-status-dot" aria-hidden />
            <span className="meta-ad-status-label">{statusLabel}</span>
          </span>
          {dateText ? <span className="meta-ad-headmeta">{dateText}</span> : null}
          {card.platforms.length > 0 ? (
            <div className="meta-ad-platforms">
              <span>Platforms</span>
              <span className="meta-ad-platform-icons">
                {card.platforms.map((platform) => (
                  <PlatformIcon key={platform} platform={platform} />
                ))}
              </span>
            </div>
          ) : null}
        </header>

        <div className="meta-ad-page">
          <PageAvatar card={card} />
          <div className="meta-ad-page-copy">
            <strong>{card.pageName}</strong>
            <span className="meta-ad-sponsored">Sponsored</span>
          </div>
        </div>

        {bodyText ? (
          <div className="meta-ad-card-body">
            <p className="meta-ad-primary-text">{bodyText}</p>
          </div>
        ) : null}

        {creative ? (
          <div className="meta-ad-media-frame meta-ad-media-frame--single">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="meta-ad-media"
              src={creative}
              alt={card.headline ?? `${card.pageName} ad creative`}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="meta-ad-text-only">
            <span>Text-only ad</span>
          </div>
        )}

        {hasLinkPreview ? (
          <div className="meta-ad-link-preview">
            <div className="meta-ad-link-copy">
              {card.destinationDomain ? (
                <span className="meta-ad-link-domain">{card.destinationDomain}</span>
              ) : null}
              {card.headline ? <h3>{card.headline}</h3> : null}
              {card.description ? <p>{card.description}</p> : null}
            </div>
            {card.cta ? <span className="meta-ad-card-cta">{card.cta}</span> : null}
          </div>
        ) : null}
      </article>
    </a>
  );
}

function PageAvatar({ card }: { card: PublicAdRadarCard }) {
  if (card.pageImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="meta-ad-page-avatar" src={card.pageImageUrl} alt="" loading="lazy" />;
  }

  return <span className="meta-ad-page-avatar fallback">{card.pageName.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Platform glyphs, mirrored from the /ad-radar MetaAdLibraryCard so the landing
 * proof matches the product. Kept local to avoid pulling the tool's logged-in
 * action code into the public landing bundle.
 */
function PlatformIcon({ platform }: { platform: string }) {
  const key = platform.toLowerCase();

  if (key === "facebook") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={platform}>
        <title>{platform}</title>
        <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.69 4.54-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
      </svg>
    );
  }

  if (key === "instagram") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} role="img" aria-label={platform}>
        <title>{platform}</title>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
        <circle cx="12" cy="12" r="4.4" />
        <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (key === "messenger") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={platform}>
        <title>{platform}</title>
        <path d="M12 0C5.24 0 0 4.95 0 11.64c0 3.5 1.43 6.52 3.77 8.6.2.18.32.43.32.7l.06 2.15c.02.69.72 1.13 1.35.85l2.4-1.06c.2-.09.43-.11.65-.05 1.1.3 2.26.46 3.45.46 6.76 0 12-4.95 12-11.64S18.76 0 12 0zm7.2 8.93l-3.52 5.6c-.56.88-1.76 1.1-2.6.48l-2.8-2.1a.72.72 0 00-.86 0l-3.78 2.87c-.5.38-1.16-.22-.82-.75l3.52-5.6c.56-.88 1.76-1.1 2.6-.48l2.8 2.1c.26.19.6.19.86 0l3.78-2.86c.5-.39 1.16.2.82.73z" />
      </svg>
    );
  }

  if (key === "audience network") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} role="img" aria-label={platform}>
        <title>{platform}</title>
        <circle cx="12" cy="12" r="9.3" />
        <path d="M2.7 12h18.6M12 2.7c2.7 2.9 2.7 15.7 0 18.6M12 2.7c-2.7 2.9-2.7 15.7 0 18.6" />
      </svg>
    );
  }

  return <span className="meta-ad-platform-chip">{platform}</span>;
}

function cardCreativeImage(card: PublicAdRadarCard): string | null {
  for (const media of card.media) {
    if (media.kind === "image") return media.url;
    if (media.posterUrl) return media.posterUrl;
  }
  return null;
}

function cardBody(card: PublicAdRadarCard): string | null {
  if (!card.body) return null;
  return card.body.length > 320 ? `${card.body.slice(0, 300).trim()}...` : card.body;
}

function deliveryDateText(startedAt: string | null, stoppedAt: string | null): string | null {
  const started = formatDate(startedAt);
  const stopped = formatDate(stoppedAt);

  if (started && stopped) return `Started running on ${started} · Stopped ${stopped}`;
  if (started) return `Started running on ${started}`;
  if (stopped) return `Stopped running on ${stopped}`;
  return null;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function mergeCards(existing: PublicAdRadarCard[], next: PublicAdRadarCard[]): PublicAdRadarCard[] {
  const seen = new Set(existing.map((card) => card.id));
  return [...existing, ...next.filter((card) => !seen.has(card.id))];
}

/** Prefer cards that have a visible creative; text-only cards fill remaining slots. */
function pickDisplayCards(cards: PublicAdRadarCard[], count: number): PublicAdRadarCard[] {
  const withMedia = cards.filter((card) => cardCreativeImage(card) !== null);
  const withoutMedia = cards.filter((card) => cardCreativeImage(card) === null);
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
