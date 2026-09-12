import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

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
  /** Caller cancellation, e.g. the incoming request's AbortSignal. */
  signal?: AbortSignal;
};

export type AdDbSearchInput = {
  query?: string;
  advertiserPageId?: string;
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
  cursor?: string;
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

/**
 * The Ad DB bridge is a same-host HTTP hop measured at ~220ms per call, and the
 * cost is dominated by a fresh TCP connection per request. These agents keep
 * sockets warm so a burst of Ad Radar reads reuses one connection instead of
 * paying a handshake for each.
 */
const BRIDGE_KEEP_ALIVE_MS = 60_000;
const BRIDGE_MAX_SOCKETS = 32;
const bridgeHttpAgent = new HttpAgent({
  keepAlive: true,
  keepAliveMsecs: BRIDGE_KEEP_ALIVE_MS,
  maxSockets: BRIDGE_MAX_SOCKETS,
});
const bridgeHttpsAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: BRIDGE_KEEP_ALIVE_MS,
  maxSockets: BRIDGE_MAX_SOCKETS,
});

/**
 * The browser gives up on an Ad Radar search after 10s, so the bridge call is
 * bounded below that: the upstream stops working on a request the caller has
 * already abandoned, and the caller gets a normal upstream error instead of
 * being cut off mid-flight. The bridge's own 120s server-side timeout lives in
 * the Hermes/Frank runtime, not here.
 */
const AD_DB_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Concurrent identical reads (the same page requested by several cards) collapse
 * into one in-flight bridge request. Entries are dropped the moment the request
 * settles, so this coalesces work in progress only: there is no result cache and
 * therefore no window in which a stale row can be served.
 */
const inFlightReads = new Map<string, Promise<unknown>>();
const MAX_IN_FLIGHT_READS = 128;

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
  "cursor",
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
  if (q.length > 120) return { ok: false, error: "Search query is too long." };
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
    if (value && value.length > 120)
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

  const cursor = params.get("cursor")?.trim();
  if (params.has("cursor") && !cursor)
    return { ok: false, error: "cursor must not be empty." };
  if (cursor && (cursor.length > 512 || !/^[A-Za-z0-9._~+/=-]+$/u.test(cursor)))
    return { ok: false, error: "cursor is invalid." };
  if (cursor) input.cursor = cursor;
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
    ["advertiserPageId", input.advertiserPageId],
    ["agentId", input.agentId],
    ["agentName", input.agentName],
    ["agencyId", input.agencyId],
    ["agencyName", input.agencyName],
    ["state", input.state],
    ["suburb", input.suburb],
    ["postcode", input.postcode],
    ["locationRelation", input.locationRelation],
    ["cursor", input.cursor],
  ];
  for (const [name, value] of pairs)
    if (value) url.searchParams.set(name, value);
  url.searchParams.set(
    "limit",
    String(Math.min(100, Math.max(1, input.limit ?? 50))),
  );
  const run = async (): Promise<AdDbSearchResult> => {
    const response = await request(
      url,
      token,
      { method: "GET" },
      options.fetcher,
      options.signal,
    );
    if (!response.ok) throw new AdDbUpstreamError(response.status);
    const payload: unknown = await response.json().catch(() => null);
    if (!isSearchResult(payload)) throw new AdDbUpstreamError(502);
    return payload;
  };
  // An injected fetcher is a test seam and must observe every call, so only the
  // shared bridge path is coalesced.
  return coalesceRead(`GET ${url.toString()}`, run, !options.fetcher);
}

/** Load one canonical ad without exposing the research database to callers. */
export async function fetchAdDbAd(
  adId: string,
  options: ClientOptions = {},
): Promise<AdDbRow | null> {
  const { baseUrl, token } = resolveAdDbConfig(options.env);
  const url = endpoint(
    baseUrl,
    "/v1/ad-db/ads/" + encodeURIComponent(adId),
  );
  const run = async (): Promise<AdDbRow | null> => {
    const response = await request(
      url,
      token,
      { method: "GET" },
      options.fetcher,
      options.signal,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new AdDbUpstreamError(response.status);
    const payload: unknown = await response.json().catch(() => null);
    const row = unwrapAdDbRow(payload);
    if (!row) throw new AdDbUpstreamError(502);
    return row;
  };
  return coalesceRead(`GET ${url.toString()}`, run, !options.fetcher);
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
  // Media bodies stream and are Range specific, so they are never coalesced.
  return request(
    url,
    token,
    { method: input.method, headers },
    options.fetcher,
    options.signal,
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
  const token = env.HERMES_AD_DB_READ_TOKEN?.trim() || "";
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
/**
 * Minimal HTTP client for the bridge. Node's global fetch has no dependency-free
 * way to pin a keep-alive dispatcher, so the bridge hop uses node:http(s)
 * directly with the shared agents above. Only GET and HEAD are issued here, so
 * there is no request body to write.
 */
function bridgeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const target = input instanceof URL ? input : new URL(String(input));
  const secure = target.protocol === "https:";
  const send = secure ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = send(
      target,
      {
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        agent: secure ? bridgeHttpsAgent : bridgeHttpAgent,
        signal: init?.signal ?? undefined,
      },
      (incoming) => {
        const encoding = String(
          incoming.headers["content-encoding"] ?? "",
        ).toLowerCase();
        let body: Readable = incoming;
        if (encoding === "gzip" || encoding === "x-gzip")
          body = incoming.pipe(createGunzip());
        else if (encoding === "deflate") body = incoming.pipe(createInflate());
        else if (encoding === "br") body = incoming.pipe(createBrotliDecompress());
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (typeof value === "string") headers.set(name, value);
        }
        if (body !== incoming) {
          // The body was decompressed above, so the encoded length no longer applies.
          headers.delete("content-encoding");
          headers.delete("content-length");
        }
        const status = incoming.statusCode ?? 502;
        const bodiless = init?.method === "HEAD" || status === 204 || status === 304;
        resolve(
          new Response(
            bodiless ? null : (Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>),
            { status, statusText: incoming.statusMessage, headers },
          ),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** Join an in-flight identical read, or start one and remember it until it settles. */
function coalesceRead<T>(
  key: string,
  run: () => Promise<T>,
  enabled: boolean,
): Promise<T> {
  if (!enabled) return run();
  const existing = inFlightReads.get(key);
  if (existing) return existing as Promise<T>;
  if (inFlightReads.size >= MAX_IN_FLIGHT_READS) return run();
  const tracked = run();
  inFlightReads.set(key, tracked);
  const clear = () => {
    if (inFlightReads.get(key) === tracked) inFlightReads.delete(key);
  };
  tracked.then(clear, clear);
  return tracked;
}

async function request(
  url: URL,
  token: string,
  init: RequestInit,
  fetcher?: Fetcher,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("x-hermes-ad-db-read-token", token);
  const timeout = AbortSignal.timeout(AD_DB_REQUEST_TIMEOUT_MS);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  try {
    const response = await (fetcher ?? bridgeFetch)(url, {
      ...init,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal,
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

function unwrapAdDbRow(value: unknown): AdDbRow | null {
  if (isAdDbRow(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  for (const key of ["item", "ad", "data"]) {
    if (isAdDbRow(object[key])) return object[key];
  }
  return null;
}

function isAdDbRow(value: unknown): value is AdDbRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<AdDbRow>;
  return (
    typeof row.id === "string" &&
    typeof row.advertiser_page_id === "string" &&
    typeof row.page_name === "string" &&
    typeof row.active_status === "string" &&
    Array.isArray(row.media)
  );
}
