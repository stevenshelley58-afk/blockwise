import { NextResponse, type NextRequest } from "next/server";

import { buildAdAudit } from "@/lib/research/ad-audit";
import { generateAuditSuggestions } from "@/lib/research/audit-suggestions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const location =
    request.nextUrl.searchParams.get("location") ?? request.nextUrl.searchParams.get("q") ?? "";

  try {
    const supabase = createSupabaseServiceClient();
    const audit = await buildAdAudit(supabase, { location });
    const { suggestions, source } = await generateAuditSuggestions(audit, { signal: request.signal });

    return NextResponse.json(
      { location: audit.location, suggestions, source },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit suggestions are unavailable.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
