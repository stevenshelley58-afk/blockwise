import type { PublicAdRadarCard } from "@/lib/research/public-ad-radar";

/**
 * The competitor ads Home shows under "Ads near …", picked from the same Ad
 * Radar read model the Ad Radar surface uses.
 *
 * Home is a glance, not the list, so these rows are chosen to look like a real
 * local market: a card that can draw a still first, then one with a headline,
 * and one ad per advertiser before any advertiser repeats. A card with no still
 * to draw is never chosen at all — the empty tile it renders reads as a broken
 * ad rather than a quiet one.
 */

/** How many rows Home shows. */
export const HOME_LOCAL_AD_LIMIT = 4;

/**
 * How many cards Home checks. A URL is not a thumbnail: the research archive
 * holds objects that have gone missing, so the caller verifies each candidate
 * before it is shown and needs spares to replace the ones that fail.
 */
export const HOME_LOCAL_AD_CANDIDATES = HOME_LOCAL_AD_LIMIT * 2;

/** A card Home could show, with the still it would draw already resolved. */
export type HomeLocalAdCandidate = {
  card: PublicAdRadarCard;
  imageUrl: string;
};

/** One row of Home's local-ads list, which is also its desktop card. */
export type HomeLocalAd = {
  id: string;
  pageName: string;
  headline: string | null;
  /** The still the row and the card both draw. Never null: Home only lists ads that have one. */
  imageUrl: string;
  suburb: string | null;
  state: string | null;
  activeStatus: PublicAdRadarCard["activeStatus"];
  startedAt: string | null;
  stoppedAt: string | null;
  adType: string | null;
  /** The ad's own media, so a card can say Video or Carousel beside its still. */
  media: Array<{ kind: "image" | "video"; url: string; posterUrl: string | null }>;
};

/**
 * The still Home can draw for a card, or null when there is none.
 *
 * `media` holds images and videos together, and a video resolves to an mp4 URL
 * that an `<img>` cannot render; asking for the image (or a video's poster)
 * keeps a broken frame out of the list.
 */
export function homeAdImageUrl(card: PublicAdRadarCard): string | null {
  const image = card.media.find((media) => media.kind === "image");
  if (image) return image.url;
  return card.media.find((media) => media.kind === "video" && media.posterUrl)?.posterUrl ?? null;
}

/**
 * Cards worth checking, best-presented first: a headline beats none, and one ad
 * per advertiser leads before an advertiser repeats. Cards with no still are
 * dropped here rather than padded in later.
 */
export function homeLocalAdCandidates(
  cards: PublicAdRadarCard[],
  limit = HOME_LOCAL_AD_CANDIDATES,
): HomeLocalAdCandidate[] {
  const ranked = cards
    .map((card) => ({ card, imageUrl: homeAdImageUrl(card) }))
    .filter((entry): entry is HomeLocalAdCandidate => entry.imageUrl !== null)
    // Equal scores keep the caller's order (the radar returns most recent
    // first) because Array.prototype.sort is stable.
    .sort((a, b) => headlineScore(b) - headlineScore(a));

  const chosen: HomeLocalAdCandidate[] = [];
  const advertisers = new Set<string>();
  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    const advertiser = entry.card.pageName.trim().toLowerCase();
    if (advertisers.has(advertiser)) continue;
    advertisers.add(advertiser);
    chosen.push(entry);
  }

  // A market with fewer advertisers than rows repeats one rather than showing
  // an empty slot, but never the same creative twice: two identical tiles read
  // as a bug, not as breadth.
  const stills = new Set(chosen.map((entry) => entry.imageUrl));
  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    if (stills.has(entry.imageUrl)) continue;
    stills.add(entry.imageUrl);
    chosen.push(entry);
  }

  return chosen;
}

export function toHomeLocalAds(
  candidates: HomeLocalAdCandidate[],
  limit = HOME_LOCAL_AD_LIMIT,
): HomeLocalAd[] {
  return candidates.slice(0, limit).map(({ card, imageUrl }) => ({
    id: card.id,
    pageName: card.pageName,
    headline: card.headline,
    imageUrl,
    suburb: card.suburb,
    state: card.state,
    activeStatus: card.activeStatus,
    startedAt: card.startedAt,
    stoppedAt: card.stoppedAt,
    adType: card.adType,
    media: card.media.map((media) => ({
      kind: media.kind,
      url: media.url,
      posterUrl: media.posterUrl,
    })),
  }));
}

function headlineScore(entry: HomeLocalAdCandidate): number {
  return entry.card.headline ? 1 : 0;
}
