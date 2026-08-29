import { NextResponse, type NextRequest } from "next/server";

import { featureDisabledResponse, requireApiWorkspace } from "@/lib/auth/api-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { loadAdvertiserSuggestions } from "@/lib/research/advertiser-autocomplete";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const rateLimit = await checkRateLimit(supabase, access.workspaceId, access.userId, {
    windowSeconds: 60,
    maxRequests: 40,
    bucket: "advertisers-autocomplete",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/[(),]/g, "").trim();
  if (q.length < 2) {
    return NextResponse.json({ advertisers: [] });
  }

  const advertisers = await loadAdvertiserSuggestions(supabase, q);
  return NextResponse.json({ advertisers });
}
