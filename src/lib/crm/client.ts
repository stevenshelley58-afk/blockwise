/**
 * Low-level Frappe CRM transport.
 *
 * Server-only. Every request carries the agency's site in the `Host` header and
 * a token Authorization header. Frappe wraps results in {"message": ...};
 * the envelope is unwrapped here so callers see the payload only.
 *
 * Retry policy: exactly one bounded retry, and only for a transport failure
 * (connection refused, DNS, timeout, socket reset). An HTTP response is never
 * retried, and a retry replays the identical body - the command_id inside it is
 * unchanged, so an accepted-then-lost response replays as a no-op instead of
 * creating a second enquiry.
 */

import { DEFAULT_CRM_TIMEOUT_MS, type CrmConfig } from "./config.ts";
import { CrmError, isCrmError, mapFrappeError } from "./errors.ts";

export type CrmQuery = Record<string, string | number | boolean | null | undefined>;

export type CrmRequest = {
  method: string;
  payload?: Record<string, unknown>;
  query?: CrmQuery;
  timeoutMs?: number;
};

export type CrmTransportOptions = {
  config: Pick<CrmConfig, "baseUrl" | "apiKey" | "apiSecret" | "timeoutMs">;
  site: string;
  fetchImpl?: typeof fetch;
  /** Injectable so tests do not wait on real backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Maximum attempts per request: 1 initial plus this many retries. */
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type CrmCallLog = {
  method: string;
  url: string;
  site: string;
  payload: Record<string, unknown> | null;
  query: Record<string, string> | null;
};

export type CrmClient = {
  readonly site: string;
  readonly baseUrl: string;
  /** POST a command. Used for every mutating method. */
  call<T>(method: string, payload?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>;
  /** GET a read method with query parameters. */
  read<T>(method: string, query?: CrmQuery, options?: { timeoutMs?: number }): Promise<T>;
  /** Observability: requests issued by this client, oldest first. */
  readonly calls: readonly CrmCallLog[];
};

const RETRYABLE_ERROR_NAMES = new Set([
  "AbortError",
  "TimeoutError",
  "TypeError",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "FetchError",
]);

export function createCrmClient(options: CrmTransportOptions): CrmClient {
  const { config, site } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 2));
  const retryDelayMs = options.retryDelayMs ?? 200;
  const calls: CrmCallLog[] = [];

  async function request<T>(request: CrmRequest): Promise<T> {
    const isRead = request.payload === undefined;
    const url = buildUrl(config.baseUrl, request.method, isRead ? request.query : undefined);
    const headers: Record<string, string> = {
      Host: site,
      Authorization: "token " + config.apiKey + ":" + config.apiSecret,
    };
    let body: string | undefined;
    if (!isRead) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(request.payload ?? {});
    }

    const normalizedQuery = isRead ? normalizeQuery(request.query) : null;
    calls.push({
      method: request.method,
      url,
      site,
      payload: isRead ? null : (request.payload ?? {}),
      query: normalizedQuery,
    });

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs ?? config.timeoutMs ?? DEFAULT_CRM_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: isRead ? "GET" : "POST",
          headers,
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
        });
        return await unwrap<T>(response);
      } catch (error) {
        // A mapped CRM response is a decision (conflict, not found, forbidden),
        // never a transport failure: it must reach the caller unchanged.
        if (isCrmError(error)) throw error;
        lastError = error;
        // Only a transport failure may be retried, and only once. The body is
        // identical on retry: never mint a new command_id.
        if (attempt >= maxAttempts || !isRetryable(error)) break;
        await sleep(retryDelayMs * attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new CrmError("crm_unavailable", describeTransportError(lastError));
  }

  return {
    site,
    baseUrl: config.baseUrl,
    call<T>(method: string, payload: Record<string, unknown> = {}, extra?: { timeoutMs?: number }) {
      return request<T>({ method, payload, timeoutMs: extra?.timeoutMs });
    },
    read<T>(method: string, query?: CrmQuery, extra?: { timeoutMs?: number }) {
      return request<T>({ method, query, timeoutMs: extra?.timeoutMs });
    },
    calls,
  };
}

async function unwrap<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw mapFrappeError(parsed, response.status);
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const envelope = parsed as Record<string, unknown>;
    if ("message" in envelope) return envelope.message as T;
    if ("exc_type" in envelope || "exception" in envelope || "_server_messages" in envelope) {
      throw mapFrappeError(envelope, response.status);
    }
  }

  return parsed as T;
}

function buildUrl(baseUrl: string, method: string, query: CrmQuery | undefined): string {
  const path = "/api/method/" + method.replace(/^\/+/, "");
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(normalizeQuery(query))) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function normalizeQuery(query: CrmQuery | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    result[key] = String(value);
  }
  return result;
}

function isRetryable(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (RETRYABLE_ERROR_NAMES.has(error.name)) return true;
    const code = (error as unknown as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_ERROR_NAMES.has(code)) return true;
    if (/timeout|socket|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(error.message)) return true;
  }
  return false;
}

function describeTransportError(error: unknown): string {
  if (!error) return "crm_transport_failure";
  if (error instanceof Error) {
    const collapsed = error.message.replace(/\s+/g, " ").trim();
    return "crm_transport_failure: " + collapsed.slice(0, 200);
  }
  return "crm_transport_failure";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
