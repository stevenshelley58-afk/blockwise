import { NextResponse, type NextRequest } from "next/server";

import { loadPublicAdRadarCards } from "@/lib/research/public-ad-radar";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const location = request.nextUrl.searchParams.get("location") ?? request.nextUrl.searchParams.get("q") ?? "";

  try {
    const supabase = createSupabaseServiceClient();
    const payload = await loadPublicAdRadarCards(supabase, {
      location,
      cursor: request.nextUrl.searchParams.get("cursor"),
      includeSurroundingSuburbs: parseOptionalBoolean(request.nextUrl.searchParams.get("includeSurrounding")),
      limit: Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "18", 10),
      sort: request.nextUrl.searchParams.get("sort") === "longest" ? "longest" : "recent",
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=45, stale-while-revalidate=180",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local ad radar is unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === "1" || value === "true" || value === "yes";
}
