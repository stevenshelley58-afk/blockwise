import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { suggestPropertyAddresses } from "@/lib/property-check/address-autocomplete";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await requireApiWorkspace(request, "property_check");
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 60,
    maxRequests: 40,
    bucket: "property-address-autocomplete",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many address searches. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const result = await suggestPropertyAddresses(request.nextUrl.searchParams.get("q") ?? "", {
    apiKey: process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY,
    sessionToken: request.nextUrl.searchParams.get("session"),
  });

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": result.source === "google" ? "private, max-age=60" : "private, no-store",
    },
  });
}
