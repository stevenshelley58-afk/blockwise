"use client";

import { ExternalLink, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { PublicAdRadarCard, PublicAdRadarResponse, PublicAdRadarSort } from "@/lib/research/public-ad-radar";

type PublicAdRadarDialogProps = {
  location: string;
  open: boolean;
  onClose: () => void;
};

type StatusFilter = "all" | "active" | "inactive";

export function PublicAdRadarDialog({ location, open, onClose }: PublicAdRadarDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [cards, setCards] = useState<PublicAdRadarCard[]>([]);
  const [locationLabel, setLocationLabel] = useState(location);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState<PublicAdRadarSort>("recent");
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishedLoading, setFinishedLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      lastFocusedRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !location.trim()) return;

    let active = true;
    const controller = new AbortController();

    async function loadPages() {
      setCards([]);
      setLocationLabel(location);
      setError(null);
      setFinishedLoading(false);
      setLoadingInitial(true);
      setLoadingMore(false);

      let cursor: string | null = null;
      let isFirstPage = true;

      try {
        do {
          const payload = await fetchAdPage(location, sort, cursor, controller.signal);
          if (!active) return;

          setLocationLabel(payload.location.label || location);
          setCards((existing) => appendCards(existing, payload.ads));
          cursor = payload.nextCursor;

          if (isFirstPage) {
            setLoadingInitial(false);
            setLoadingMore(Boolean(cursor));
            isFirstPage = false;
          }

          if (cursor) await delay(90);
        } while (cursor && active);

        if (active) {
          setLoadingInitial(false);
          setLoadingMore(false);
          setFinishedLoading(true);
        }
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        setLoadingInitial(false);
        setLoadingMore(false);
        setFinishedLoading(true);
        setError(loadError instanceof Error ? loadError.message : "Could not load suburb ads.");
      }
    }

    void loadPages();

    return () => {
      active = false;
      controller.abort();
    };
  }, [location, open, sort]);

  const platforms = useMemo(() => {
    return Array.from(new Set(cards.flatMap((card) => card.platforms))).sort((a, b) => a.localeCompare(b));
  }, [cards]);

  const visibleCards = useMemo(() => {
    const needle = normaliseSearch(search);
    const filtered = cards.filter((card) => {
      if (status !== "all" && card.activeStatus !== status) return false;
      if (platform !== "all" && !card.platforms.includes(platform)) return false;
      if (!needle) return true;
      return cardSearchText(card).includes(needle);
    });

    return sortPublicCards(filtered, sort);
  }, [cards, platform, search, sort, status]);

  if (!open) return null;

  return (
    <div className="lp-adlib-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        aria-labelledby="lp-adlib-title"
        aria-modal="true"
        className="lp-adlib-dialog"
        onKeyDown={(event) => trapDialogKeys(event, dialogRef.current, onClose)}
        ref={dialogRef}
        role="dialog"
      >
        <header className="lp-adlib-head">
          <div>
            <p className="lp-adlib-kicker">Local Ad Radar</p>
            <h2 id="lp-adlib-title">Ads around {locationLabel}</h2>
            <p>
              {cards.length} scraped ad{cards.length === 1 ? "" : "s"} loaded
              {loadingMore ? " while more results load." : finishedLoading ? "." : "."}
            </p>
          </div>
          <button className="lp-adlib-close" onClick={onClose} ref={closeButtonRef} type="button" aria-label="Close ad results">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="lp-adlib-tools" aria-label="Filter ad results">
          <label className="lp-adlib-search">
            <span className="sr-only">Search ads</span>
            <Search size={16} aria-hidden />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agency, suburb or ad copy" />
          </label>

          <div className="lp-adlib-filter-row">
            <div className="lp-adlib-segment" role="group" aria-label="Ad status">
              {(["all", "active", "inactive"] as const).map((value) => (
                <button
                  aria-pressed={status === value}
                  className={status === value ? "is-active" : undefined}
                  key={value}
                  onClick={() => setStatus(value)}
                  type="button"
                >
                  {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
                </button>
              ))}
            </div>

            <label className="lp-adlib-select">
              <SlidersHorizontal size={14} aria-hidden />
              <span className="sr-only">Platform</span>
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                <option value="all">All platforms</option>
                {platforms.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="lp-adlib-select">
              <span className="sr-only">Sort ads</span>
              <select value={sort} onChange={(event) => setSort(event.target.value === "longest" ? "longest" : "recent")}>
                <option value="recent">Most recent</option>
                <option value="longest">Longest running</option>
              </select>
            </label>
          </div>
        </div>

        <div className="lp-adlib-body">
          {loadingInitial ? <AdSkeletonGrid /> : null}

          {!loadingInitial && error ? (
            <div className="lp-adlib-state">
              <h3>Ad scan is unavailable</h3>
              <p>{error}</p>
            </div>
          ) : null}

          {!loadingInitial && !error && visibleCards.length === 0 ? (
            <div className="lp-adlib-state">
              <h3>No ads matched {locationLabel}</h3>
              <p>Try a nearby suburb or postcode while the background collector expands coverage.</p>
            </div>
          ) : null}

          {visibleCards.length > 0 ? (
            <div className="lp-adlib-results" aria-live="polite">
              {visibleCards.map((card) => (
                <PublicAdCard card={card} key={card.id} location={locationLabel} />
              ))}
            </div>
          ) : null}
        </div>

        <footer className="lp-adlib-foot">
          <span>{loadingMore ? "Loading more scraped ads in the background..." : "Create an account to save ads and turn an angle into a campaign."}</span>
          <a className="lp-btn lp-btn-primary" href={signupHref({ location: locationLabel })}>
            Start from this market
          </a>
        </footer>
      </div>
    </div>
  );
}

function PublicAdCard({ card, location }: { card: PublicAdRadarCard; location: string }) {
  const bodyIsLong = Boolean(card.body && card.body.length > 280);
  const bodyPreview = bodyIsLong && card.body ? `${card.body.slice(0, 260).trim()}...` : card.body;
  const areaText = formatAreaText(card);

  return (
    <article className="lp-adlib-card">
      <header className="lp-adlib-card-head">
        <PageAvatar card={card} />
        <div className="lp-adlib-page-copy">
          <strong>{card.pageName}</strong>
          <span>Sponsored</span>
          <span>{areaText}</span>
        </div>
        <span className={`lp-adlib-status ${card.activeStatus}`}>{statusLabel(card.activeStatus)}</span>
      </header>

      <div className="lp-adlib-meta">
        {deliveryDateText(card) ? <span>{deliveryDateText(card)}</span> : null}
        {card.platforms.map((item) => (
          <span className="lp-adlib-chip" key={item}>
            {item}
          </span>
        ))}
      </div>

      {card.body ? (
        <div className="lp-adlib-copy">
          {bodyIsLong ? (
            <details>
              <summary>{bodyPreview}</summary>
              <p>{card.body}</p>
            </details>
          ) : (
            <p>{bodyPreview}</p>
          )}
        </div>
      ) : null}

      <AdMedia card={card} />

      {card.headline || card.description || card.cta || card.destinationDomain ? (
        <div className="lp-adlib-preview">
          <div>
            {card.destinationDomain ? <span className="lp-adlib-domain">{card.destinationDomain}</span> : null}
            {card.headline ? <h3>{card.headline}</h3> : null}
            {card.description ? <p>{card.description}</p> : null}
          </div>
          {card.cta ? (
            card.destinationUrl ? (
              <a className="lp-adlib-preview-cta" href={card.destinationUrl} target="_blank" rel="noreferrer">
                {card.cta} <ExternalLink size={12} aria-hidden />
              </a>
            ) : (
              <span className="lp-adlib-preview-cta">{card.cta}</span>
            )
          ) : null}
        </div>
      ) : null}

      <a className="lp-adlib-angle" href={signupHref({ location, card })}>
        Use this angle
      </a>
    </article>
  );
}

function PageAvatar({ card }: { card: PublicAdRadarCard }) {
  if (card.pageImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="lp-adlib-avatar" src={card.pageImageUrl} alt="" loading="lazy" />
    );
  }

  return <span className="lp-adlib-avatar fallback">{card.pageName.slice(0, 1).toUpperCase()}</span>;
}

function AdMedia({ card }: { card: PublicAdRadarCard }) {
  if (card.media.length === 0) {
    return <div className="lp-adlib-text-only">Text-only ad</div>;
  }

  if (card.media.length === 1) {
    const media = card.media[0];
    return (
      <div className="lp-adlib-media-frame">
        {media.kind === "video" ? (
          <video className="lp-adlib-media" src={media.url} poster={media.posterUrl ?? undefined} controls preload="metadata" playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="lp-adlib-media" src={media.url} alt={card.headline ?? card.pageName} loading="lazy" />
        )}
      </div>
    );
  }

  return (
    <div className="lp-adlib-media-grid" aria-label={`${card.media.length} ad media items`}>
      {card.media.map((media, index) => (
        <div className="lp-adlib-media-frame" key={`${media.url}:${index}`}>
          {media.kind === "video" ? (
            <video className="lp-adlib-media" src={media.url} poster={media.posterUrl ?? undefined} controls preload="metadata" playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="lp-adlib-media" src={media.url} alt={`${card.headline ?? card.pageName} ${index + 1}`} loading="lazy" />
          )}
        </div>
      ))}
    </div>
  );
}

function AdSkeletonGrid() {
  return (
    <div className="lp-adlib-results" aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="lp-adlib-card lp-adlib-skeleton" key={index}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

async function fetchAdPage(
  location: string,
  sort: PublicAdRadarSort,
  cursor: string | null,
  signal: AbortSignal,
): Promise<PublicAdRadarResponse> {
  const params = new URLSearchParams({ location, limit: "18", sort });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`/api/research/local-ad-radar?${params.toString()}`, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error ?? "Could not load suburb ads.");
  return payload as PublicAdRadarResponse;
}

function appendCards(existing: PublicAdRadarCard[], next: PublicAdRadarCard[]): PublicAdRadarCard[] {
  const seen = new Set(existing.map((card) => card.id));
  return [...existing, ...next.filter((card) => !seen.has(card.id))];
}

function trapDialogKeys(event: KeyboardEvent<HTMLDivElement>, dialog: HTMLDivElement | null, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }

  if (event.key !== "Tab" || !dialog) return;

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => !element.hasAttribute("disabled"));

  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function sortPublicCards(cards: PublicAdRadarCard[], sort: PublicAdRadarSort): PublicAdRadarCard[] {
  if (sort === "longest") {
    return [...cards].sort((a, b) => runningMs(b) - runningMs(a));
  }

  return [...cards].sort((a, b) => dateValue(b.lastSeenAt) - dateValue(a.lastSeenAt));
}

function cardSearchText(card: PublicAdRadarCard): string {
  return normaliseSearch(
    [
      card.pageName,
      card.postcode,
      ...postcodesForCard(card),
      card.suburb,
      card.state,
      card.headline,
      card.body,
      card.description,
      card.cta,
      card.destinationDomain,
      ...card.platforms,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function formatAreaText(card: PublicAdRadarCard): string {
  const suburb = card.suburb?.trim() || null;
  const cardPostcodes = postcodesForCard(card);
  const postcodes = cardPostcodes.length > 0 ? cardPostcodes : card.postcode ? [card.postcode] : [];
  const postcodeText = postcodes.length > 1 ? `Postcodes ${postcodes.join(", ")}` : postcodes[0] ?? null;
  const suburbHasPostcode = Boolean(suburb && postcodes.some((postcode) => textHasToken(suburb, postcode)));
  const state = card.state && (!suburb || !textHasToken(suburb, card.state)) ? card.state : null;
  const parts = [suburb, suburbHasPostcode ? null : postcodeText, state].filter(Boolean);

  return parts.length ? parts.join(" ") : "Area unavailable";
}

function postcodesForCard(card: PublicAdRadarCard): string[] {
  return Array.isArray(card.postcodes) ? card.postcodes : [];
}

function textHasToken(text: string, token: string): boolean {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, "iu").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function signupHref(input: { location: string; card?: PublicAdRadarCard }): string {
  const params = new URLSearchParams({
    market: input.location,
    source: "local-ad-radar",
  });

  const angle = input.card?.headline ?? input.card?.body?.slice(0, 120) ?? input.card?.pageName;
  if (angle) params.set("angle", angle);
  if (input.card?.id) params.set("adRef", input.card.id);

  return `/signup?${params.toString()}`;
}

function deliveryDateText(card: PublicAdRadarCard): string | null {
  const started = formatDate(card.startedAt);
  const stopped = formatDate(card.stoppedAt);
  const duration = card.durationLabel;

  if (started && stopped) return `Started ${started} - stopped ${stopped}${duration ? ` | ${duration}` : ""}`;
  if (started) return `Started ${started}${duration ? ` | ${duration}` : ""}`;
  if (stopped) return `Stopped ${stopped}`;
  if (duration) return duration;
  return null;
}

function statusLabel(status: PublicAdRadarCard["activeStatus"]): string {
  if (status === "active") return "Active";
  if (status === "inactive") return "Inactive";
  return "Unknown";
}

function runningMs(card: PublicAdRadarCard): number {
  if (!card.startedAt) return -1;
  const start = new Date(card.startedAt).getTime();
  if (Number.isNaN(start)) return -1;
  const end = card.stoppedAt ? new Date(card.stoppedAt).getTime() : Date.now();
  if (Number.isNaN(end)) return -1;
  return Math.max(0, end - start);
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

function dateValue(value: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normaliseSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
