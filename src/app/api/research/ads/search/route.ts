import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  normaliseAdRadarCardSearchQuery,
  searchCustomerMetaAdLibraryCards,
  type AdRadarCardSearchFilters,
  type AdRadarCardSearchSort,
} from "@/lib/research/ad-radar-card-search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const rateLimit = await checkRateLimit(supabase, access.workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 20,
    bucket: "ads-search",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const q = normaliseAdRadarCardSearchQuery(searchParams.get("q") ?? "");
  const sort: AdRadarCardSearchSort = searchParams.get("sort") === "longest" ? "longest" : "recent";
  const includeSurroundingSuburbs = isTruthySearchParam(searchParams.get("includeSurrounding"));
  const filters = parseFilters(searchParams);
  if (!q) {
    return NextResponse.json({ cards: [] });
  }

  try {
    const cards = await searchCustomerMetaAdLibraryCards(supabase, { query: q, sort, includeSurroundingSuburbs, filters });
    return NextResponse.json({ cards });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ad Radar search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isTruthySearchParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

const AD_TYPE_VALUES = new Set([
  "listing",
  "just_sold",
  "appraisal",
  "open_home",
  "property_management",
  "market_update",
  "agency_brand",
]);
const FORMAT_VALUES = new Set(["image", "video", "carousel"]);

function parseFilters(params: URLSearchParams): AdRadarCardSearchFilters {
  const filters: AdRadarCardSearchFilters = {};
  const status = params.get("status");
  if (status === "active" || status === "inactive") filters.status = status;
  const agency = params.get("agency")?.trim();
  if (agency) filters.agency = agency;
  const agent = params.get("agent")?.trim();
  if (agent) filters.agent = agent;
  const adType = params.get("adType")?.trim();
  if (adType && AD_TYPE_VALUES.has(adType)) filters.adType = adType;
  const format = params.get("format")?.trim();
  if (format && FORMAT_VALUES.has(format)) filters.format = format;
  const hook = params.get("hook")?.trim();
  if (hook) filters.hook = hook.slice(0, 100);
  return filters;
}
