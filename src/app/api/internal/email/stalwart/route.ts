import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ingestEmailSuppressions } from "@/lib/email/events";
import { mapStalwartPermanentFailures, verifyStalwartSignature } from "@/lib/email/stalwart-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Internal Docker-network webhook authenticated by Stalwart's X-Signature HMAC. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.STALWART_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "stalwart_webhook_not_configured" }, { status: 503 });
  if (!verifyStalwartSignature(rawBody, request.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!Array.isArray((body as { events?: unknown })?.events)) {
    return NextResponse.json({ error: "invalid_events" }, { status: 400 });
  }
  const mapping = mapStalwartPermanentFailures(body);
  if (mapping.malformedPermanentFailures > 0) {
    // A selected permanent-failure event without a mappable recipient must
    // remain retryable; acknowledging it would silently lose suppression data.
    return NextResponse.json({ error: "unmappable_permanent_failure" }, { status: 422 });
  }
  if (mapping.events.length === 0) {
    return NextResponse.json({ ok: true, recorded: 0, ignored: mapping.ignored });
  }
  try {
    await ingestEmailSuppressions(createSupabaseServiceClient(), mapping.events);
  } catch (error) {
    console.error("[stalwart-events] suppression recording failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "suppression_record_failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, recorded: mapping.events.length, ignored: mapping.ignored });
}
