export type AdRadarLocationPrediction = {
  placeId: string | null;
  label: string;
  mainText: string;
  secondaryText: string | null;
  searchTerm: string;
  source: "google" | "local";
};

type SuggestAdRadarLocationsOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  limit?: number;
  sessionToken?: string | null;
};

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

const GOOGLE_PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_FIELD_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
].join(",");

const LOCAL_LOCATION_PREDICTIONS: AdRadarLocationPrediction[] = [
  localPrediction("Perth, WA", "Western Australia"),
  localPrediction("Subiaco, WA", "Western Australia"),
  localPrediction("Mount Lawley, WA", "Western Australia"),
  localPrediction("South Perth, WA", "Western Australia"),
  localPrediction("Cottesloe, WA", "Western Australia"),
  localPrediction("Fremantle, WA", "Western Australia"),
  localPrediction("Spearwood, WA", "Western Australia"),
  localPrediction("Claremont, WA", "Western Australia"),
  localPrediction("Nedlands, WA", "Western Australia"),
  localPrediction("Leederville, WA", "Western Australia"),
];

export async function suggestAdRadarLocations(
  input: string,
  options: SuggestAdRadarLocationsOptions = {},
): Promise<{ predictions: AdRadarLocationPrediction[]; source: "google" | "local" | "none" }> {
  const query = input.trim();
  const limit = Math.max(1, Math.min(options.limit ?? 5, 5));
  if (query.length < 2) return { predictions: [], source: "none" };

  const apiKey = cleanApiKey(options.apiKey);
  if (!apiKey) return { predictions: filterLocalPredictions(query, limit), source: "local" };

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify({
        input: query,
        includedPrimaryTypes: ["(regions)"],
        includedRegionCodes: ["au"],
        languageCode: "en-AU",
        regionCode: "au",
        ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
      }),
    });

    if (!response.ok) return { predictions: filterLocalPredictions(query, limit), source: "local" };

    const payload = (await response.json()) as GoogleAutocompleteResponse;
    const predictions = normaliseGooglePredictions(payload).slice(0, limit);
    return predictions.length > 0 ? { predictions, source: "google" } : { predictions: filterLocalPredictions(query, limit), source: "local" };
  } catch {
    return { predictions: filterLocalPredictions(query, limit), source: "local" };
  }
}

export function normaliseGooglePredictions(payload: GoogleAutocompleteResponse): AdRadarLocationPrediction[] {
  const predictions: AdRadarLocationPrediction[] = [];
  const seen = new Set<string>();

  for (const suggestion of payload.suggestions ?? []) {
    const place = suggestion.placePrediction;
    const label = cleanText(place?.text?.text);
    if (!place || !label) continue;

    const mainText = cleanText(place.structuredFormat?.mainText?.text) ?? firstLocationPart(label);
    const secondaryText = cleanText(place.structuredFormat?.secondaryText?.text);
    const searchTerm = cleanSearchTerm(label);
    const key = normaliseTerm(searchTerm);
    if (seen.has(key)) continue;
    seen.add(key);

    predictions.push({
      placeId: cleanText(place.placeId),
      label,
      mainText,
      secondaryText,
      searchTerm,
      source: "google",
    });
  }

  return predictions;
}

function filterLocalPredictions(query: string, limit: number): AdRadarLocationPrediction[] {
  const needle = normaliseTerm(query);
  return LOCAL_LOCATION_PREDICTIONS.filter((prediction) => normaliseTerm(prediction.label).includes(needle)).slice(0, limit);
}

function localPrediction(label: string, secondaryText: string): AdRadarLocationPrediction {
  return {
    placeId: null,
    label,
    mainText: firstLocationPart(label),
    secondaryText,
    searchTerm: label,
    source: "local",
  };
}

function cleanSearchTerm(value: string): string {
  return value.replace(/\bAustralia\b/gi, "").replace(/\s*,\s*$/g, "").replace(/\s{2,}/g, " ").trim();
}

function firstLocationPart(value: string): string {
  return value.split(",")[0]?.trim() || value;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanApiKey(value: string | undefined): string | null {
  const clean = cleanText(value);
  if (!clean || /^(replace_me|your_|test_|demo_)/i.test(clean)) return null;
  return clean;
}

function normaliseTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
