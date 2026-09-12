import type { PublicAdRadarCard } from "@/lib/research/public-ad-radar";

/**
 * The competitor ads Home shows under "Ads near …", picked from the same Ad
 * Radar read model the Ad Radar surface uses. Home is a glance, not the list, so
 * these four rows are chosen to look like a real local market: a card that can
 * draw a picture first, then one with a headline, and one ad per advertiser
 * before any advertiser repeats.
 */

/** How many rows Home shows. */
export const HOME_LOCAL_AD_LIMIT = 4;

/** One row of Home's local-ads list. */
export type HomeLocalAd = {
  id: string;
  pageName: string;
  headline: string | null;
  suburb: string | null;
  state: string | null;
  imageUrl: string | null;
};

/**
 * The still Home can draw for a card, or null when there is none.
 *
 * `media` holds images and videos together, and a video resolves to an mp4 URL
 * that an `<img>` cannot render; asking for the image (or a video's poster)
 * keeps a broken frame out of the list. The row falls back to a plain tile when
 * this returns null.
 */
export function homeAdImageUrl(card: PublicAdRadarCard): string | null {
  const image = card.media.find((media) => media.kind === "image");
  if (image) return image.url;
  return card.media.find((media) => media.kind === "video" && media.posterUrl)?.posterUrl ?? null;
}

export function selectHomeLocalAds(
  cards: PublicAdRadarCard[],
  limit = HOME_LOCAL_AD_LIMIT,
): HomeLocalAd[] {
  const ranked = cards
    .map((card) => ({ card, imageUrl: homeAdImageUrl(card) }))
    // Equal scores keep the caller's order (the radar returns most recent
    // first) because Array.prototype.sort is stable.
    .sort((a, b) => presentationScore(b) - presentationScore(a));

  const chosen: typeof ranked = [];
  const advertisers = new Set<string>();
  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    const advertiser = entry.card.pageName.trim().toLowerCase();
    if (advertisers.has(advertiser)) continue;
    advertisers.add(advertiser);
    chosen.push(entry);
  }

  // A market with fewer advertisers than rows repeats one rather than showing
  // an empty slot.
  for (const entry of ranked) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }

  return chosen.map(({ card, imageUrl }) => ({
    id: card.id,
    pageName: card.pageName,
    headline: card.headline,
    suburb: card.suburb,
    state: card.state,
    imageUrl,
  }));
}

function presentationScore(entry: { card: PublicAdRadarCard; imageUrl: string | null }): number {
  return (entry.imageUrl ? 2 : 0) + (entry.card.headline ? 1 : 0);
}
