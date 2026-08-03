import { NextResponse, type NextRequest } from "next/server";

import { featureDisabledResponse } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildAdAudit } from "@/lib/research/ad-audit";
import { generateAuditSuggestions } from "@/lib/research/audit-suggestions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("suburbPages");
  if (featureGate) return featureGate;

  const location =
    request.nextUrl.searchParams.get("location") ?? request.nextUrl.searchParams.get("q") ?? "";

  try {
    const supabase = createSupabaseServiceClient();
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const rateLimit = await checkRateLimit(supabase, null, ip, {
      bucket: "public-audit-suggestions",
      maxRequests: 10,
      windowSeconds: 60 * 60,
    });
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }
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
