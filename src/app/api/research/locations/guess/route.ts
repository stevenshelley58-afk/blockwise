import { NextResponse, type NextRequest } from "next/server";

import { resolveAdRadarLocationGuess } from "@/lib/research/ad-radar-location";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guess = resolveAdRadarLocationGuess(request.headers);

  return NextResponse.json(
    {
      location: {
        label: guess.label,
        searchTerm: guess.label,
        source: guess.source,
      },
    },
    {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    },
  );
}
