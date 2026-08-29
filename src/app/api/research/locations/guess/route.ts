import { NextResponse, type NextRequest } from "next/server";

import { featureDisabledResponse } from "@/lib/auth/api-guards";
import { resolveAdRadarLocationGuess } from "@/lib/research/ad-radar-location";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

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
