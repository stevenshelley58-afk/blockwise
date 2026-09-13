import { NextResponse } from "next/server";
import { verifyOwnerLeadIntakeRequest } from "@/lib/owner-crm/auth";
import { parseOwnerLeadIntakePageRequest, readOwnerLeadIntakePage } from "@/lib/owner-crm/lead-intake";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const auth = await verifyOwnerLeadIntakeRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE_HEADERS });
  try {
    const page = parseOwnerLeadIntakePageRequest(new URL(request.url).searchParams);
    return NextResponse.json(await readOwnerLeadIntakePage(createSupabaseServiceClient() as never, page), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid_page_")) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS });
    console.error("[owner-lead-intake] read failed");
    return NextResponse.json({ error: "owner_lead_intake_unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}