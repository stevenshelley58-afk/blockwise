import { normaliseAdRadarCardSearchQuery } from "./ad-radar-card-search.ts";
import {
  resolveAdRadarLocationSearch,
  shouldPrioritiseAdRadarLocationSearch,
} from "./ad-radar-location.ts";
import type { AdDbRow } from "./ad-db.ts";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ClientOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
};

export type AdDbSearchInput = {
  query?: string;
  agentId?: string;
  agentName?: string;
  agencyId?: string;
  agencyName?: string;
  state?: string;
  suburb?: string;
  postcode?: string;
  locationRelation?:
    "office" | "service_area" | "property" | "copy_mention" | "meta_targeting";
  limit?: number;
};

export type AdDbSearchResult = {
  items: AdDbRow[];
  page: { nextCursor: string | null; limit: number };
};
export type ParsedAdDbSearch =
  { ok: true; input: AdDbSearchInput | null } | { ok: false; error: string };

export class AdDbConfigurationError extends Error {
  constructor(message = "Ad DB API is not configured.") {
    super(message);
    this.name = "AdDbConfigurationError";
  }
}
export class AdDbUpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Ad DB API request failed.");
    this.name = "AdDbUpstreamError";
    this.status = status;
  }
}

const ALLOWED_PARAMS = new Set([
  "q",
  "sort",
  "includeSurrounding",
  "status",
  "agency",
  "agent",
  "agentId",
  "agencyId",
  "state",
  "suburb",
  "postcode",
  "locationRelation",
  "adType",
  "format",
  "hook",
]);
const LOCATION_RELATIONS = new Set([
  "office",
  "service_area",
  "property",
  "copy_mention",
  "meta_targeting",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseAdDbSearchParams(
  params: URLSearchParams,
): ParsedAdDbSearch {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key))
      return { ok: false, error: `Unsupported search parameter: ${key}` };
    if (params.getAll(key).length > 1)
      return { ok: false, error: `Repeated search parameter: ${key}` };
  }
  const sort = params.get("sort");
  if (sort && sort !== "recent") return unsupported("sort");
  if (["1", "true", "yes"].includes(params.get("includeSurrounding") ?? ""))
    return unsupported("includeSurrounding");
  for (const name of ["status", "adType", "format", "hook"] as const)
    if (params.has(name)) return unsupported(name);

  const q = normaliseAdRadarCardSearchQuery(params.get("q") ?? "");
  if (q.length > 300) return { ok: false, error: "Search query is too long." };
  const input: AdDbSearchInput = {};
  for (const [source, target] of [
    ["agent", "agentName"],
    ["agency", "agencyName"],
    ["state", "state"],
    ["suburb", "suburb"],
  ] as const) {
    const value = params.get(source)?.trim();
    if (params.has(source) && !value)
      return { ok: false, error: `${source} must not be empty.` };
    if (value && value.length > 160)
      return { ok: false, error: `${source} is too long.` };
    if (value) input[target] = value;
  }
  for (const name of ["agentId", "agencyId"] as const) {
    const value = params.get(name)?.trim();
    if (value && !UUID.test(value))
      return { ok: false, error: `${name} must be a UUID.` };
    if (params.has(name) && !value)
      return { ok: false, error: `${name} must not be empty.` };
    if (value) input[name] = value;
  }
  const postcode = params.get("postcode")?.trim();
  if (postcode && !/^\d{4}$/u.test(postcode))
    return { ok: false, error: "postcode must be four digits." };
  if (params.has("postcode") && !postcode)
    return { ok: false, error: "postcode must not be empty." };
  if (postcode) input.postcode = postcode;
  const relation = params.get("locationRelation")?.trim();
  if (relation && !LOCATION_RELATIONS.has(relation))
    return { ok: false, error: "locationRelation is invalid." };
  if (params.has("locationRelation") && !relation)
    return { ok: false, error: "locationRelation must not be empty." };
  if (relation)
    input.locationRelation = relation as AdDbSearchInput["locationRelation"];

  const hasExplicitLocation = Boolean(
    input.state || input.suburb || input.postcode,
  );
  const guess =
    q && !hasExplicitLocation
      ? resolveAdRadarLocationSearch(q, { includeSurroundingSuburbs: false })
      : null;
  if (q && shouldPrioritiseAdRadarLocationSearch(q, guess)) {
    const exactPostcode = q.match(/^\d{4}$/u)?.[0];
    if (exactPostcode) input.postcode = exactPostcode;
    else if (guess?.city) input.suburb = guess.city;
    if (guess?.stateCode) input.state = guess.stateCode;
  } else if (q) input.query = q;

  return { ok: true, input: Object.keys(input).length > 0 ? input : null };
}

export async function searchAdDbAds(
  input: AdDbSearchInput,
  options: ClientOptions = {},
): Promise<AdDbSearchResult> {
  const { baseUrl, token } = resolveAdDbConfig(options.env);
  const url = endpoint(baseUrl, "/v1/ad-db/ads");
  const pairs: Array<[string, string | undefined]> = [
    ["q", input.query],
    ["agentId", input.agentId],
    ["agentName", input.agentName],
    ["agencyId", input.agencyId],
    ["agencyName", input.agencyName],
    ["state", input.state],
    ["suburb", input.suburb],
    ["postcode", input.postcode],
    ["locationRelation", input.locationRelation],
  ];
  for (const [name, value] of pairs)
    if (value) url.searchParams.set(name, value);
  url.searchParams.set(
    "limit",
    String(Math.min(100, Math.max(1, input.limit ?? 50))),
  );
  const response = await request(
    url,
    token,
    { method: "GET" },
    options.fetcher,
  );
  if (!response.ok) throw new AdDbUpstreamError(response.status);
  const payload: unknown = await response.json().catch(() => null);
  if (!isSearchResult(payload)) throw new AdDbUpstreamError(502);
  return payload;
}

export async function fetchAdDbMedia(
  adId: string,
  mediaId: string,
  input: {
    method: "GET" | "HEAD";
    range?: string | null;
    ifRange?: string | null;
  },
  options: ClientOptions = {},
): Promise<Response> {
  const { baseUrl, token } = resolveAdDbConfig(options.env);
  const url = endpoint(
    baseUrl,
    `/v1/ad-db/ads/${encodeURIComponent(adId)}/media/${encodeURIComponent(mediaId)}`,
  );
  const headers = new Headers();
  if (input.range) headers.set("range", input.range);
  if (input.ifRange) headers.set("if-range", input.ifRange);
  return request(
    url,
    token,
    { method: input.method, headers },
    options.fetcher,
  );
}

function unsupported(name: string): ParsedAdDbSearch {
  return { ok: false, error: `${name} is not supported by Ad DB.` };
}
function resolveAdDbConfig(
  env: Record<string, string | undefined> = process.env,
): {
  baseUrl: URL;
  token: string;
} {
  const rawUrl = env.AD_DB_API_URL?.trim();
  const token = env.AD_DB_READ_TOKEN?.trim();
  if (!rawUrl || !token) throw new AdDbConfigurationError();
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new AdDbConfigurationError("AD_DB_API_URL is invalid.");
  }
  if (
    !/^https?:$/u.test(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password
  )
    throw new AdDbConfigurationError("AD_DB_API_URL is invalid.");
  return { baseUrl, token };
}
async function request(
  url: URL,
  token: string,
  init: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-hermes-ad-db-read-token", token);
  try {
    const response = await fetcher(url, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400)
      throw new AdDbUpstreamError(response.status);
    return response;
  } catch (error) {
    if (error instanceof AdDbUpstreamError) throw error;
    throw new AdDbUpstreamError(502);
  }
}
function endpoint(baseUrl: URL, path: string): URL {
  return new URL(path, `${baseUrl.origin}/`);
}
function isSearchResult(value: unknown): value is AdDbSearchResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { items?: unknown; page?: unknown };
  if (
    !Array.isArray(candidate.items) ||
    !candidate.page ||
    typeof candidate.page !== "object"
  )
    return false;
  const page = candidate.page as { nextCursor?: unknown; limit?: unknown };
  return (
    (page.nextCursor === null || typeof page.nextCursor === "string") &&
    typeof page.limit === "number" &&
    Number.isInteger(page.limit)
  );
}
