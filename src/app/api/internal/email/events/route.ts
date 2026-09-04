import { NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { parseEmailEvents, ingestEmailSuppressions } from "@/lib/email/events";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "email.events", { body: rawBody });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const events = parseEmailEvents(body);
  if (events.length === 0) return NextResponse.json({ error: "no_valid_events" }, { status: 400 });

  const service = createSupabaseServiceClient();
  try {
    await ingestEmailSuppressions(service, events);
  } catch (error) {
    console.error("[email-events] suppression recording failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "suppression_record_failed" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, recorded: events.length });
}
