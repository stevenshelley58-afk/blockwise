import type { AdDbRow } from "./ad-db.ts";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ClientOptions = { env?: NodeJS.ProcessEnv; fetcher?: Fetcher };

export type AdDbSearchInput = {
  query: string;
  agentName?: string;
  agencyName?: string;
  limit?: number;
};

export type AdDbSearchResult = {
  items: AdDbRow[];
  page: { nextCursor: string | null; limit: number };
};

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

export async function searchAdDbAds(
  input: AdDbSearchInput,
  options: ClientOptions = {},
): Promise<AdDbSearchResult> {
  const { baseUrl, token } = resolveAdDbConfig(options.env);
  const url = endpoint(baseUrl, "/v1/ad-db/ads");
  url.searchParams.set("q", input.query);
  if (input.agentName) url.searchParams.set("agentName", input.agentName);
  if (input.agencyName) url.searchParams.set("agencyName", input.agencyName);
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
  input: { method: "GET" | "HEAD"; range?: string | null },
  options: ClientOptions = {},
): Promise<Response> {
  const { baseUrl, token } = resolveAdDbConfig(options.env);
  const url = endpoint(
    baseUrl,
    `/v1/ad-db/ads/${encodeURIComponent(adId)}/media/${encodeURIComponent(mediaId)}`,
  );
  const headers = new Headers();
  if (input.range) headers.set("range", input.range);
  return request(
    url,
    token,
    { method: input.method, headers },
    options.fetcher,
  );
}

function resolveAdDbConfig(env: NodeJS.ProcessEnv = process.env): {
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
  ) {
    throw new AdDbConfigurationError("AD_DB_API_URL is invalid.");
  }
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
