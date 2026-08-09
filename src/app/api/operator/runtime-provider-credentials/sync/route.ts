import { NextResponse, type NextRequest } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
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
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  if (request.headers.get("x-blockwise-runtime-credential-sync") !== "openai") {
    return NextResponse.json({ error: "Runtime credential sync confirmation is required." }, { status: 400 });
  }

  const accessToken = process.env.OPENAI_API_KEY?.trim();
  if (!accessToken) {
    return NextResponse.json({ error: "The OpenAI runtime credential is not configured." }, { status: 503 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  await upsertRuntimeProviderToken({
    serviceSupabase,
    provider: "openai",
    accessToken,
  });
  const roundTrip = await loadRuntimeProviderToken(serviceSupabase, "openai");
  if (roundTrip !== accessToken) {
    return NextResponse.json({ error: "The encrypted runtime credential could not be verified." }, { status: 500 });
  }

  return NextResponse.json({ provider: "openai", configured: true, roundTripVerified: true });
}
