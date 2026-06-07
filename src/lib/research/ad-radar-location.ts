import { adRunningMs, type CustomerMetaAdLibraryCard } from "./customer-meta-card.ts";

export type AdRadarLocationGuess = {
  city: string | null;
  stateCode: string | null;
  stateName: string | null;
  countryCode: string | null;
  label: string;
  terms: string[];
  source: "ip" | "fallback" | "query";
};

type HeaderReader = {
  get(name: string): string | null;
};

type ScoredCard = {
  card: CustomerMetaAdLibraryCard;
  score: number;
};

const STATE_BY_REGION: Record<string, { code: string; name: string; defaultPostcodes: string[] }> = {
  ACT: { code: "ACT", name: "Australian Capital Territory", defaultPostcodes: ["2600"] },
  NSW: { code: "NSW", name: "New South Wales", defaultPostcodes: ["2000"] },
  NT: { code: "NT", name: "Northern Territory", defaultPostcodes: ["0800"] },
  QLD: { code: "QLD", name: "Queensland", defaultPostcodes: ["4000"] },
  SA: { code: "SA", name: "South Australia", defaultPostcodes: ["5000"] },
  TAS: { code: "TAS", name: "Tasmania", defaultPostcodes: ["7000"] },
  VIC: { code: "VIC", name: "Victoria", defaultPostcodes: ["3000"] },
  WA: { code: "WA", name: "Western Australia", defaultPostcodes: ["6000", "6008"] },
};

const REGION_ALIASES = new Map<string, string>(
  Object.values(STATE_BY_REGION).flatMap((state) => [
    [normaliseTerm(state.code), state.code],
    [normaliseTerm(state.name), state.code],
  ]),
);

const CITY_DEFAULT_POSTCODES: Record<string, string[]> = {
  brisbane: ["4000"],
  canberra: ["2600"],
  darwin: ["0800"],
  hobart: ["7000"],
  melbourne: ["3000"],
  perth: ["6000", "6008"],
  sydney: ["2000"],
};

const POSTCODE_AREA_HINTS: Record<string, { stateCode: string; suburbs: string[] }> = {
  "6163": {
    stateCode: "WA",
    suburbs: ["Spearwood", "Hamilton Hill", "Coolbellup", "Bibra Lake", "Kardinya", "North Lake", "North Coogee", "Hilton"],
  },
};

const SUBURB_AREA_HINTS: Record<string, { stateCode: string; postcodes: string[]; suburbs?: string[] }> = {
  spearwood: { stateCode: "WA", postcodes: ["6163"], suburbs: POSTCODE_AREA_HINTS["6163"].suburbs },
};

const IGNORED_LOCATION_TEXT_TERMS = new Set(["act", "au", "australia", "australian", "nsw", "nt", "qld", "sa", "tas", "vic", "wa"]);

const POSTCODE_STATE_RANGES = [
  { code: "ACT", min: 200, max: 299 },
  { code: "NT", min: 800, max: 999 },
  { code: "NSW", min: 1000, max: 2599 },
  { code: "ACT", min: 2600, max: 2618 },
  { code: "NSW", min: 2619, max: 2899 },
  { code: "ACT", min: 2900, max: 2920 },
  { code: "NSW", min: 2921, max: 2999 },
  { code: "VIC", min: 3000, max: 3999 },
  { code: "QLD", min: 4000, max: 4999 },
  { code: "SA", min: 5000, max: 5999 },
  { code: "WA", min: 6000, max: 6999 },
  { code: "TAS", min: 7000, max: 7999 },
  { code: "VIC", min: 8000, max: 8999 },
  { code: "QLD", min: 9000, max: 9999 },
] as const;

const FALLBACK_LOCATION: AdRadarLocationGuess = {
  city: "Perth",
  stateCode: "WA",
  stateName: "Western Australia",
  countryCode: "AU",
  label: "Perth, WA",
  terms: ["Perth", "WA", "Western Australia", "6000", "6008"],
  source: "fallback",
};

export function resolveAdRadarLocationGuess(headers: HeaderReader): AdRadarLocationGuess {
  const countryCode = readHeader(headers, "x-vercel-ip-country")?.toUpperCase() ?? null;
  const regionValue = readHeader(headers, "x-vercel-ip-country-region");
  const city = cleanLocationValue(readHeader(headers, "x-vercel-ip-city"));
  const state = resolveAustralianState(regionValue);

  if (countryCode !== "AU") {
    return {
      ...FALLBACK_LOCATION,
      countryCode,
      source: "fallback",
    };
  }

  if (!state && !city) {
    return FALLBACK_LOCATION;
  }

  const stateCode = state?.code ?? null;
  const stateName = state?.name ?? null;
  const cityPostcodes = city ? CITY_DEFAULT_POSTCODES[normaliseTerm(city)] ?? [] : [];
  const statePostcodes = state?.defaultPostcodes ?? [];
  const terms = uniqueTerms([city, stateCode, stateName, ...cityPostcodes, ...statePostcodes]);

  return {
    city,
    stateCode,
    stateName,
    countryCode,
    label: [city, stateCode].filter(Boolean).join(", ") || stateName || "Australia",
    terms,
    source: "ip",
  };
}

export function resolveAdRadarLocationSearch(value: string): AdRadarLocationGuess | null {
  const cleaned = cleanLocationValue(value);
  if (!cleaned) return null;

  const postcode = cleaned.match(/\b\d{4}\b/)?.[0] ?? null;
  const explicitState = resolveAustralianStateFromText(cleaned);
  const postcodeState = postcode ? resolveAustralianStateFromPostcode(postcode) : null;
  const postcodeHint = postcode ? POSTCODE_AREA_HINTS[postcode] ?? null : null;
  let state = explicitState ?? postcodeState;
  const city = resolveCityFromSearch(cleaned, state?.code ?? null, state?.name ?? null, postcode);
  const suburbHint = city ? SUBURB_AREA_HINTS[normaliseTerm(city)] ?? null : null;
  state ??= suburbHint
    ? STATE_BY_REGION[suburbHint.stateCode] ?? null
    : postcodeHint
      ? STATE_BY_REGION[postcodeHint.stateCode] ?? null
      : null;
  const cityPostcodes = city ? CITY_DEFAULT_POSTCODES[normaliseTerm(city)] ?? [] : [];
  const hintedPostcodes = suburbHint?.postcodes ?? [];
  const relatedSuburbs = suburbHint?.suburbs ?? postcodeHint?.suburbs ?? [];
  const terms = uniqueTerms([city, ...relatedSuburbs, state?.code, state?.name, postcode, ...cityPostcodes, ...hintedPostcodes, cleaned]);

  if (terms.length === 0) return null;

  return {
    city,
    stateCode: state?.code ?? null,
    stateName: state?.name ?? null,
    countryCode: "AU",
    label: formatSearchLocationLabel(city, state?.code ?? null, postcode, cleaned),
    terms,
    source: "query",
  };
}

export function pickAdRadarCardsForLocation(
  cards: CustomerMetaAdLibraryCard[],
  guess: AdRadarLocationGuess,
  sort: "recent" | "longest",
  now = Date.now(),
): { cards: CustomerMetaAdLibraryCard[]; matchedLocation: boolean } {
  const scored = cards
    .map((card) => ({ card, score: scoreCardForLocation(card, guess) }))
    .filter((entry) => entry.score > 0);

  if (scored.length > 0) {
    return {
      cards: sortScoredCards(scored, sort, now).map((entry) => entry.card),
      matchedLocation: true,
    };
  }

  const fallbackScored = cards
    .filter((card) => card.state?.toUpperCase() === FALLBACK_LOCATION.stateCode)
    .map((card) => ({ card, score: scoreCardForLocation(card, FALLBACK_LOCATION) || 1 }));

  const fallbackCards = fallbackScored.length > 0 ? sortScoredCards(fallbackScored, sort, now).map((entry) => entry.card) : sortCards(cards, sort, now);

  return {
    cards: fallbackCards,
    matchedLocation: false,
  };
}

export function matchAdRadarCardsForLocation(
  cards: CustomerMetaAdLibraryCard[],
  guess: AdRadarLocationGuess,
  sort: "recent" | "longest",
  now = Date.now(),
): CustomerMetaAdLibraryCard[] {
  return sortScoredCards(
    cards
      .map((card) => ({ card, score: scoreCardForLocation(card, guess) }))
      .filter((entry) => entry.score > 0),
    sort,
    now,
  ).map((entry) => entry.card);
}

function scoreCardForLocation(card: CustomerMetaAdLibraryCard, guess: AdRadarLocationGuess): number {
  let score = 0;
  const stateCode = guess.stateCode?.toUpperCase() ?? null;
  const stateName = guess.stateName ? normaliseTerm(guess.stateName) : null;
  const city = guess.city ? normaliseTerm(guess.city) : null;
  const cardState = card.state?.toUpperCase() ?? null;
  const cardSuburb = card.suburb ? normaliseTerm(card.suburb) : null;
  const cardPostcode = card.postcode?.trim() ?? null;
  const supportingPostcodes = new Set(card.postcodes.filter((value): value is string => Boolean(value)));
  const hasPostcodeTerm = guess.terms.some((term) => /^\d{4}$/.test(term));
  const isSpecificQuery = guess.source === "query" && (Boolean(city) || hasPostcodeTerm);
  const textLocationTerms = locationTextTerms(guess);

  if (!isSpecificQuery && stateCode && cardState === stateCode) score += 45;
  if (!isSpecificQuery && stateName && card.state && normaliseTerm(card.state) === stateName) score += 45;

  for (const term of guess.terms) {
    if (!/^\d{4}$/u.test(term)) continue;
    if (cardPostcode === term) score += 120;
    else if (!cardPostcode && supportingPostcodes.has(term)) score += 80;
  }

  if (city && cardSuburb) {
    if (cardSuburb === city) score += 220;
    else if (cardSuburb.includes(city) || city.includes(cardSuburb)) score += 100;
  }

  const text = normaliseTerm([card.headline, card.body, card.description, card.destinationUrl].filter(Boolean).join(" "));
  for (const term of textLocationTerms) {
    if (city && term === city) continue;
    if (cardSuburb) {
      if (cardSuburb === term) score += city ? 50 : 100;
      else if (cardSuburb.includes(term) || term.includes(cardSuburb)) score += city ? 35 : 65;
    }
    if (textIncludesNormalisedPhrase(text, term)) score += city ? 15 : 30;
  }

  for (const term of guess.terms) {
    if (/^\d{4}$/.test(term) && textIncludesNormalisedPhrase(text, term)) score += 80;
  }
  if (city && textIncludesNormalisedPhrase(text, city)) score += 90;
  if (!isSpecificQuery && stateCode && textIncludesNormalisedPhrase(text, normaliseTerm(stateCode))) score += 10;

  return score;
}

function locationTextTerms(guess: AdRadarLocationGuess): string[] {
  const ignored = new Set(IGNORED_LOCATION_TEXT_TERMS);
  if (guess.stateCode) ignored.add(normaliseTerm(guess.stateCode));
  if (guess.stateName) ignored.add(normaliseTerm(guess.stateName));

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of guess.terms) {
    const normalised = normaliseTerm(term);
    if (!normalised || /\d/.test(normalised) || ignored.has(normalised) || seen.has(normalised)) continue;
    seen.add(normalised);
    terms.push(normalised);
  }
  return terms;
}

function formatSearchLocationLabel(city: string | null, stateCode: string | null, postcode: string | null, fallback: string): string {
  if (city) return [city, stateCode].filter(Boolean).join(", ");
  if (postcode) return [postcode, stateCode].filter(Boolean).join(", ");
  return stateCode || fallback;
}

function sortScoredCards(cards: ScoredCard[], sort: "recent" | "longest", now: number): ScoredCard[] {
  return [...cards].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return compareCards(a.card, b.card, sort, now);
  });
}

function sortCards(cards: CustomerMetaAdLibraryCard[], sort: "recent" | "longest", now: number): CustomerMetaAdLibraryCard[] {
  return [...cards].sort((a, b) => compareCards(a, b, sort, now));
}

function compareCards(a: CustomerMetaAdLibraryCard, b: CustomerMetaAdLibraryCard, sort: "recent" | "longest", now: number): number {
  if (sort === "longest") {
    const aMs = adRunningMs(a.startedAt, a.stoppedAt, now);
    const bMs = adRunningMs(b.startedAt, b.stoppedAt, now);
    if (aMs !== null || bMs !== null) return (bMs ?? -1) - (aMs ?? -1);
  }

  return dateValue(b.lastSeenAt) - dateValue(a.lastSeenAt);
}

function resolveAustralianState(value: string | null): { code: string; name: string; defaultPostcodes: string[] } | null {
  const alias = value ? REGION_ALIASES.get(normaliseTerm(value)) : null;
  return alias ? STATE_BY_REGION[alias] ?? null : null;
}

function resolveAustralianStateFromText(value: string): { code: string; name: string; defaultPostcodes: string[] } | null {
  const normalised = ` ${normaliseTerm(value)} `;

  for (const state of Object.values(STATE_BY_REGION)) {
    if (new RegExp(`\\b${escapeRegExp(normaliseTerm(state.code))}\\b`, "i").test(normalised)) return state;
    if (normalised.includes(` ${normaliseTerm(state.name)} `)) return state;
  }

  return null;
}

function resolveAustralianStateFromPostcode(postcode: string): { code: string; name: string; defaultPostcodes: string[] } | null {
  const numeric = Number(postcode);
  if (!Number.isFinite(numeric)) return null;

  const range = POSTCODE_STATE_RANGES.find((entry) => numeric >= entry.min && numeric <= entry.max);
  return range ? STATE_BY_REGION[range.code] ?? null : null;
}

function resolveCityFromSearch(value: string, stateCode: string | null, stateName: string | null, postcode: string | null): string | null {
  let candidate = value.split(",")[0]?.trim() || value.trim();
  if (postcode) candidate = candidate.replace(new RegExp(`\\b${escapeRegExp(postcode)}\\b`, "i"), " ");
  if (stateCode) candidate = candidate.replace(new RegExp(`\\b${escapeRegExp(stateCode)}\\b`, "i"), " ");
  if (stateName) candidate = candidate.replace(new RegExp(`\\b${escapeRegExp(stateName)}\\b`, "i"), " ");
  candidate = candidate.replace(/\bAustralia\b/gi, " ").replace(/\s+/g, " ").replace(/^[,\-\s]+|[,\-\s]+$/g, "");

  if (!candidate || /^\d{4}$/.test(candidate) || resolveAustralianState(candidate)) return null;
  return candidate;
}

function readHeader(headers: HeaderReader, name: string): string | null {
  return cleanLocationValue(headers.get(name));
}

function cleanLocationValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return decodeURIComponent(trimmed.replace(/\+/g, " ")).trim() || null;
  } catch {
    return trimmed;
  }
}

function uniqueTerms(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const value of values) {
    const clean = cleanLocationValue(value ?? null);
    if (!clean) continue;
    const key = normaliseTerm(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(clean);
  }

  return terms;
}

function normaliseTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textIncludesNormalisedPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? 0 : date;
}
