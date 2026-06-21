import { draftCheckResultSchema } from "./schema.ts";
import {
  PROPERTY_CHECK_DISCLAIMER,
  PROPERTY_CHECK_NO_SOURCE_MESSAGE,
  PROPERTY_CHECK_UNAVAILABLE_MESSAGE,
  type DraftCheckRequest,
  type DraftCheckResult,
  type PropertyCheckEngineStatus,
  type PropertyCheckResult,
} from "./types.ts";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type AdapterOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  now?: () => string;
};

const DEFAULT_TIMEOUT_MS = 25000;
const ENGINE_PROPERTY_CHECK_PATH = "/api/v1/agent-property-check";

export async function runDraftCheckPropertyCheck(
  request: DraftCheckRequest,
  options: AdapterOptions = {},
): Promise<PropertyCheckResult> {
  const env = options.env ?? process.env;
  const baseUrl = env.DRAFTCHECK_ENGINE_BASE_URL?.trim();
  const token = env.DRAFTCHECK_ENGINE_TOKEN?.trim();

  if (!baseUrl || !token) {
    return engineUnavailable("missing_config", options.now);
  }

  const timeoutMs = parseTimeout(env.DRAFTCHECK_ENGINE_TIMEOUT_MS);
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(buildEngineUrl(baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("[property-check] engine returned non-ok response", { status: response.status });
      return engineUnavailable("network_error", options.now);
    }

    const payload = await response.json().catch(() => null);
    const parsed = draftCheckResultSchema.safeParse(payload);

    if (!parsed.success) {
      console.error("[property-check] engine returned invalid response");
      return engineUnavailable("invalid_response", options.now);
    }

    return normalizeDraftCheckResult(parsed.data, options.now);
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    console.error("[property-check] engine request failed", { reason });
    return engineUnavailable(reason, options.now);
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeDraftCheckResult(
  result: DraftCheckResult,
  now: AdapterOptions["now"] = () => new Date().toISOString(),
): PropertyCheckResult {
  if (result.status === "error") {
    return engineUnavailable("network_error", now);
  }

  if (result.status === "no_source" || result.status === "unsupported") {
    return refusal(result.status, result.disclaimer, now, result.engineRequestId);
  }

  if (result.confidence === "low") {
    return refusal("low_confidence", result.disclaimer, now, result.engineRequestId);
  }

  const citations = result.citations ?? [];

  if (citations.length === 0) {
    return refusal("missing_citations", result.disclaimer, now, result.engineRequestId);
  }

  const citationIds = new Set(citations.map((citation) => citation.id));
  const signals = result.signals ?? [];
  const likelyConstraints = result.likelyConstraints ?? [];
  const citedItems = [...signals, ...likelyConstraints];
  const everyItemCited = citedItems.every(
    (item) => item.citationIds.length > 0 && item.citationIds.every((citationId) => citationIds.has(citationId)),
  );

  if (!everyItemCited) {
    return refusal("invalid_citations", result.disclaimer, now, result.engineRequestId);
  }

  return {
    status: "success",
    engineStatus: "success",
    normalizedFacts: result.normalizedFacts ?? {},
    signals,
    likelyConstraints,
    talkingPoints: result.talkingPoints ?? [],
    citations,
    disclaimer: result.disclaimer || PROPERTY_CHECK_DISCLAIMER,
    confidence: result.confidence ?? "medium",
    generatedAt: now(),
    engineRequestId: result.engineRequestId,
  };
}

function refusal(
  engineStatus: PropertyCheckEngineStatus,
  disclaimer: string,
  now: AdapterOptions["now"] = () => new Date().toISOString(),
  engineRequestId?: string,
): PropertyCheckResult {
  return {
    status: engineStatus === "unsupported" ? "unsupported" : "no_source",
    engineStatus,
    normalizedFacts: {},
    signals: [],
    likelyConstraints: [],
    talkingPoints: [],
    citations: [],
    disclaimer: disclaimer || PROPERTY_CHECK_DISCLAIMER,
    message: PROPERTY_CHECK_NO_SOURCE_MESSAGE,
    generatedAt: now(),
    engineRequestId,
  };
}

function engineUnavailable(
  engineStatus: PropertyCheckEngineStatus,
  now: AdapterOptions["now"] = () => new Date().toISOString(),
): PropertyCheckResult {
  return {
    status: "engine_unavailable",
    engineStatus,
    normalizedFacts: {},
    signals: [],
    likelyConstraints: [],
    talkingPoints: [],
    citations: [],
    disclaimer: PROPERTY_CHECK_DISCLAIMER,
    message: PROPERTY_CHECK_UNAVAILABLE_MESSAGE,
    generatedAt: now(),
  };
}

function buildEngineUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}${ENGINE_PROPERTY_CHECK_PATH}`;
}

function parseTimeout(rawValue: string | undefined): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}
