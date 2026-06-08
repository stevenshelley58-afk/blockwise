# Task: Landing page Ad Radar section — real ads, best-guess location

Read `AGENTS.md` first and obey its hard rules: no new dependencies, no schema changes, no public API response-shape changes, no auth changes.

## Goal

The landing page (`src/app/page.tsx`) `#radar` section currently renders 3 hardcoded fictional ads (Coastline Property / Hillview Agents / Northstar Realty with `/ads/*.jpg` stock images). Replace them with **real scraped Meta Ad Library ads**:

1. Best-guess the visitor's location from IP (existing endpoint `/api/research/locations/guess`).
2. Show real ads from their area (existing endpoint `/api/research/local-ad-radar`).
3. If no location can be guessed (source `fallback`) or no area ads match, show the **longest-running ads** we track instead.
4. Never show fake ads. While loading show skeletons; if the API is entirely down show one quiet line of copy.

Everything stays client-fetched so the landing route remains static (matches the existing `useBestGuess` pattern in `AdRadarLocationForm`). Do NOT call `headers()` or Supabase from `page.tsx`.

Known pre-existing state: `src/lib/research/*` has ~20 pre-existing `tsc` errors (Jsonb mismatches, stale `@ts-expect-error`). Do not fix them; just add **zero new** errors.

---

## Change 1 — API: longest-running fallback when no location is given

File: `src/lib/research/public-ad-radar.ts`

Today `loadPublicAdRadarCards` returns an empty response when `location` is empty. Make the empty-location case return the longest-running ads overall. Keep the non-empty-but-unparseable case exactly as it is (dialog behavior must not change).

Replace:

```ts
  if (!searchTerm || !locationGuess) {
    return publicResponse(searchTerm, searchTerm || "Selected area", false, [], null);
  }
```

with:

```ts
  if (!searchTerm) {
    return loadLongestRunningResponse(supabase, limit);
  }

  if (!locationGuess) {
    return publicResponse(searchTerm, searchTerm, false, [], null);
  }
```

Add (near the other private helpers in the same file — reuse the existing `fetchRows`-style conventions, `dedupeRows`, `sortCards`, `toPublicAdRadarCard`, `publicResponse`):

```ts
const LONGEST_RUNNING_WINDOW = 150;

/**
 * No-location fallback: the longest-running ads across all coverage.
 * Active ads ordered by earliest delivery start, re-sorted in JS by actual
 * running time (handles stopped_at reconciliation), sliced to `limit`.
 */
async function loadLongestRunningResponse(
  supabase: SupabaseClient,
  limit: number,
): Promise<PublicAdRadarResponse> {
  let rows = await fetchLongestRunningRows(supabase, LONGEST_RUNNING_WINDOW, true);
  if (rows.length === 0) rows = await fetchLongestRunningRows(supabase, LONGEST_RUNNING_WINDOW, false);

  const now = Date.now();
  const cards = sortCards(dedupeRows(rows).map(normaliseCustomerMetaAdLibraryCard), "longest")
    .slice(0, limit)
    .map((card) => toPublicAdRadarCard(card, now));

  return publicResponse("", "Australia", false, cards, null);
}

async function fetchLongestRunningRows(
  supabase: SupabaseClient,
  limit: number,
  activeOnly: boolean,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  let query = supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .not("ad_delivery_started_at", "is", null)
    .order("ad_delivery_started_at", { ascending: true })
    .limit(limit);

  if (activeOnly) query = query.ilike("active_status", "active");

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CustomerMetaAdLibraryCardRow[];
}
```

Notes:
- `PublicAdRadarResponse` shape is unchanged (AGENTS.md rule). `matched: false` is the signal that these are not area ads.
- `.ilike("active_status", "active")` because stored casing varies; `normaliseActiveStatus` lowercases.
- The route `src/app/api/research/local-ad-radar/route.ts` needs **no changes** — `GET` already passes `location ?? ""` through, and the same-URL-for-everyone fallback request is safe under its `public, max-age=45` cache header. The per-visitor request includes the location in the URL, so CDN caching stays correct.

## Change 2 — New client component

New file: `src/components/research/landing-radar-cards.tsx`

```tsx
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
 * Never renders invented ads — skeletons while loading, one quiet line if
 * the radar API is unavailable.
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
        Live ad coverage is updating — scan a suburb above to see active ads in that area.
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
          style={{ backgroundImage: `url("${thumb}")` }}
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
          Use this angle →
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
```

## Change 3 — Wire into the landing page

File: `src/app/page.tsx`

1. Add import:

```ts
import { LandingRadarCards } from "@/components/research/landing-radar-cards";
```

2. Delete the local `RadarCardProps` type and `RadarCard` function entirely (the block from `type RadarCardProps = {` through the end of the `RadarCard` function).

3. In the `#radar` section, replace the whole hardcoded list:

```tsx
            <div className="lp-radar-list">
              <RadarCard
                agency="Coastline Property"
                ...
              />
              ...
            </div>
```

with:

```tsx
            <LandingRadarCards />
```

4. Update the file-top doc comment: the line about radar cards should now say the radar row renders live scraped ads (IP best-guess area, longest-running fallback) instead of describing static cards.

Do not delete `/public/ads/*.jpg` if anything else references them — `src/components/adstudio/use-media.ts` and `src/lib/meta-monitor/sampleMetaMonitorData.ts` mention Coastline/Hillview sample data; leave those files alone.

## Change 4 — CSS

File: `src/app/landing.css`, immediately after the existing `.lp-radar-link:hover` rule (~line 256):

```css
.lp-radar-context { margin: 48px 2px 0; font-size: 13px; color: var(--lp-muted); }
.lp-radar-context + .lp-radar-list { margin-top: 16px; }
.lp-radar-thumb-empty { display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: 700; color: var(--lp-faint); }
.lp-radar-skeleton .lp-radar-thumb { animation: lp-radar-pulse 1.4s ease-in-out infinite; }
.lp-radar-skeleton .lp-radar-body span { display: block; height: 12px; margin-bottom: 10px; border-radius: 6px; background: #e9eef6; animation: lp-radar-pulse 1.4s ease-in-out infinite; }
.lp-radar-skeleton .lp-radar-body span:nth-child(2) { width: 80%; }
.lp-radar-skeleton .lp-radar-body span:nth-child(3) { width: 55%; }

@keyframes lp-radar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
```

(`.lp-radar-thumb` already has the `#e9eef6` background, so the empty tile and skeleton inherit it.)

## Change 5 — Docs

File: `docs/landing-copy-spec.md` — the "Stitch deviations" bullet says radar uses fictional agencies (Coastline Property, Hillview Agents, Northstar Realty). Rewrite that fragment: the radar row now renders **real scraped Meta Ad Library ads** — best-guess area from IP via `/api/research/locations/guess`, longest-running coverage as fallback — so no invented ads are attributed to anyone.

## Verify

```
npm test            # node test suite must pass
npm run typecheck   # ONLY the known pre-existing src/lib/research errors; zero new
npm run build
```

Manual: `npm run dev`, open `/`. Expect skeletons → three real cards with a context line. Simulate the area path by sending Vercel geo headers, e.g.:

```
curl -s http://localhost:3000/api/research/local-ad-radar?limit=9&sort=longest          # fallback payload
curl -s "http://localhost:3000/api/research/locations/guess" -H "x-vercel-ip-country: AU" -H "x-vercel-ip-country-region: WA" -H "x-vercel-ip-city: Perth"
```

Optional but welcome: a node test in `tests/` asserting `loadPublicAdRadarCards(supabase, { location: "" })` queries with the active filter + `ad_delivery_started_at` ascending and returns `matched: false` with sorted cards (mock the Supabase client the way existing tests do).
