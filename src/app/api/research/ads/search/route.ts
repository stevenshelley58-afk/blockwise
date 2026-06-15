import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  normaliseAdRadarCardSearchQuery,
  searchCustomerMetaAdLibraryCards,
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

  const q = normaliseAdRadarCardSearchQuery(request.nextUrl.searchParams.get("q") ?? "");
  const sort: AdRadarCardSearchSort = request.nextUrl.searchParams.get("sort") === "longest" ? "longest" : "recent";
  const includeSurroundingSuburbs = isTruthySearchParam(request.nextUrl.searchParams.get("includeSurrounding"));
  if (!q) {
    return NextResponse.json({ cards: [] });
  }

  try {
    const cards = await searchCustomerMetaAdLibraryCards(supabase, { query: q, sort, includeSurroundingSuburbs });
    return NextResponse.json({ cards });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ad Radar search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isTruthySearchParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}
