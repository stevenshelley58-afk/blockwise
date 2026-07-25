import type { AdStudioBrandKit } from "@/lib/adstudio";
import type { PublicAdRadarCard } from "@/lib/research/public-ad-radar";

export const GENERATION_AD_PAGE_SIZE = 12;
export const GENERATION_AD_BUFFER_LIMIT = 48;

export function generationAdLocation(brandKit: AdStudioBrandKit): string {
  return brandKit.contact.address?.trim() || brandKit.identity.marketRegion?.trim() || "";
}

export function appendGenerationAds(
  existing: PublicAdRadarCard[],
  incoming: PublicAdRadarCard[],
  limit = GENERATION_AD_BUFFER_LIMIT,
): PublicAdRadarCard[] {
  const seen = new Set(existing.map((card) => card.id));
  const merged = [...existing];

  for (const card of incoming) {
    if (seen.has(card.id) || !hasGenerationAdImage(card)) continue;
    seen.add(card.id);
    merged.push(card);
    if (merged.length >= limit) break;
  }

  return merged;
}

export function hasGenerationAdImage(card: PublicAdRadarCard): boolean {
  return generationAdMediaUrl(card) !== null;
}

export function generationAdMediaUrl(card: PublicAdRadarCard): string | null {
  const media = card.media.find((item) => item.kind === "image") ?? card.media.find((item) => item.posterUrl);
  return media?.kind === "image" ? media.url : media?.posterUrl ?? null;
}

export function generationAdRadarHref(card: PublicAdRadarCard, location: string): string {
  const query = card.pageName.trim() || location.trim();
  return query ? `/ad-radar?q=${encodeURIComponent(query)}` : "/ad-radar";
}

