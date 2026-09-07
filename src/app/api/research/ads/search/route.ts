import { NextResponse, type NextRequest } from "next/server";

import {
  featureDisabledResponse,
  requireApiWorkspace,
} from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { mapAdDbRowToCustomerMetaCard } from "@/lib/research/ad-db-card-mapper";
import {
  AdDbConfigurationError,
  parseAdDbSearchParams,
  searchAdDbAds,
} from "@/lib/research/ad-db-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const rateLimit = await checkRateLimit(
    guard.access.workspaceId,
    guard.access.userId,
    {
      windowSeconds: 60,
      maxRequests: 20,
      bucket: "ads-search",
    },
  );
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const parsed = parseAdDbSearchParams(request.nextUrl.searchParams);
  if (!parsed.ok)
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.input) return NextResponse.json({ cards: [] });

  try {
    const result = await searchAdDbAds({ ...parsed.input, limit: 50 });
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
