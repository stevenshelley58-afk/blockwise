import { NextResponse, type NextRequest } from "next/server";

import { featureDisabledResponse } from "@/lib/auth/api-guards";
import { suggestAdRadarLocations } from "@/lib/research/ad-radar-google-locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const sessionToken = request.nextUrl.searchParams.get("session");
  const result = await suggestAdRadarLocations(query, {
    apiKey: process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
    sessionToken,
  });

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": result.source === "google" ? "private, max-age=60" : "public, max-age=300",
    },
  });
}
