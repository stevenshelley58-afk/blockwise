import type { AdvertiserSuggestion } from "./advertiser-autocomplete.ts";
import type { AdRadarLocationPrediction } from "./ad-radar-google-locations.ts";

export type AdRadarSearchSuggestion = {
  id: string;
  kind: "location" | "advertiser";
  mainText: string;
  secondaryText: string;
  searchTerm: string;
  source: "google" | "local" | "advertiser";
  imageUrl: string | null;
};

export function mergeAdRadarSearchSuggestions(
  locations: AdRadarLocationPrediction[],
  advertisers: AdvertiserSuggestion[],
  limit = 8,
): AdRadarSearchSuggestion[] {
  const suggestions: AdRadarSearchSuggestion[] = [];
  const seen = new Set<string>();

  const add = (suggestion: AdRadarSearchSuggestion) => {
    const key = normaliseTerm(suggestion.searchTerm);
    if (!key || seen.has(key) || suggestions.length >= limit) return;
    seen.add(key);
    suggestions.push(suggestion);
  };

  for (const location of locations) {
    add({
      id: `location:${location.placeId ?? location.searchTerm}`,
      kind: "location",
      mainText: location.mainText,
      secondaryText: location.secondaryText ?? "Suburb or postcode",
      searchTerm: location.searchTerm,
      source: location.source,
      imageUrl: null,
    });
  }

  for (const advertiser of advertisers) {
    add({
      id: `advertiser:${advertiser.pageId ?? advertiser.pageName}`,
      kind: "advertiser",
      mainText: advertiser.pageName,
      secondaryText: "Agency or agent",
      searchTerm: advertiser.pageName,
      source: "advertiser",
      imageUrl: advertiser.pageImageUrl,
    });
  }

  return suggestions;
}

function normaliseTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
