import { NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { importOutreachDraft, OutreachDraftError } from "@/lib/outreach/repository";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Adapter surface for Ad Radar or a controlled operator import. It validates
 * provenance, consent, suppression, evidence freshness, source rights, and
 * scope before persisting a review-only draft. It never sends mail.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 131072) return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 131072) return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  const auth = await verifyInternalRequest(request, "outreach.drafts.import", { body });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await importOutreachDraft(createSupabaseServiceClient(), input);
    if ("valid" in result) return NextResponse.json({ ok: true, sendsEnabled: false, ...result }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ok: true, sendsEnabled: false, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OutreachDraftError) {
      const status = error.code === "ineligible_contact" || error.code === "demo_data_rejected" ? 422 : 400;
      return NextResponse.json({ error: error.code, message: error.message, details: error.details ?? null }, { status });
    }
    console.error("[outreach-drafts] import failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "outreach_draft_import_failed" }, { status: 503 });
  }
}

