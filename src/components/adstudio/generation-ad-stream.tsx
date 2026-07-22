"use client";

import { ExternalLink, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

import {
  GENERATION_AD_BUFFER_LIMIT,
  GENERATION_AD_PAGE_SIZE,
  appendGenerationAds,
  generationAdMediaUrl,
  generationAdRadarHref,
} from "./generation-ad-stream-data";

type GenerationAdStreamProps = {
  location: string;
  quality: "fast" | "high";
  titleId: string;
};

type PrimedAds = {
  local: PublicAdRadarResponse;
  longest: PublicAdRadarResponse;
};

const primedAds = new Map<string, Promise<PrimedAds>>();
const PHASES = [
  "Preparing your ad copy",
  "Creating Feed and Story ads",
  "Running final checks",
] as const;

export function preloadGenerationAdStream(location: string): void {
  void getPrimedAds(location).catch(() => undefined);
}

export function GenerationAdStream({ location, quality, titleId }: GenerationAdStreamProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionPausedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<PublicAdRadarCard[]>([]);
  const [ads, setAds] = useState<PublicAdRadarCard[]>([]);
  const [locationLabel, setLocationLabel] = useState(location || "your area");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [fallbackAdded, setFallbackAdded] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [radarUnavailable, setRadarUnavailable] = useState(false);
  const [selectedAd, setSelectedAd] = useState<PublicAdRadarCard | null>(null);
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setPhaseIndex((value) => (value + 1) % PHASES.length), 14_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    void getPrimedAds(location)
      .then(({ local, longest }) => {
        if (!active) return;
        const localAds = local.ads;
        fallbackRef.current = longest.ads;
        setLocationLabel(local.location.label || location || "your area");
        setNextCursor(local.nextCursor);

        if (localAds.length > 0) {
          const combined = local.nextCursor ? localAds : appendGenerationAds(localAds, longest.ads);
          setAds(combined);
          setFallbackAdded(!local.nextCursor);
          setAllLoaded(!local.nextCursor);
        } else {
          setAds(longest.ads);
          setFallbackAdded(true);
          setAllLoaded(true);
          setLocationLabel(location || longest.location.label || "all locations");
        }
        setLoadingInitial(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadingInitial(false);
        setRadarUnavailable(true);
        setAllLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [location]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || allLoaded) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      if (nextCursor) {
        const next = await fetchAdPage(location, "recent", nextCursor);
        setAds((current) => appendGenerationAds(current, next.ads));
        setNextCursor(next.nextCursor);

        if (ads.length + next.ads.length >= GENERATION_AD_BUFFER_LIMIT) {
          setAllLoaded(true);
        } else if (!next.nextCursor) {
          setAds((current) => appendGenerationAds(current, fallbackRef.current));
          setFallbackAdded(true);
          setAllLoaded(true);
        }
      } else if (!fallbackAdded) {
        setAds((current) => appendGenerationAds(current, fallbackRef.current));
        setFallbackAdded(true);
        setAllLoaded(true);
      } else {
        setAllLoaded(true);
      }
    } catch {
      setRadarUnavailable(true);
      setAllLoaded(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [ads.length, allLoaded, fallbackAdded, location, nextCursor]);

  useEffect(() => {
    const viewportNode = viewportRef.current;
    if (!viewportNode || loadingInitial || ads.length === 0) return;
    const viewport: HTMLDivElement = viewportNode;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let frame = 0;
    let previous = performance.now();

    function move(timestamp: number) {
      const elapsed = Math.min(timestamp - previous, 64);
      previous = timestamp;

      if (!interactionPausedRef.current && document.visibilityState === "visible") {
        viewport.scrollLeft += elapsed * 0.026;

        if (!allLoaded && viewport.scrollWidth - viewport.scrollLeft - viewport.clientWidth < Math.max(1_400, viewport.clientWidth * 1.5)) {
          void loadMore();
        }

        if (allLoaded && ads.length > 1 && viewport.scrollLeft >= viewport.scrollWidth / 2) {
          viewport.scrollLeft -= viewport.scrollWidth / 2;
        }
      }

      frame = window.requestAnimationFrame(move);
    }

    frame = window.requestAnimationFrame(move);
    return () => window.cancelAnimationFrame(frame);
  }, [ads.length, allLoaded, loadMore, loadingInitial]);

  const displayAds = useMemo(() => (allLoaded && ads.length > 1 ? [...ads, ...ads] : ads), [ads, allLoaded]);
  const streamDescription = ads.length > 0
    ? `Showing ads around ${locationLabel}. When local results end, the longest-running property ads continue.`
    : "Ad Radar is preparing property ads while generation continues.";

  function chooseAd(card: PublicAdRadarCard, trigger: HTMLButtonElement) {
    selectedTriggerRef.current = trigger;
    setSelectedAd(card);
    window.setTimeout(() => stayButtonRef.current?.focus(), 0);
  }

  function closePrompt() {
    setSelectedAd(null);
    window.setTimeout(() => selectedTriggerRef.current?.focus(), 0);
  }

  return (
    <section className="studio-generation" aria-labelledby={titleId} aria-busy="true">
      <header className="studio-generation-head">
        <h2 id={titleId}>Your ad is being generated</h2>
        <p>{quality === "fast" ? "Usually ready in about a minute." : "High-quality ads usually take 2–3 minutes."} Browse Ad Radar while Blockwise works.</p>
        <div className="studio-generation-phase" role="status" aria-live="polite">
          <LoaderCircle aria-hidden size={17} />
          <span>{PHASES[phaseIndex]}</span>
        </div>
      </header>

      <div className="studio-generation-radar">
        <div className="studio-generation-radar-head">
          <div>
            <h3>{ads.length > 0 ? `Ads around ${locationLabel}` : "Loading Ad Radar"}</h3>
            <p>{streamDescription}</p>
          </div>
          {loadingMore ? <span className="studio-generation-more">Loading more</span> : null}
        </div>

        {loadingInitial ? (
          <div className="studio-generation-skeletons" aria-label="Loading local ads">
            {[0, 1, 2].map((item) => <span key={item} />)}
          </div>
        ) : null}

        {!loadingInitial && ads.length > 0 ? (
          <div
            className="studio-generation-viewport"
            ref={viewportRef}
            role="region"
            aria-label="Continuously scrolling property ads"
            tabIndex={0}
            onMouseEnter={() => { interactionPausedRef.current = true; }}
            onMouseLeave={() => { interactionPausedRef.current = false; }}
            onFocusCapture={() => { interactionPausedRef.current = true; }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) interactionPausedRef.current = false;
            }}
          >
            <div className="studio-generation-track">
              {displayAds.map((card, index) => (
                <GenerationAdCard
                  card={card}
                  eager={index < 2}
                  key={`${card.id}-${index >= ads.length ? "repeat" : "primary"}`}
                  onSelect={chooseAd}
                />
              ))}
            </div>
          </div>
        ) : null}

        {!loadingInitial && ads.length === 0 ? (
          <div className="studio-generation-empty">
            <ImageIcon aria-hidden size={22} />
            <strong>{radarUnavailable ? "Ad Radar is catching up" : "No local ads are available yet"}</strong>
            <p>Your ad generation is unaffected and will finish normally.</p>
          </div>
        ) : null}
      </div>

      {selectedAd ? (
        <div
          className="studio-generation-prompt-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && closePrompt()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closePrompt();
            }
          }}
        >
          <div className="studio-generation-prompt" role="group" aria-labelledby="studio-generation-prompt-title">
            <h3 id="studio-generation-prompt-title">Open this ad in Ad Radar?</h3>
            <p>Your ad will keep generating in the background.</p>
            <strong>{selectedAd.pageName}</strong>
            <div>
              <button ref={stayButtonRef} type="button" onClick={closePrompt}>Stay here</button>
              <a href={generationAdRadarHref(selectedAd, location)} target="_blank" rel="noreferrer" onClick={() => setSelectedAd(null)}>
                Open Ad Radar <ExternalLink aria-hidden size={14} />
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GenerationAdCard({
  card,
  eager,
  onSelect,
}: {
  card: PublicAdRadarCard;
  eager: boolean;
  onSelect: (card: PublicAdRadarCard, trigger: HTMLButtonElement) => void;
}) {
  const mediaUrl = generationAdMediaUrl(card);
  const location = [card.suburb, card.state].filter(Boolean).join(", ");
  const headline = card.headline || card.description || card.body || "Property campaign";

  return (
    <article className="studio-generation-card">
      <button type="button" onClick={(event) => onSelect(card, event.currentTarget)} aria-label={`View ${card.pageName} ad in Ad Radar`}>
        <span className="studio-generation-card-head">
          <span className="studio-generation-avatar">
            {card.pageImageUrl ? <img src={card.pageImageUrl} alt="" loading="lazy" decoding="async" /> : card.pageName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{card.pageName}</strong>
            <small>Sponsored{location ? ` · ${location}` : ""}</small>
          </span>
          <em>{card.activeStatus === "active" ? "Active" : "Ad"}</em>
        </span>
        <span className="studio-generation-card-copy">{headline}</span>
        <span className="studio-generation-card-media">
          {mediaUrl ? (
            <img
              src={mediaUrl}
              alt=""
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={eager ? "high" : "low"}
            />
          ) : (
            <span><ImageIcon aria-hidden size={28} /> Property ad</span>
          )}
        </span>
        <span className="studio-generation-card-foot">
          <strong>{card.durationLabel || "Recently seen"}</strong>
          <small>{card.platforms.slice(0, 2).join(" · ") || "Meta"}</small>
        </span>
      </button>
    </article>
  );
}

function getPrimedAds(location: string): Promise<PrimedAds> {
  const key = location.trim().toLowerCase();
  const cached = primedAds.get(key);
  if (cached) return cached;

  const request = Promise.allSettled([
    fetchAdPage(location, "recent", null),
    fetchAdPage("", "longest", null),
  ]).then(([localResult, longestResult]) => {
    if (localResult.status === "rejected" && longestResult.status === "rejected") throw localResult.reason;

    const local = localResult.status === "fulfilled"
      ? localResult.value
      : emptyAdResponse(location, location || "your area");
    const longest = longestResult.status === "fulfilled"
      ? longestResult.value
      : emptyAdResponse("", "All locations");
    return { local, longest };
  });
  primedAds.set(key, request);
  request.catch(() => primedAds.delete(key));
  return request;
}

async function fetchAdPage(location: string, sort: "recent" | "longest", cursor: string | null): Promise<PublicAdRadarResponse> {
  const params = new URLSearchParams({
    location,
    limit: String(GENERATION_AD_PAGE_SIZE),
    sort,
  });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`/api/research/local-ad-radar?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<PublicAdRadarResponse> & { error?: string };
  if (!response.ok || !payload.location || !Array.isArray(payload.ads)) {
    throw new Error(payload.error || "Ad Radar is unavailable.");
  }

  return payload as PublicAdRadarResponse;
}

function emptyAdResponse(query: string, label: string): PublicAdRadarResponse {
  return {
    location: { query, label, matched: false },
    ads: [],
    nextCursor: null,
    source: "scraped",
  };
}
