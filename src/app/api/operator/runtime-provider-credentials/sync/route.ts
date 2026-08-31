import { NextResponse, type NextRequest } from "next/server";

import { requireOwnerOperator } from "@/lib/operator/auth";
import {
  loadRuntimeProviderToken,
  upsertRuntimeProviderToken,
} from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Copy the configured Vercel runtime key into the encrypted service vault.
 * No token is accepted from or returned to the caller. The explicit header
 * keeps this release operation unavailable to an accidental browser form.
 */
export async function POST(request: NextRequest) {
  const guard = await requireOwnerOperator();
  if (!guard.ok) return guard.response;
  const provider = request.headers.get("x-blockwise-runtime-credential-sync");
  if (provider !== "openai" && provider !== "google") {
    return NextResponse.json({ error: "Runtime credential sync confirmation is required." }, { status: 400 });
  }

  const accessToken = (provider === "google" ? process.env.GOOGLE_AI_API_KEY : process.env.OPENAI_API_KEY)?.trim();
  if (!accessToken) {
    return NextResponse.json({ error: `The ${provider} runtime credential is not configured.` }, { status: 503 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  await upsertRuntimeProviderToken({
    serviceSupabase,
    provider,
    accessToken,
  });
  const roundTrip = await loadRuntimeProviderToken(serviceSupabase, provider);
  if (roundTrip !== accessToken) {
    return NextResponse.json({ error: "The encrypted runtime credential could not be verified." }, { status: 500 });
  }

  return NextResponse.json({ provider, configured: true, roundTripVerified: true });
}
