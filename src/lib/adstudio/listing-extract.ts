/**
 * Listing extraction: shared types and pure logic for scraping AU property
 * listings. Used by both the VPS scraper (hermes/tools/listing-scraper) and
 * the Vercel thin-proxy route + client dialog.
 */

type TemplateCopyRequirement = { key: string; label: string; maxLength: number };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListingData = {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  price: string;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  propertyType: string;
  landSize: string | null;
  description: string;
  features: string[];
  photos: string[];
  agentName: string | null;
  agencyName: string | null;
  agentPhone: string | null;
  inspectionTimes: string[];
  sourceUrl: string;
};

export type ListingExtractResponse =
  | { ok: true; listing: ListingData; brief: string; photos: string[]; folder: string }
  | { ok: false; error: "blocked" | "not_listing" | "timeout" | "invalid_url" | "service_unavailable"; message: string };

// ---------------------------------------------------------------------------
// Browser headers for anti-blocking
// ---------------------------------------------------------------------------

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

const AU_TLD_PATTERN = /\.(com\.au|net\.au|org\.au|au)$/i;

export function isAustralianDomain(hostname: string): boolean {
  return AU_TLD_PATTERN.test(hostname);
}

// ---------------------------------------------------------------------------
// JSON-LD extraction
// ---------------------------------------------------------------------------

export function extractJsonLd(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const pattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") flattenGraph(item as Record<string, unknown>, results);
        }
      } else if (parsed && typeof parsed === "object") {
        flattenGraph(parsed as Record<string, unknown>, results);
      }
    } catch {
      // Malformed JSON-LD — skip.
    }
  }
  return results;
}

/** Push the item itself, and if it has an @graph array, push those inner items too. */
function flattenGraph(item: Record<string, unknown>, results: Record<string, unknown>[]): void {
  results.push(item);
  if (Array.isArray(item["@graph"])) {
    for (const inner of item["@graph"]) {
      if (inner && typeof inner === "object") results.push(inner as Record<string, unknown>);
    }
  }
}

// ---------------------------------------------------------------------------
// OG meta extraction
// ---------------------------------------------------------------------------

export function extractOgMeta(html: string): Partial<ListingData> {
  const result: Partial<ListingData> = {};
  const ogImage = metaContent(html, "og:image");
  if (ogImage) result.photos = [ogImage];
  const ogTitle = metaContent(html, "og:title");
  if (ogTitle) result.address = ogTitle;
  const ogDescription = metaContent(html, "og:description");
  if (ogDescription) result.description = ogDescription;
  return result;
}

function metaContent(html: string, property: string): string {
  const pattern = new RegExp(
    `<meta[^>]*(?:property|name)\\s*=\\s*["']${escapeRegex(property)}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const match = html.match(pattern);
  if (match?.[1]) return decodeHtmlEntities(match[1]);
  // Try reversed attribute order (content before property)
  const reversed = new RegExp(
    `<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escapeRegex(property)}["']`,
    "i",
  );
  const reversedMatch = html.match(reversed);
  return reversedMatch?.[1] ? decodeHtmlEntities(reversedMatch[1]) : "";
}

// ---------------------------------------------------------------------------
// JSON-LD → ListingData mapping
// ---------------------------------------------------------------------------

const LISTING_TYPES = new Set([
  "Residence",
  "House",
  "Apartment",
  "RealEstateListing",
  "Place",
  "Accommodation",
  "LodgingBusiness",
]);

export function mapJsonLdToListingData(jsonLdItems: unknown[], sourceUrl: string): ListingData | null {
  for (const item of jsonLdItems) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // Check @type match
    const types = normalizeTypes(obj["@type"]);
    const isListing = types.some((t) => LISTING_TYPES.has(t)) || Boolean(obj["@graph"]);

    // Handle @graph wrapper
    if (obj["@graph"] && Array.isArray(obj["@graph"])) {
      const inner = mapJsonLdToListingData(obj["@graph"] as unknown[], sourceUrl);
      if (inner) return inner;
    }

    if (!isListing) continue;

    const address = extractAddress(obj);
    const geo = obj["geo"] as Record<string, unknown> | undefined;

    const data: ListingData = {
      address: address.street || String(obj["name"] ?? ""),
      suburb: address.locality,
      state: address.region,
      postcode: address.postalCode,
      price: extractPrice(obj),
      bedrooms: toNumber(obj["numberOfRooms"] ?? obj["numberOfBedrooms"]),
      bathrooms: toNumber(obj["numberOfBathroomsTotal"] ?? obj["numberOfBathrooms"]),
      parking: toNumber(obj["numberOfParkingSpaces"] ?? obj["parkingSpaces"]),
      propertyType: types.find((t) => t !== "Place" && t !== "RealEstateListing") ?? "Property",
      landSize: obj["floorSize"] ? String(obj["floorSize"]) : null,
      description: String(obj["description"] ?? "").slice(0, 500),
      features: extractFeatures(obj),
      photos: extractPhotos(obj),
      agentName: extractAgentName(obj),
      agencyName: extractAgencyName(obj),
      agentPhone: extractAgentPhone(obj),
      inspectionTimes: [],
      sourceUrl,
    };

    // Only return if we got at least an address or suburb
    if (data.address || data.suburb) return data;
  }
  return null;
}

function normalizeTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

function extractAddress(obj: Record<string, unknown>): {
  street: string;
  locality: string;
  region: string;
  postalCode: string;
} {
  const addr = obj["address"];
  if (typeof addr === "string") {
    return { street: addr, locality: "", region: "", postalCode: "" };
  }
  if (addr && typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    return {
      street: String(a["streetAddress"] ?? ""),
      locality: String(a["addressLocality"] ?? ""),
      region: String(a["addressRegion"] ?? ""),
      postalCode: String(a["postalCode"] ?? ""),
    };
  }
  return { street: "", locality: "", region: "", postalCode: "" };
}

function extractPrice(obj: Record<string, unknown>): string {
  const offers = obj["offers"];
  if (offers && typeof offers === "object" && !Array.isArray(offers)) {
    const o = offers as Record<string, unknown>;
    const price = o["price"] ?? o["lowPrice"];
    const currency = String(o["priceCurrency"] ?? "AUD");
    if (price) return `${currency === "AUD" ? "$" : ""}${price}`;
  }
  if (Array.isArray(offers) && offers.length > 0) {
    const first = offers[0] as Record<string, unknown>;
    const price = first["price"] ?? first["lowPrice"];
    if (price) return `$${price}`;
  }
  return "";
}

function extractFeatures(obj: Record<string, unknown>): string[] {
  const amenities = obj["amenityFeature"];
  if (Array.isArray(amenities)) {
    return amenities
      .map((a) => (typeof a === "string" ? a : (a as Record<string, unknown>)?.["name"]))
      .filter((v): v is string => Boolean(v))
      .slice(0, 10);
  }
  return [];
}

function extractPhotos(obj: Record<string, unknown>): string[] {
  const photos: string[] = [];
  const image = obj["image"] ?? obj["photo"];
  if (typeof image === "string") photos.push(image);
  else if (Array.isArray(image)) {
    for (const img of image.slice(0, 5)) {
      if (typeof img === "string") photos.push(img);
      else if (img && typeof img === "object") {
        const url = (img as Record<string, unknown>)["url"] ?? (img as Record<string, unknown>)["contentUrl"];
        if (typeof url === "string") photos.push(url);
      }
    }
  }
  return photos;
}

function extractAgentName(obj: Record<string, unknown>): string | null {
  const agent = obj["agent"] ?? obj["broker"];
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    return String((agent as Record<string, unknown>)["name"] ?? "") || null;
  }
  return null;
}

function extractAgencyName(obj: Record<string, unknown>): string | null {
  const agent = obj["agent"] ?? obj["broker"];
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    const a = agent as Record<string, unknown>;
    const org = a["worksFor"] ?? a["memberOf"];
    if (org && typeof org === "object") {
      return String((org as Record<string, unknown>)["name"] ?? "") || null;
    }
  }
  return null;
}

function extractAgentPhone(obj: Record<string, unknown>): string | null {
  const agent = obj["agent"] ?? obj["broker"];
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    const phone = (agent as Record<string, unknown>)["telephone"];
    if (typeof phone === "string" && phone.trim()) return phone.trim();
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Brief builder
// ---------------------------------------------------------------------------

export function buildListingBrief(data: ListingData): string {
  const parts: string[] = [];

  const beds = data.bedrooms != null ? `${data.bedrooms} bed` : "";
  const baths = data.bathrooms != null ? `${data.bathrooms} bath` : "";
  const cars = data.parking != null ? `${data.parking} car` : "";
  const specs = [beds, baths, cars].filter(Boolean).join(" ");
  const type = data.propertyType?.toLowerCase() || "property";

  if (specs) parts.push(`${specs} ${type}`);
  else parts.push(type);

  const location = [data.address, data.suburb, data.state, data.postcode].filter(Boolean).join(", ");
  if (location) parts.push(`at ${location}`);

  if (data.price) parts.push(`Price: ${data.price}`);

  if (data.features.length > 0) {
    parts.push(`Features: ${data.features.slice(0, 5).join(", ")}`);
  }

  if (data.inspectionTimes.length > 0) {
    parts.push(`Open: ${data.inspectionTimes.join("; ")}`);
  }

  if (data.description && parts.length < 4) {
    const snippet = data.description.split(/[.!]/).slice(0, 2).join(". ").trim();
    if (snippet) parts.push(snippet);
  }

  return parts.join(". ") + ".";
}

// ---------------------------------------------------------------------------
// On-image copy mapper
// ---------------------------------------------------------------------------

export function mapListingToOnImageCopy(
  data: ListingData,
  fields: TemplateCopyRequirement[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const field of fields) {
    const key = `${field.key} ${field.label}`.toLowerCase();
    const value = matchListingFieldToCopy(key, data);
    if (value) result[field.key] = value.slice(0, field.maxLength);
  }

  return result;
}

function matchListingFieldToCopy(identity: string, data: ListingData): string {
  if (/address|street/.test(identity)) {
    return data.address || "";
  }
  if (/suburb|location|area/.test(identity)) {
    return [data.suburb, data.state, data.postcode].filter(Boolean).join(" ") || "";
  }
  if (/price|guide/.test(identity)) {
    return data.price || "";
  }
  if (/phone|telephone|mobile|contact/.test(identity)) {
    return data.agentPhone || "";
  }
  if (/agent|name/.test(identity) && !/agency|business|brand|company/.test(identity)) {
    return data.agentName || "";
  }
  if (/bed|room/.test(identity)) {
    return data.bedrooms != null ? String(data.bedrooms) : "";
  }
  if (/bath/.test(identity)) {
    return data.bathrooms != null ? String(data.bathrooms) : "";
  }
  if (/parking|car|garage/.test(identity)) {
    return data.parking != null ? String(data.parking) : "";
  }
  if (/type|category/.test(identity)) {
    return data.propertyType || "";
  }
  if (/feature|highlight/.test(identity)) {
    return data.features.slice(0, 3).join(", ") || "";
  }
  if (/open|inspection/.test(identity)) {
    return data.inspectionTimes[0] || "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Slug builder
// ---------------------------------------------------------------------------

export function buildListingSlug(data: ListingData): string {
  const parts = [data.address, data.suburb].filter(Boolean);
  const base = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${base || "listing"}-${date}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}
