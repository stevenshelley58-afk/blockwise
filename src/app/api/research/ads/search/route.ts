import { NextResponse, type NextRequest } from "next/server";

import {
  featureDisabledResponse,
  requireApiWorkspace,
} from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  normaliseAdRadarCardSearchQuery,
  type AdRadarCardSearchFilters,
} from "@/lib/research/ad-radar-card-search";
import { mapAdDbRowToCustomerMetaCard } from "@/lib/research/ad-db-card-mapper";
import {
  AdDbConfigurationError,
  searchAdDbAds,
} from "@/lib/research/ad-db-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { access } = guard;

  const rateLimit = await checkRateLimit(access.workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 20,
    bucket: "ads-search",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const invalid = validateSearchParams(searchParams);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const q = normaliseAdRadarCardSearchQuery(searchParams.get("q") ?? "");
  const filters = parseFilters(searchParams);
  if (!q) return NextResponse.json({ cards: [] });

  try {
    const result = await searchAdDbAds({
      query: q,
      agentName: filters.agent,
      agencyName: filters.agency,
      limit: 50,
    });
    return NextResponse.json(
      { cards: result.items.map(mapAdDbRowToCustomerMetaCard) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AdDbConfigurationError) {
      return NextResponse.json(
        { error: "Ad DB is not configured." },
        { status: 503 },
      );
    }
    console.error("[ad-db] search failed", error);
    return NextResponse.json(
      { error: "Ad DB search is unavailable." },
      { status: 502 },
    );
  }
}

function isTruthySearchParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function parseFilters(params: URLSearchParams): AdRadarCardSearchFilters {
  const filters: AdRadarCardSearchFilters = {};
  const agency = params.get("agency")?.trim();
  if (agency) filters.agency = agency;
  const agent = params.get("agent")?.trim();
  if (agent) filters.agent = agent;
  return filters;
}

const ALLOWED_PARAMS = new Set([
  "q",
  "sort",
  "includeSurrounding",
  "status",
  "agency",
  "agent",
  "adType",
  "format",
  "hook",
]);

function validateSearchParams(params: URLSearchParams): string | null {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return `Unsupported search parameter: ${key}`;
    if (params.getAll(key).length > 1)
      return `Repeated search parameter: ${key}`;
  }
  const sort = params.get("sort");
  if (sort && sort !== "recent")
    return "The requested sort is not supported by Ad DB.";
  if (isTruthySearchParam(params.get("includeSurrounding")))
    return "Surrounding-suburb search is not supported by Ad DB.";
  if (params.has("status"))
    return "Status filtering is not supported by Ad DB.";
  if (params.has("adType"))
    return "Ad type filtering is not supported by Ad DB.";
  if (params.has("format"))
    return "Format filtering is not supported by Ad DB.";
  if (params.has("hook")) return "Hook filtering is not supported by Ad DB.";
  return null;
}
