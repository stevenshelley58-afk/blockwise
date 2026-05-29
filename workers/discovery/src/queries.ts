// Discovery query catalog. Each query becomes one Apify search run.
// Queries return ads matching the keyword + country; each ad has its
// own pageId which we extract and dedupe across the whole batch.
//
// Curated to cover AU real-estate by metro suburb. Add new queries by
// appending; the discovery worker re-reads this on each cycle.

export type DiscoveryQuery = {
  q: string;       // search keyword
  country: string; // ISO country code
  state: string;   // AU state for tagging the anchor agency
  postcode: string; // representative postcode (for service_area linkage)
};

export const queries: DiscoveryQuery[] = [
  // ---- Perth metro
  { q: "real estate subiaco",      country: "AU", state: "WA", postcode: "6008" },
  { q: "real estate cottesloe",    country: "AU", state: "WA", postcode: "6011" },
  { q: "real estate claremont",    country: "AU", state: "WA", postcode: "6010" },
  { q: "real estate dalkeith",     country: "AU", state: "WA", postcode: "6009" },
  { q: "real estate fremantle",    country: "AU", state: "WA", postcode: "6160" },
  { q: "real estate mosman park",  country: "AU", state: "WA", postcode: "6012" },
  { q: "real estate applecross",   country: "AU", state: "WA", postcode: "6153" },
  { q: "real estate south perth",  country: "AU", state: "WA", postcode: "6151" },
  { q: "real estate scarborough",  country: "AU", state: "WA", postcode: "6019" },
  { q: "real estate joondalup",    country: "AU", state: "WA", postcode: "6027" },
  { q: "real estate mandurah",     country: "AU", state: "WA", postcode: "6210" },
  { q: "real estate mt lawley",    country: "AU", state: "WA", postcode: "6050" },
  { q: "real estate inglewood",    country: "AU", state: "WA", postcode: "6052" },
  { q: "real estate north perth",  country: "AU", state: "WA", postcode: "6006" },
  { q: "real estate victoria park",country: "AU", state: "WA", postcode: "6100" },
  { q: "real estate maylands",     country: "AU", state: "WA", postcode: "6051" },
  { q: "real estate floreat",      country: "AU", state: "WA", postcode: "6014" },
  { q: "real estate trigg",        country: "AU", state: "WA", postcode: "6029" },
  { q: "real estate hillarys",     country: "AU", state: "WA", postcode: "6025" },
  { q: "real estate carine",       country: "AU", state: "WA", postcode: "6020" },
  { q: "real estate burswood",     country: "AU", state: "WA", postcode: "6100" },
  { q: "real estate belmont",      country: "AU", state: "WA", postcode: "6104" },
  { q: "real estate canning vale", country: "AU", state: "WA", postcode: "6155" },
  // ---- Sydney metro
  { q: "real estate bondi",        country: "AU", state: "NSW", postcode: "2026" },
  { q: "real estate mosman",       country: "AU", state: "NSW", postcode: "2088" },
  { q: "real estate manly",        country: "AU", state: "NSW", postcode: "2095" },
  { q: "real estate vaucluse",     country: "AU", state: "NSW", postcode: "2030" },
  { q: "real estate double bay",   country: "AU", state: "NSW", postcode: "2028" },
  { q: "real estate paddington nsw", country: "AU", state: "NSW", postcode: "2021" },
  { q: "real estate newtown",      country: "AU", state: "NSW", postcode: "2042" },
  { q: "real estate balmain",      country: "AU", state: "NSW", postcode: "2041" },
  { q: "real estate neutral bay",  country: "AU", state: "NSW", postcode: "2089" },
  { q: "real estate coogee",       country: "AU", state: "NSW", postcode: "2034" },
  { q: "real estate cronulla",     country: "AU", state: "NSW", postcode: "2230" },
  // ---- Melbourne metro
  { q: "real estate toorak",       country: "AU", state: "VIC", postcode: "3142" },
  { q: "real estate south yarra",  country: "AU", state: "VIC", postcode: "3141" },
  { q: "real estate brighton vic", country: "AU", state: "VIC", postcode: "3186" },
  { q: "real estate hawthorn",     country: "AU", state: "VIC", postcode: "3122" },
  { q: "real estate st kilda",     country: "AU", state: "VIC", postcode: "3182" },
  { q: "real estate prahran",      country: "AU", state: "VIC", postcode: "3181" },
  { q: "real estate kew",          country: "AU", state: "VIC", postcode: "3101" },
  { q: "real estate camberwell",   country: "AU", state: "VIC", postcode: "3124" },
  { q: "real estate richmond vic", country: "AU", state: "VIC", postcode: "3121" },
  // ---- Brisbane metro
  { q: "real estate new farm",     country: "AU", state: "QLD", postcode: "4005" },
  { q: "real estate teneriffe",    country: "AU", state: "QLD", postcode: "4005" },
  { q: "real estate bulimba",      country: "AU", state: "QLD", postcode: "4171" },
  { q: "real estate hamilton qld", country: "AU", state: "QLD", postcode: "4007" },
  { q: "real estate ascot qld",    country: "AU", state: "QLD", postcode: "4007" },
  { q: "real estate paddington qld", country: "AU", state: "QLD", postcode: "4064" },
  { q: "real estate toowong",      country: "AU", state: "QLD", postcode: "4066" },
  { q: "real estate west end qld", country: "AU", state: "QLD", postcode: "4101" },
  { q: "real estate gold coast",   country: "AU", state: "QLD", postcode: "4217" },
  // ---- Adelaide
  { q: "real estate north adelaide", country: "AU", state: "SA", postcode: "5006" },
  { q: "real estate unley",        country: "AU", state: "SA", postcode: "5061" },
  { q: "real estate glenelg",      country: "AU", state: "SA", postcode: "5045" },
  // ---- Generic brand searches that surface multi-state advertisers
  { q: "ray white perth",          country: "AU", state: "WA", postcode: "6000" },
  { q: "harcourts perth",          country: "AU", state: "WA", postcode: "6000" },
  { q: "lj hooker perth",          country: "AU", state: "WA", postcode: "6000" },
  { q: "professionals real estate",country: "AU", state: "WA", postcode: "6000" },
  { q: "first national real estate",country: "AU",state: "WA", postcode: "6000" },
  { q: "century 21 real estate",   country: "AU", state: "WA", postcode: "6000" },
];
