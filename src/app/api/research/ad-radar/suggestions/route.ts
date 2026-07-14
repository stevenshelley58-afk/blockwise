import { NextResponse, type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { loadAdvertiserSuggestions } from "@/lib/research/advertiser-autocomplete";
import { suggestAdRadarLocations } from "@/lib/research/ad-radar-google-locations";
import { mergeAdRadarSearchSuggestions } from "@/lib/research/ad-radar-search-suggestions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").replace(/[(),]/g, "").trim();
  if (query.length < 2) return NextResponse.json({ suggestions: [] });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const supabase = createSupabaseServiceClient();
  const rateLimit = await checkRateLimit(supabase, null, ip, {
    windowSeconds: 60,
    maxRequests: 40,
    bucket: "ad-radar-suggestions",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many searches. Please try again shortly.", suggestions: [] },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const sessionToken = request.nextUrl.searchParams.get("session");
  const [locationResult, advertisers] = await Promise.all([
    suggestAdRadarLocations(query, {
      apiKey: process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
      sessionToken,
    }),
    loadAdvertiserSuggestions(supabase, query, 5),
  ]);

  return NextResponse.json(
    { suggestions: mergeAdRadarSearchSuggestions(locationResult.predictions, advertisers) },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
