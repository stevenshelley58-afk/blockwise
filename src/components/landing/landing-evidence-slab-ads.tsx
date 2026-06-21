"use client";

import type { ImgHTMLAttributes } from "react";
import { useEffect, useMemo, useState } from "react";

import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

type EvidenceState =
  | { status: "loading" }
  | { status: "ready"; cards: PublicAdRadarCard[]; areaLabel: string | null }
  | { status: "empty" };

type LandingEvidenceSlabAdsProps = {
  initialLocation?: string;
  limit?: number;
};

const DEFAULT_LOCATION = "Perth, WA";
const DEFAULT_LIMIT = 4;
const MAX_VISIBLE_CARDS = 4;

export function LandingEvidenceSlabAds({
  initialLocation = DEFAULT_LOCATION,
  limit = DEFAULT_LIMIT,
}: LandingEvidenceSlabAdsProps) {
  const visibleLimit = Math.max(1, Math.min(limit, MAX_VISIBLE_CARDS));
  const [state, setState] = useState<EvidenceState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      try {
        const payload = await fetchEvidenceAds(initialLocation, visibleLimit, controller.signal);
        let cards = pickDisplayCards(payload.ads, visibleLimit);
        let areaLabel = payload.location.matched ? payload.location.label : null;

        if (cards.length === 0 && initialLocation.trim()) {
          const fallback = await fetchEvidenceAds("", visibleLimit, controller.signal);
          cards = pickDisplayCards(fallback.ads, visibleLimit);
          areaLabel = null;
        }

        if (!active || controller.signal.aborted) return;

        if (cards.length === 0) {
          setState({ status: "empty" });
          return;
        }

        setSelectedId((current) => (current && cards.some((card) => card.id === current) ? current : cards[0].id));
        setState({ status: "ready", cards, areaLabel });
      } catch {
        if (active && !controller.signal.aborted) setState({ status: "empty" });
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [initialLocation, visibleLimit]);

  const selectedCard = useMemo(() => {
    if (state.status !== "ready") return null;
    return state.cards.find((card) => card.id === selectedId) ?? state.cards[0] ?? null;
  }, [selectedId, state]);

  const cards = state.status === "ready" ? state.cards : [];
  const areaLabel = state.status === "ready" ? state.areaLabel : null;
  const selectedPlace = selectedCard ? formatPlace(selectedCard, areaLabel) : (areaLabel ?? "Australia");

  return (
    <section className="lp-evidence" aria-label="Live ad evidence preview">
      <div className="lp-shell lp-evidence-board">
        <article className="lp-evidence-main" aria-live="polite">
          <div className="lp-evidence-creative">
            <div className="lp-evidence-creative-top" aria-hidden>
              <span>Meta creative</span>
              <span>{selectedCard?.durationLabel ?? "Live data"}</span>
            </div>
            <div className="lp-evidence-main-media">
              {selectedCard ? (
                <AdCreativeImage
                  card={selectedCard}
                  className="lp-evidence-main-img"
                  loading="eager"
                  fetchPriority="high"
                />
              ) : (
                <span className="lp-evidence-media-placeholder" />
              )}
            </div>
            <div className="lp-evidence-signal" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="lp-evidence-main-copy">
            <div className="lp-evidence-kicker-row">
              <span className="lp-evidence-kicker">Market scan</span>
              <span className="lp-evidence-live">Live</span>
            </div>
            <h2>{selectedCard?.headline ?? selectedCard?.pageName ?? "Real local ads, ready when the page is."}</h2>
            <p>
              {selectedCard?.body
                ? truncate(selectedCard.body, 132)
                : state.status === "empty"
                  ? "Live examples are temporarily unavailable. You can still scan a suburb above."
                  : "The page paints first, then the real Meta Ad Library examples load in quietly."}
            </p>
            <div className="lp-evidence-metrics" aria-label="Selected ad details">
              <span>{selectedCard?.durationLabel ?? "Cached public data"}</span>
              <span>{selectedPlace}</span>
              <span>{selectedCard?.cta ?? "CTA detected"}</span>
            </div>
            {selectedCard ? (
              <a className="lp-evidence-action" href={signupHref(selectedCard, areaLabel)}>
                Build from this angle
              </a>
            ) : null}
          </div>
        </article>

        <div className="lp-evidence-side">
          <div className="lp-evidence-side-head">
            <span className="lp-evidence-area">{areaLabel ?? "Active market examples"}</span>
            <strong>{cards.length > 0 ? `${cards.length} real ads` : "Loading real ads"}</strong>
          </div>
          <div className="lp-evidence-strip">
            {cards.length > 0
              ? cards.map((card, index) => (
                  <EvidenceTile
                    active={card.id === selectedCard?.id}
                    card={card}
                    index={index}
                    key={card.id}
                    onChoose={() => setSelectedId(card.id)}
                  />
                ))
              : Array.from({ length: visibleLimit }).map((_, index) => (
                  <span className="lp-evidence-tile lp-evidence-tile-skeleton" key={index}>
                    <span />
                    <span />
                    <span />
                  </span>
                ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidenceTile({
  active,
  card,
  index,
  onChoose,
}: {
  active: boolean;
  card: PublicAdRadarCard;
  index: number;
  onChoose: () => void;
}) {
  return (
    <button aria-pressed={active} className="lp-evidence-tile" onClick={onChoose} type="button">
      <span className="lp-evidence-tile-rank">{String(index + 1).padStart(2, "0")}</span>
      <span className="lp-evidence-tile-media">
        <AdCreativeImage card={card} loading={index === 0 ? "eager" : "lazy"} />
      </span>
      <span className="lp-evidence-tile-copy">
        <b>{card.pageName}</b>
        <small>{card.durationLabel ?? formatActiveStatus(card.activeStatus)}</small>
      </span>
    </button>
  );
}

function AdCreativeImage({
  card,
  className,
  onError,
  onLoad,
  ...props
}: {
  card: PublicAdRadarCard;
} & ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const creative = cardCreativeImage(card);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [creative]);

  useEffect(() => {
    if (!creative || failed || loaded) return undefined;
    const timer = window.setTimeout(() => setFailed(true), 2500);
    return () => window.clearTimeout(timer);
  }, [creative, failed, loaded]);

  if (!creative || failed) {
    return (
      <span className={["lp-evidence-textonly", className].filter(Boolean).join(" ")}>
        <b>{card.headline ?? card.pageName}</b>
        <small>{card.cta ?? card.durationLabel ?? "Text ad"}</small>
      </span>
    );
  }

  // Meta CDN thumbnails are short-lived signed URLs; next/image optimization can break them.
  return (
    <img
      alt=""
      className={className}
      decoding="async"
      draggable={false}
      onError={(event) => {
        onError?.(event);
        setFailed(true);
      }}
      onLoad={(event) => {
        onLoad?.(event);
        setLoaded(true);
      }}
      src={creative}
      {...props}
    />
  );
}

function cardCreativeImage(card: PublicAdRadarCard): string | null {
  for (const media of card.media) {
    if (media.kind === "image") return media.url;
    if (media.posterUrl) return media.posterUrl;
  }
  return null;
}

function pickDisplayCards(cards: PublicAdRadarCard[], count: number): PublicAdRadarCard[] {
  const withMedia = cards.filter((card) => cardCreativeImage(card) !== null);
  const withoutMedia = cards.filter((card) => cardCreativeImage(card) === null);
  return [...withMedia, ...withoutMedia].slice(0, count);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}...`;
}

function formatActiveStatus(status: PublicAdRadarCard["activeStatus"]): string {
  if (status === "active") return "Active now";
  if (status === "inactive") return "Recently seen";
  return "Tracked ad";
}

function formatPlace(card: PublicAdRadarCard, areaLabel: string | null): string {
  const region = [card.suburb, card.state].filter(Boolean).join(", ");
  const place = card.postcode ? `${region} ${card.postcode}`.trim() : region;
  return place || areaLabel || "Australia";
}

function signupHref(card: PublicAdRadarCard, areaLabel: string | null): string {
  const params = new URLSearchParams({ source: "landing-evidence", adRef: card.id });
  if (areaLabel) params.set("market", areaLabel);
  const angle = card.headline ?? card.body?.slice(0, 120) ?? card.pageName;
  if (angle) params.set("angle", angle);
  return `/signup?${params.toString()}`;
}

async function fetchEvidenceAds(location: string, limit: number, signal: AbortSignal): Promise<PublicAdRadarResponse> {
  const params = new URLSearchParams({
    includeSurrounding: "0",
    limit: String(limit),
    sort: "longest",
  });
  if (location.trim()) params.set("location", location.trim());

  const response = await fetch(`/api/research/local-ad-radar?${params.toString()}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? "Could not load evidence ads.");
  return payload as PublicAdRadarResponse;
}
