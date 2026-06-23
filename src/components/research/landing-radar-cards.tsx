"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import type { PublicAdRadarCard, PublicAdRadarResponse } from "@/lib/research/public-ad-radar";

type LocationGuess = { label: string; searchTerm: string; source: "ip" | "fallback" | "query" };

type RadarState =
  | { status: "loading" }
  | { status: "ready"; cards: PublicAdRadarCard[]; areaLabel: string | null };

const CARD_COUNT = 3;

const FB = {
  ink: "#050505",
  sec: "#65676b",
  line: "#dadde1",
  chip: "#f0f2f5",
  btn: "#e4e6eb",
  font: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
};

const S: Record<string, CSSProperties> = {
  link: { display: "block", textDecoration: "none", color: "inherit" },
  card: { fontFamily: FB.font, background: "#fff", border: `1px solid ${FB.line}`, borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", color: FB.ink, boxShadow: "0 1px 2px rgba(0, 0, 0, 0.1)", height: "100%" },
  head: { display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 12px 0" },
  avImg: { width: 40, height: 40, borderRadius: "50%", flex: "none", objectFit: "cover" },
  avFallback: { width: 40, height: 40, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 16 },
  hc: { flex: 1, minWidth: 0, display: "grid", gap: 1 },
  page: { fontSize: 14, fontWeight: 600, lineHeight: 1.2, color: FB.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  sub: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: FB.sec },
  dots: { color: FB.sec, flex: "none", paddingTop: 2 },
  body: { padding: "10px 12px", fontSize: 14, lineHeight: 1.4, color: FB.ink, whiteSpace: "pre-wrap" },
  media: { display: "block", width: "100%", height: "auto" },
  textOnly: { display: "grid", placeItems: "center", minHeight: 150, background: FB.chip, color: FB.sec, fontSize: 13, fontWeight: 600 },
  linkRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: FB.chip, padding: "10px 12px", borderTop: `1px solid ${FB.line}` },
  lc: { display: "grid", gap: 2, minWidth: 0 },
  dom: { fontSize: 12, color: FB.sec, textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  head2: { fontSize: 15, fontWeight: 700, lineHeight: 1.25, color: FB.ink },
  desc: { fontSize: 12.5, color: FB.sec },
  cta: { flex: "none", alignSelf: "center", background: FB.btn, color: FB.ink, fontWeight: 700, fontSize: 13, borderRadius: 6, padding: "8px 12px", whiteSpace: "nowrap" },
  acts: { display: "flex", borderTop: "1px solid #ced0d4" },
  act: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 7, fontSize: 13, fontWeight: 600, color: FB.sec },
};

/**
 * Landing radar proof cards. Best-guess the visitor's area from IP and show
 * real scraped ads near them; fall back to the longest-running ads we track.
 * Each card is styled as a real Facebook feed ad (advertiser + Sponsored, the
 * scraped creative, headline + CTA) from the data we scraped from the Meta Ad
 * Library - no research chrome. The whole card links to signup. Never renders
 * invented ads: skeletons while loading, one quiet line if the API is down.
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

/** Renders a public radar card as a real Facebook feed ad. Whole card links to signup (no nested anchors). */
function LandingRadarCard({ card, areaLabel }: { card: PublicAdRadarCard; areaLabel: string | null }) {
  const body = cardBody(card);
  const creative = cardCreativeImage(card);
  const hasLink = Boolean(card.headline || card.destinationDomain || card.cta);

  return (
    <a className="lp-radar-ad-link" href={signupHref(card, areaLabel)} style={S.link}>
      <article style={S.card}>
        <div style={S.head}>
          <Avatar card={card} />
          <div style={S.hc}>
            <span style={S.page}>{card.pageName}</span>
            <span style={S.sub}>
              Sponsored &middot; <GlobeIcon />
            </span>
          </div>
          <span style={S.dots}>
            <DotsIcon />
          </span>
        </div>

        {body ? <div style={S.body}>{body}</div> : null}

        {creative ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img style={S.media} src={creative} alt={card.headline ?? `${card.pageName} ad creative`} loading="lazy" />
        ) : (
          <div style={S.textOnly}>Text-only ad</div>
        )}

        {hasLink ? (
          <div style={S.linkRow}>
            <div style={S.lc}>
              {card.destinationDomain ? <span style={S.dom}>{card.destinationDomain}</span> : null}
              {card.headline ? <span style={S.head2}>{card.headline}</span> : null}
              {card.description ? <span style={S.desc}>{card.description}</span> : null}
            </div>
            {card.cta ? <span style={S.cta}>{card.cta}</span> : null}
          </div>
        ) : null}

        <div style={S.acts}>
          <span style={S.act}>
            <LikeIcon /> Like
          </span>
          <span style={S.act}>
            <CommentIcon /> Comment
          </span>
          <span style={S.act}>
            <ShareIcon /> Share
          </span>
        </div>
      </article>
    </a>
  );
}

function Avatar({ card }: { card: PublicAdRadarCard }) {
  if (card.pageImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img style={S.avImg} src={card.pageImageUrl} alt="" loading="lazy" />;
  }
  return (
    <span style={{ ...S.avFallback, background: avatarColor(card.pageName) }}>
      {card.pageName.slice(0, 1).toUpperCase()}
    </span>
  );
}

function avatarColor(name: string): string {
  let hue = 0;
  for (let i = 0; i < name.length; i += 1) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hue}, 42%, 38%)`;
}

function GlobeIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2c1.6 0 3 .5 4.2 1.4-.3.9-1 1.6-1.9 1.6-.6 0-1.1.5-1.1 1.1 0 .9-.7 1.6-1.6 1.6H9.3c-.5 0-.9.4-.9.9v1.7c0 .5.4.9.9.9h1.3v1.8c0 .5.4.9.9.9.8 0 1.5.5 1.7 1.3A8 8 0 1112 4z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function LikeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M7 10v11M7 10l4-7a2 2 0 013 2l-1 5h5a2 2 0 012 2.3l-1.3 7A2 2 0 0117.5 21H7" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 01-12.2 7.6L3 21l1.9-5.8A8.5 8.5 0 1121 11.5z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v14" />
    </svg>
  );
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
  return card.body.length > 280 ? `${card.body.slice(0, 260).trim()}...` : card.body;
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
