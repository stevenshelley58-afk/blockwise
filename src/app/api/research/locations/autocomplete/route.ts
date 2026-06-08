import { NextResponse, type NextRequest } from "next/server";

import { suggestAdRadarLocations } from "@/lib/research/ad-radar-google-locations";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
