import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { evaluateRealEstateCompliance } from "@/lib/compliance/real-estate-policy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;

  const copy =
    request.nextUrl.searchParams.get("copy") ??
    "See recent buyer demand and comparable sales activity in your suburb before planning your next move.";

  return NextResponse.json({
    result: evaluateRealEstateCompliance({
      region: "AU",
      channel: "meta",
      copy,
    }),
  });
}
