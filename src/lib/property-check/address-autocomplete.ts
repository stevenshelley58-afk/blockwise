export type PropertyAddressPrediction = {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string | null;
};

type SuggestPropertyAddressesOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
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

export async function suggestPropertyAddresses(
  input: string,
  options: SuggestPropertyAddressesOptions = {},
): Promise<{ predictions: PropertyAddressPrediction[]; source: "google" | "none" }> {
  const query = input.trim();
  if (query.length < 3) return { predictions: [], source: "none" };

  const apiKey = cleanText(options.apiKey);
  if (!apiKey || /^(replace_me|your_|test_|demo_)/i.test(apiKey)) {
    return { predictions: [], source: "none" };
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify({
        input: query,
        includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
        includedRegionCodes: ["au"],
        languageCode: "en-AU",
        regionCode: "au",
        ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
      }),
    });

    if (!response.ok) return { predictions: [], source: "none" };

    const predictions = normalizePropertyAddressPredictions((await response.json()) as GoogleAutocompleteResponse);
    return predictions.length > 0 ? { predictions, source: "google" } : { predictions: [], source: "none" };
  } catch {
    return { predictions: [], source: "none" };
  }
}

export function normalizePropertyAddressPredictions(payload: GoogleAutocompleteResponse): PropertyAddressPrediction[] {
  const predictions: PropertyAddressPrediction[] = [];
  const seen = new Set<string>();

  for (const suggestion of payload.suggestions ?? []) {
    const place = suggestion.placePrediction;
    const placeId = cleanText(place?.placeId);
    const label = cleanAddress(place?.text?.text);
    if (!placeId || !label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    predictions.push({
      placeId,
      label,
      mainText: cleanText(place?.structuredFormat?.mainText?.text) ?? firstAddressPart(label),
      secondaryText: cleanAddress(place?.structuredFormat?.secondaryText?.text),
    });
  }

  return predictions.slice(0, 5);
}

function cleanAddress(value: unknown): string | null {
  const clean = cleanText(value);
  return clean?.replace(/,?\s+Australia$/i, "").trim() || null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstAddressPart(value: string): string {
  return value.split(",")[0]?.trim() || value;
}
